/**
 * Pure lead-scoring engine for spec 015 — Lead Classification Revamp.
 *
 * Given a finalized SOPState, a per-sub_type ScoringConfig, and a chip
 * catalog (slug → Chip), compute the deterministic 4-value
 * classification (HOT / WARM / COLD / SPAM), numeric lead_score, and
 * the reasons-derivation inputs (the captured chips with non-zero
 * `score_weight`).
 *
 * This module is NOT responsible for:
 * - Running hard-overrides (see `./hard-overrides.ts` — applied AFTER
 *   the lead is persisted, per FR-010c).
 * - Building the human-readable `reasons[]` array (see
 *   `./reason-builder.ts` — runs after hard-overrides per FR-010a).
 * - Persisting the lead (see `packages/api/src/lib/leads.ts`).
 * - Emitting the structured log (see `contracts/lead-finalization-log.md`).
 *
 * Per spec §Assumptions: scoring is point-in-time at capture; the
 * inputs to this function are exactly the inputs used when the lead
 * was finalized.
 */
import type {
  Chip,
  LeadClassification,
  LeadGeographicQualification,
  LeadRequestType,
  ScoringConfig,
  SOPState,
} from '@legal-chatbot/shared';

/**
 * Chip captures eligible for inclusion in the reasons array. Carries
 * the chip's label (for display) and its weight (so the reason-builder
 * can apply FR-010a's `|w| ≥ 5` inclusion rule).
 */
export interface CapturedScoringChip {
  step_slug: string;
  chip_slug: string;
  chip_label: string;
  score_weight: number;
}

/**
 * Output of the pure scoring function. Maps onto the new lead columns
 * declared in `data-model.md §1`. Note: `classification` is null only
 * when the scoring path is `'llm_fallback'` — the caller decides what
 * to write in that case (typically the LLM-emitted value).
 */
export interface ScoredLead {
  classification: LeadClassification | null;
  lead_score: number | null;
  /**
   * Captured scoring chips with their weights, ordered by SOP step
   * position. The reason-builder consumes this and the
   * hard-override result to produce the final reasons array.
   */
  scored_chips: CapturedScoringChip[];
  /** Raw sum before capping/flooring; null on llm_fallback path. Useful for tests. */
  raw_score: number | null;
  scoring_path: 'rule_based' | 'llm_fallback';
  request_type: LeadRequestType | null;
  geographic_qualification: LeadGeographicQualification | null;
  geographic_qualification_details_json: string | null;
  /**
   * Subset of `scored_chips` that should appear in the reasons array
   * per FR-010a's `|score_weight| ≥ 5` inclusion rule. The
   * reason-builder will translate these into phrases. Pre-computed
   * here so the reason-builder is a pure phrase-renderer.
   */
  reasons: CapturedScoringChip[];
}

export interface ScoreLeadInput {
  sopState: SOPState;
  scoringConfig: ScoringConfig | null;
  chipsBySlug: Map<string, Chip>;
  /**
   * Optional contact-form-derived weight bonus. Per spec
   * §Assumptions and `contracts/scoring-config.md`, the xlsx Q8
   * (Phone +10 / Email +5) is captured by inspecting the contact
   * form's submitted fields, NOT a chip step. The caller computes
   * this bonus by checking which contact fields are non-empty and
   * passes it in. Defaults to 0 if not provided.
   */
  contactBonus?: number;
}

/**
 * Slugs of the SOP steps whose chip captures contribute to the score.
 * Other captured steps (case_type, sub_type, where, what, when,
 * contact, request_type, geographic_qualification) are NOT scored —
 * they're either intake context or metadata.
 *
 * Kept as a constant here (rather than reading from
 * `sop_steps.applies_when_sub_type_slug`) because the scorer is
 * stateless and the step set is fixed in MVP. Future scoring configs
 * with different question sets would extend this.
 */
const SCORING_STEP_SLUGS = [
  'accident_timing',
  'injury',
  'medical_treatment',
  'accident_role',
  'insurance_activity',
  'work_impact',
  'attorney_status',
] as const;

/**
 * Slug of the request_type metadata step. Reading this step's
 * captured value selects which classification-threshold table the
 * scorer applies (Self vs Family/Friend). Per FR-006.
 */
const REQUEST_TYPE_STEP_SLUG = 'request_type';

/**
 * Slug of the geographic_qualification metadata step. Captured value
 * is exposed on the ScoredLead output for the dashboard / routing,
 * but does not affect the score per FR-015.
 */
const GEO_QUALIFICATION_STEP_SLUG = 'geographic_qualification';

/**
 * Map a `request_type` chip slug back to the typed enum value. The
 * exact slugs are the seeded car-accident default chips per
 * `contracts/scoring-config.md`.
 */
function mapRequestTypeChipSlug(slug: string | null): LeadRequestType | null {
  if (slug === 'myself') return 'SELF';
  if (slug === 'friend_family') return 'FRIEND_FAMILY';
  return null;
}

/**
 * Map a `geographic_qualification` chip slug to the typed enum.
 */
function mapGeographicChipSlug(
  slug: string | null,
): LeadGeographicQualification | null {
  if (slug === 'yes_in_area') return 'IN_SERVICE_AREA';
  if (slug === 'no_outside_area') return 'OUTSIDE_SERVICE_AREA';
  return null;
}

/**
 * Map a numeric score to a classification using the appropriate
 * threshold table from the scoring config. Inclusive bounds; ties on
 * a boundary land in the higher classification (FR-040).
 *
 * Defaults to the Self table when `requestType` is null per FR-006
 * fallback ("Self" is the higher-fidelity table; defaulting to it
 * preserves COLD as a possible value).
 */
function scoreToClassification(
  score: number,
  requestType: LeadRequestType | null,
  config: ScoringConfig,
): LeadClassification {
  // Family/Friend: 3 buckets (HOT, WARM, SPAM — no COLD).
  if (requestType === 'FRIEND_FAMILY') {
    const t = config.thresholds_family_friend;
    if (score >= t.hot[0] && score <= t.hot[1]) return 'HOT';
    if (score >= t.warm[0] && score <= t.warm[1]) return 'WARM';
    if (score >= t.spam[0] && score <= t.spam[1]) return 'SPAM';
    return 'SPAM'; // Defensive; unreachable when buckets cover [0,100].
  }

  // Self (default when requestType is null per FR-006 fallback): 4 buckets.
  const t = config.thresholds_self;
  if (score >= t.hot[0] && score <= t.hot[1]) return 'HOT';
  if (score >= t.warm[0] && score <= t.warm[1]) return 'WARM';
  if (score >= t.cold[0] && score <= t.cold[1]) return 'COLD';
  if (score >= t.spam[0] && score <= t.spam[1]) return 'SPAM';
  return 'SPAM'; // Defensive.
}

/**
 * Pure, deterministic lead scorer. Same inputs → same output every
 * time. No I/O, no logging, no side effects.
 */
export function scoreLead(input: ScoreLeadInput): ScoredLead {
  const { sopState, scoringConfig, chipsBySlug, contactBonus = 0 } = input;

  // Read request_type and geographic_qualification metadata first;
  // both are exposed on ScoredLead regardless of scoring path so the
  // dashboard / routing can use them even on llm_fallback leads.
  const requestTypeStep = sopState.steps.find(
    (s) => s.slug === REQUEST_TYPE_STEP_SLUG,
  );
  const requestType = mapRequestTypeChipSlug(
    requestTypeStep?.captured_value ?? null,
  );

  const geoStep = sopState.steps.find(
    (s) => s.slug === GEO_QUALIFICATION_STEP_SLUG,
  );
  const geographicQualification = mapGeographicChipSlug(
    geoStep?.captured_value ?? null,
  );

  // Fallback path: no scoring config → caller will use LLM-emitted
  // classification; the scorer reports null + path indicator.
  if (scoringConfig === null) {
    return {
      classification: null,
      lead_score: null,
      raw_score: null,
      scored_chips: [],
      scoring_path: 'llm_fallback',
      request_type: requestType,
      geographic_qualification: geographicQualification,
      geographic_qualification_details_json: null,
      reasons: [],
    };
  }

  // Collect captured scoring chips. Each captured step's chip slug
  // is resolved against the chip catalog to retrieve label + weight.
  const scoredChips: CapturedScoringChip[] = [];
  for (const stepSlug of SCORING_STEP_SLUGS) {
    const step = sopState.steps.find((s) => s.slug === stepSlug);
    if (!step || step.captured_value === null) continue;
    const chip = chipsBySlug.get(step.captured_value);
    if (!chip || chip.score_weight === undefined) continue;
    scoredChips.push({
      step_slug: stepSlug,
      chip_slug: chip.slug,
      chip_label: chip.label,
      score_weight: chip.score_weight,
    });
  }

  // Sum chip weights + contact bonus.
  const rawScore =
    scoredChips.reduce((acc, c) => acc + c.score_weight, 0) + contactBonus;

  // Cap at 100, floor at 0 per FR-005.
  const cappedScore = Math.max(0, Math.min(100, rawScore));

  const classification = scoreToClassification(
    cappedScore,
    requestType,
    scoringConfig,
  );

  // Pre-compute the reasons-eligible subset per FR-010a's `|w| ≥ 5`
  // inclusion rule. The reason-builder (T012) renders these into
  // phrases.
  const reasons = scoredChips.filter(
    (c) => Math.abs(c.score_weight) >= 5,
  );

  return {
    classification,
    lead_score: cappedScore,
    raw_score: rawScore,
    scored_chips: scoredChips,
    scoring_path: 'rule_based',
    request_type: requestType,
    geographic_qualification: geographicQualification,
    geographic_qualification_details_json: null, // populated by caller from contact-form follow-up
    reasons,
  };
}
