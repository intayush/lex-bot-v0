/**
 * Reason-builder for spec 015 lead classification.
 *
 * Pure function. Renders a captured set of scoring chips and a fired
 * hard-override list into the human-readable `reasons[]` array per
 * FR-010a / FR-008 / contracts/lead-finalization-log.md.
 *
 * Inclusion rule (FR-010a): a chip is included iff
 * `|score_weight| >= 5`. Hard-override rule names are appended after
 * chip phrases in fixed evaluation order (FR-008):
 * missing_contact > out_of_scope > no_injury_no_treatment > fake_info.
 *
 * The caller (scoreLead's downstream pipeline in
 * packages/api/src/lib/leads.ts) is responsible for:
 * - Filtering out chips with `|w| < 5` BEFORE passing to this builder
 *   (scoreLead does this in its `reasons` field per T010).
 * - Determining which hard-overrides fired (see ./hard-overrides.ts).
 * - Persisting the resulting array to `leads.score_reasons_json`.
 */
import type { CapturedScoringChip } from './score-lead.js';

export type HardOverrideName =
  | 'missing_contact'
  | 'out_of_scope'
  | 'no_injury_no_treatment'
  | 'fake_info';

/**
 * Fixed evaluation order for hard-overrides per FR-008. Used to
 * sort the input override array deterministically before appending.
 * Anything not in this list (e.g., the FR-010b `scoring_error`
 * sentinel passed by the caller) is appended at the end in the
 * caller's order.
 */
const FIXED_OVERRIDE_ORDER: readonly HardOverrideName[] = [
  'missing_contact',
  'out_of_scope',
  'no_injury_no_treatment',
  'fake_info',
] as const;

/**
 * Build the `reasons[]` array from captured scoring chips and the
 * list of hard-override rules that fired.
 *
 * Applies FR-010a's `|score_weight| >= 5` inclusion rule defensively:
 * chips below the threshold are excluded even if the caller passes
 * them in. This guarantees the function alone enforces the rule;
 * callers cannot accidentally leak below-threshold phrases into the
 * reasons array.
 *
 * @param scoredChips Captured chips (any weights). Filtered to
 *   `|w| >= 5` before rendering.
 * @param firedOverrides Names of hard-override rules that fired.
 *   May contain duplicates; deduplicated by this function. May
 *   contain the FR-010b `'scoring_error'` sentinel which is appended
 *   verbatim (not in FIXED_OVERRIDE_ORDER).
 * @returns Ordered list of phrase strings ready for
 *   `leads.score_reasons_json` serialization.
 */
export function buildReasons(
  scoredChips: CapturedScoringChip[],
  firedOverrides: HardOverrideName[],
): string[] {
  // FR-010a: include chip only when its absolute score weight is at
  // least 5. Render eligible chips' labels in input order (which is
  // SOP step order because scoreLead iterates SCORING_STEP_SLUGS
  // deterministically).
  const chipPhrases = scoredChips
    .filter((c) => Math.abs(c.score_weight) >= 5)
    .map((c) => c.chip_label);

  // Sort fired overrides by fixed evaluation order (FR-008). Unknown
  // values (e.g., the FR-010b 'scoring_error' sentinel) append at the
  // end in caller order.
  const knownOverrides = new Set<HardOverrideName>();
  const unknownOverrides: HardOverrideName[] = [];
  for (const name of firedOverrides) {
    if (FIXED_OVERRIDE_ORDER.includes(name)) {
      knownOverrides.add(name);
    } else {
      unknownOverrides.push(name);
    }
  }
  const orderedOverrides: string[] = FIXED_OVERRIDE_ORDER.filter((name) =>
    knownOverrides.has(name),
  );
  orderedOverrides.push(...unknownOverrides);

  return [...chipPhrases, ...orderedOverrides];
}
