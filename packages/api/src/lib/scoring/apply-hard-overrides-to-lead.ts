/**
 * Spec 015 T064 / spec 016 follow-up — Wire `applyHardOverrides`
 * into production lead-finalization paths.
 *
 * Hard-override predicates and their combinator have lived in
 * `hard-overrides.ts` since spec 015 but were never invoked from
 * production code (the original spec 015 task T064 was abandoned
 * mid-implementation; spec 016 introduced the branch model on top
 * without picking up the wiring). The orphaned predicates meant
 * NONE of the four override rules — missing_contact, out_of_scope,
 * no_injury_no_treatment, fake_info — fired on production leads,
 * even though every lead's `score_reasons_json` is shaped to
 * receive them and every branch version persists a per-rule
 * enabled-toggles JSON.
 *
 * This helper is the wiring. Call sites:
 *   - `leads.captureLead` (LLM tool path, both INSERT and UPDATE
 *     branches)
 *   - `leads.updateLeadSOPState` (contact-form-driven path)
 *   - `app/api/chat/route.ts` `onFinish` after the branch-finalize
 *     UPDATE that writes the snapshot + rule-based score
 *
 * The helper is idempotent: calling it twice on the same lead is a
 * no-op the second time (the override rule names are already in
 * the reasons list). It's also downgrade-only per FR-009: it never
 * upgrades a SPAM classification to anything higher.
 *
 * Toggle resolution order:
 *   1. If the captured (case_type, sub_type) has an active branch
 *      version with `hard_override_toggles_json`, use those toggles.
 *   2. Else if the captured sub_type has a legacy
 *      `scoring_config_json` carrying `hard_overrides_enabled`, use
 *      that.
 *   3. Else fall back to all-enabled (every toggle true). This is
 *      the safe default — no firm should silently lose the
 *      missing_contact / fake_info safety nets.
 */
import { and, eq } from 'drizzle-orm';
import type { CaseType, SOPState, HardOverridesEnabled, Lead } from '@legal-chatbot/shared';

import { db } from '../../db';
import * as schema from '../../db/schema';
import {
  applyHardOverrides,
  appendOverrideReasons,
} from './hard-overrides';
import type { HardOverrideName } from './reason-builder';

const ALL_ENABLED: HardOverridesEnabled = {
  missing_contact: true,
  out_of_scope: true,
  no_injury_no_treatment: true,
  fake_info: true,
};

/**
 * Resolve the per-account, per-sub-type hard-override toggles.
 * Branch row wins; legacy sub_types.scoring_config_json comes next;
 * otherwise all-enabled.
 */
async function resolveEnabledToggles(
  accountId: string,
  caseTypeSlug: string | null,
  subTypeSlug: string | null,
): Promise<HardOverridesEnabled> {
  if (!caseTypeSlug || !subTypeSlug) return ALL_ENABLED;

  // 1. Branch path: look up an active branch for this (case_type, sub_type)
  //    and read its current_version's hard_override_toggles_json.
  let branchRows: Array<{ togglesJson: string }> = [];
  try {
    branchRows = await db
      .select({
        togglesJson: schema.branchVersions.hard_override_toggles_json,
      })
      .from(schema.branches)
      .innerJoin(
        schema.branchVersions,
        eq(schema.branches.current_version_id, schema.branchVersions.id),
      )
      .where(
        and(
          eq(schema.branches.account_id, accountId),
          eq(schema.branches.case_type_slug, caseTypeSlug),
          eq(schema.branches.sub_type_slug, subTypeSlug),
          eq(schema.branches.is_active, true),
        ),
      )
      .limit(1);
  } catch {
    // Table missing (test envs that don't seed branches) or query
    // error — fall through to legacy / default. Production deploys
    // always have the branches table after migrations 0004+.
    branchRows = [];
  }
  if (branchRows.length > 0 && branchRows[0]!.togglesJson) {
    try {
      const parsed = JSON.parse(branchRows[0]!.togglesJson);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.missing_contact === 'boolean' &&
        typeof parsed.out_of_scope === 'boolean' &&
        typeof parsed.no_injury_no_treatment === 'boolean' &&
        typeof parsed.fake_info === 'boolean'
      ) {
        return parsed as HardOverridesEnabled;
      }
    } catch {
      // Malformed branch toggles JSON — fall through to legacy / default.
    }
  }

  // 2. Legacy path: read sub_types.scoring_config_json's
  //    `hard_overrides_enabled` field.
  const subTypeRows = await db
    .select({ scoringJson: schema.subTypes.scoring_config_json })
    .from(schema.subTypes)
    .innerJoin(
      schema.caseTypes,
      eq(schema.subTypes.case_type_id, schema.caseTypes.id),
    )
    .where(
      and(
        eq(schema.caseTypes.account_id, accountId),
        eq(schema.caseTypes.slug, caseTypeSlug),
        eq(schema.subTypes.slug, subTypeSlug),
      ),
    )
    .limit(1);
  if (subTypeRows.length > 0 && subTypeRows[0]!.scoringJson) {
    try {
      const parsed = JSON.parse(subTypeRows[0]!.scoringJson);
      const flags = parsed?.hard_overrides_enabled;
      if (
        flags &&
        typeof flags === 'object' &&
        typeof flags.missing_contact === 'boolean' &&
        typeof flags.out_of_scope === 'boolean' &&
        typeof flags.no_injury_no_treatment === 'boolean' &&
        typeof flags.fake_info === 'boolean'
      ) {
        return flags as HardOverridesEnabled;
      }
    } catch {
      // Malformed scoring config JSON — fall through to default.
    }
  }

  return ALL_ENABLED;
}

/**
 * Fetch the captured CaseType row so `checkOutOfScope` can read
 * `is_in_scope`. Returns null when no case_type was captured.
 */
async function fetchCapturedCaseType(
  accountId: string,
  caseTypeSlug: string | null,
): Promise<CaseType | null> {
  if (!caseTypeSlug) return null;
  const rows = await db
    .select()
    .from(schema.caseTypes)
    .where(
      and(
        eq(schema.caseTypes.account_id, accountId),
        eq(schema.caseTypes.slug, caseTypeSlug),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // CaseType expects `sub_types: SubType[]`. The list isn't required by
  // checkOutOfScope (which only reads is_in_scope), so an empty list is
  // sufficient. Avoid the second query.
  return {
    id: row.id,
    account_id: row.account_id,
    slug: row.slug,
    label: row.label,
    position: row.position,
    is_in_scope: row.is_in_scope,
    created_at: row.created_at,
    sub_types: [],
  };
}

export interface ApplyAndPersistHardOverridesArgs {
  accountId: string;
  leadId: string;
  sopState: SOPState | null;
  /**
   * Optional: a pre-loaded leads row (e.g. from the immediately-prior
   * SELECT inside captureLead / updateLeadSOPState). When supplied,
   * this saves one Neon HTTP round trip per finalize. The caller
   * MUST guarantee that the passed row IS the row identified by
   * `leadId` and is current (no other writes have happened since
   * the SELECT).
   */
  preloadedLead?: Lead;
}

export interface ApplyAndPersistHardOverridesResult {
  /** Override rule names that fired (FIXED_ORDER), or empty if none. */
  firedRules: HardOverrideName[];
  /**
   * Final classification AFTER the override (downgrade applied if
   * any rule fired). Same as the previous classification when nothing
   * fired.
   */
  finalClassification: string;
}

/**
 * Apply hard overrides to a previously-persisted lead row. When any
 * rule fires:
 *   - `leads.classification` is downgraded to `'SPAM'`.
 *   - The fired rule names are appended (in FIXED_ORDER) to
 *     `leads.score_reasons_json`.
 *
 * Idempotent: calling twice for the same `(leadId, sopState)` won't
 * append duplicate rule names because `appendOverrideReasons`
 * dedups. The classification UPDATE is also a no-op when the row's
 * current classification is already 'SPAM'.
 *
 * Returns the fired rule names and the post-override classification
 * so callers can populate the structured-log emission.
 */
export async function applyAndPersistHardOverrides({
  accountId,
  leadId,
  sopState,
  preloadedLead,
}: ApplyAndPersistHardOverridesArgs): Promise<ApplyAndPersistHardOverridesResult> {
  // If the caller already loaded the row in the same transaction-ish
  // window, use it directly. Otherwise fetch.
  let leadRow: Lead;
  if (preloadedLead) {
    leadRow = preloadedLead;
  } else {
    const leadRows = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, leadId))
      .limit(1);
    if (leadRows.length === 0) {
      return { firedRules: [], finalClassification: 'COLD' };
    }
    leadRow = leadRows[0]! as unknown as Lead;
  }

  // Resolve toggles + caseType in parallel — independent reads, two
  // separate Neon HTTP round trips that don't need to be sequential.
  const caseTypeSlug = leadRow.case_type
    ?? sopState?.steps.find((s) => s.slug === 'case_type')?.captured_value
    ?? null;
  const subTypeSlug =
    sopState?.steps.find((s) => s.slug === 'sub_type')?.captured_value ?? null;
  const [enabled, caseType] = await Promise.all([
    resolveEnabledToggles(accountId, caseTypeSlug, subTypeSlug),
    fetchCapturedCaseType(accountId, caseTypeSlug),
  ]);

  // The combinator expects a Lead-shaped object. The `leads` row from
  // db has a slightly broader shape (DB columns map 1:1 to the Lead
  // schema fields the predicates read).
  const lead: Lead = leadRow as unknown as Lead;
  const outcome = applyHardOverrides({
    lead,
    sopState: sopState ?? makeEmptySOPState(),
    caseType,
    enabled,
  });

  if (outcome === null) {
    return {
      firedRules: [],
      finalClassification: leadRow.classification ?? 'COLD',
    };
  }

  const firedRules = outcome.firedRules;
  const newReasonsJson = appendOverrideReasons(
    leadRow.score_reasons_json,
    firedRules,
  );

  await db
    .update(schema.leads)
    .set({
      classification: 'SPAM',
      score_reasons_json: newReasonsJson,
    })
    .where(eq(schema.leads.id, leadId));

  return { firedRules, finalClassification: 'SPAM' };
}

/**
 * Defensive empty SOPState for `applyHardOverrides` when the caller
 * doesn't have one (LLM-fallback path with no SOP). The predicates
 * that read sopState (only `checkNoInjuryNoTreatment`) safely return
 * false on an empty steps[] / branch_state.
 */
function makeEmptySOPState(): SOPState {
  return {
    sop_configuration_id: '',
    sop_version: 0,
    conversation_anchor_iso: new Date().toISOString(),
    qualified_lead_threshold: 0,
    current_progress: 0,
    is_finalized: false,
    out_of_scope_termination: false,
    steps: [],
  };
}
