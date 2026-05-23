/**
 * SOP configuration loaders (010-sop-workflow Phase 3b + Phase 8 T069).
 *
 * Account-scoped reads of the SOP configuration tables. Mirrors the
 * pattern in `lib/config.ts` but for the SOP runtime.
 *
 * Returns null when an account has no published SOP — this is a real
 * state during the lazy-migration window for legacy accounts (R11) and
 * the consumers must handle it gracefully.
 */
import { db, schema } from '../db';
import { eq, and, desc, asc } from 'drizzle-orm';
import type { SOPConfiguration, CaseType, ChipSource } from '@legal-chatbot/shared';

type SopConfigurationRow = typeof schema.sopConfigurations.$inferSelect;
type SopStepRow = typeof schema.sopSteps.$inferSelect;

/**
 * Hydrate a config row + its step rows into the public SOPConfiguration
 * shape. Pure mapping, exported for tests but mostly an internal helper.
 */
function hydrateSOP(cfgRow: SopConfigurationRow, stepRows: SopStepRow[]): SOPConfiguration {
  return {
    id: cfgRow.id,
    account_id: cfgRow.account_id,
    version: cfgRow.version,
    qualified_lead_threshold: cfgRow.qualified_lead_threshold,
    is_published: cfgRow.is_published,
    derived_from_legacy: cfgRow.derived_from_legacy,
    created_at: cfgRow.created_at,
    steps: stepRows.map((s) => ({
      id: s.id,
      sop_configuration_id: s.sop_configuration_id,
      position: s.position,
      slug: s.slug,
      question_text: s.question_text,
      chip_source: (s.chip_source as ChipSource) ?? null,
      inline_chips_json: s.inline_chips_json,
      accepts_free_text: s.accepts_free_text,
      is_required: s.is_required,
      counts_toward_threshold: s.counts_toward_threshold,
      is_default: s.is_default,
      skip_condition_json: s.skip_condition_json,
    })),
  };
}

async function loadStepsForConfig(configId: string): Promise<SopStepRow[]> {
  return db
    .select()
    .from(schema.sopSteps)
    .where(eq(schema.sopSteps.sop_configuration_id, configId))
    .orderBy(asc(schema.sopSteps.position));
}

/**
 * Get the currently-published SOP for an account, with steps inlined in
 * position order. Returns null if no published SOP exists.
 */
export async function getPublishedSOP(accountId: string): Promise<SOPConfiguration | null> {
  const cfgRows = await db
    .select()
    .from(schema.sopConfigurations)
    .where(
      and(
        eq(schema.sopConfigurations.account_id, accountId),
        eq(schema.sopConfigurations.is_published, true),
      ),
    )
    .orderBy(desc(schema.sopConfigurations.version))
    .limit(1);

  const cfgRow = cfgRows[0];
  if (!cfgRow) return null;

  const stepRows = await loadStepsForConfig(cfgRow.id);
  return hydrateSOP(cfgRow, stepRows);
}

/**
 * Get the latest SOP for an account regardless of `is_published`. Used by
 * Preview & Test mode (010-sop-workflow T069) so the lawyer can chat
 * against an unpublished draft before publishing it. Returns null if the
 * account has no SOP at all.
 */
export async function getLatestSOP(accountId: string): Promise<SOPConfiguration | null> {
  const cfgRows = await db
    .select()
    .from(schema.sopConfigurations)
    .where(eq(schema.sopConfigurations.account_id, accountId))
    .orderBy(desc(schema.sopConfigurations.version))
    .limit(1);

  const cfgRow = cfgRows[0];
  if (!cfgRow) return null;

  const stepRows = await loadStepsForConfig(cfgRow.id);
  return hydrateSOP(cfgRow, stepRows);
}

/**
 * List an account's case types with sub-types nested. Sorted by position.
 */
export async function getCaseTypes(accountId: string): Promise<CaseType[]> {
  const ctRows = await db
    .select()
    .from(schema.caseTypes)
    .where(eq(schema.caseTypes.account_id, accountId))
    .orderBy(asc(schema.caseTypes.position));

  if (ctRows.length === 0) return [];

  // Fetch all sub-types for these case types in a single query for efficiency.
  const allSubRows = await db
    .select()
    .from(schema.subTypes)
    .orderBy(asc(schema.subTypes.position));

  return ctRows.map((ct) => ({
    id: ct.id,
    account_id: ct.account_id,
    slug: ct.slug,
    label: ct.label,
    position: ct.position,
    is_in_scope: ct.is_in_scope,
    created_at: ct.created_at,
    sub_types: allSubRows
      .filter((st) => st.case_type_id === ct.id)
      .map((st) => ({
        id: st.id,
        case_type_id: st.case_type_id,
        slug: st.slug,
        label: st.label,
        position: st.position,
        created_at: st.created_at,
      })),
  }));
}

/**
 * List an account's goodbye phrases as a plain string array.
 */
export async function getGoodbyePhrases(accountId: string): Promise<string[]> {
  const rows = await db
    .select({ phrase: schema.goodbyePhrases.phrase })
    .from(schema.goodbyePhrases)
    .where(eq(schema.goodbyePhrases.account_id, accountId));
  return rows.map((r) => r.phrase);
}

/**
 * Convenience: load all SOP-related rows for an account in one call.
 * Used by the chat route on every turn.
 *
 * `isPreview=true` selects the latest SOP (published OR draft) so that
 * Preview & Test (Phase 6 §8.10) reflects the lawyer's unpublished
 * draft work. Otherwise the published SOP is used (010-sop-workflow T069).
 *
 * Case-types and goodbye-phrases are NOT versioned — both modes read the
 * same live rows. (Versioning the chip libraries was scoped out at plan
 * time; the editor saves them transactionally and changes go live
 * immediately, mirroring how /dashboard/config saves work.)
 */
export async function getSOPBundle(
  accountId: string,
  options: { isPreview?: boolean } = {},
): Promise<{
  sop: SOPConfiguration | null;
  caseTypes: CaseType[];
  goodbyePhrases: string[];
}> {
  const sopLoader = options.isPreview ? getLatestSOP : getPublishedSOP;
  const [sop, caseTypes, goodbyePhrases] = await Promise.all([
    sopLoader(accountId),
    getCaseTypes(accountId),
    getGoodbyePhrases(accountId),
  ]);
  return { sop, caseTypes, goodbyePhrases };
}
