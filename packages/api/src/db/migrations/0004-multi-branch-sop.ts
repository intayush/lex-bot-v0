/**
 * Spec 016 — Multi-Branch SOP Workflow data migration.
 *
 * Phase B of the 0004 migration: copy every existing
 * `sub_types.scoring_config_json` row into a new `branches` row plus a
 * published `branch_versions` row, so spec 015's seeded car-accident
 * scoring carries forward verbatim into the new model (FR-029).
 *
 * Idempotent: re-running is a no-op because the
 * `(account_id, case_type_slug, sub_type_slug)` UNIQUE index on
 * `branches` rejects duplicate inserts.
 *
 * The Drizzle SQL migration (`drizzle/0004_multi_branch_sop.sql`)
 * created the new tables and the new `leads` columns; this function
 * fills the new tables with the data that already exists in the legacy
 * `sub_types.scoring_config_json` column. The legacy column is NOT
 * dropped — see research.md R2 for the rollback rationale.
 *
 * Spec 016 questions / chips / weights for the seeded
 * (personal_injury, car_accident) branch live on the existing
 * `sop_steps` rows (positions 5–13 from spec 015); this migration
 * does NOT reshape `sop_steps`. Instead, the seeded `branches` row
 * points at a `branch_versions` row whose `questions_json` is built
 * from the live `sop_steps` rows for that account at migration time.
 *
 * Per FR-016: "No score regressions versus spec 015 are permitted for
 * this branch." This function is the contract between spec 015 and
 * spec 016 runtimes.
 *
 * Public surface: `runMultiBranchSopDataMigration(deps)` returns a
 * per-account outcome array. Called from `migrate.ts` after Drizzle
 * applies the SQL migrations.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { branches, branchVersions, accounts, caseTypes, subTypes, sopSteps, sopConfigurations } from '../schema';
import type { db as ProductionDb } from '../index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MultiBranchMigrationOutcome =
  | 'inserted'
  | 'skipped_already_present'
  | 'skipped_no_scoring_config';

export interface MultiBranchMigrationResult {
  account_id: string;
  case_type_slug: string;
  sub_type_slug: string;
  outcome: MultiBranchMigrationOutcome;
  branch_id?: string;
  version_id?: string;
}

export interface MultiBranchMigrationDeps {
  db: typeof ProductionDb;
  /** Override for tests; production callers omit. */
  now?: () => string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Walk every (account, sub_type-with-scoring_config_json) tuple and
 * create the corresponding Branch + published BranchVersion. Skips
 * tuples that already have a Branch row (idempotency).
 *
 * The version's `questions_json` is built lazily by reading the live
 * spec 015 SOP steps for this sub_type at migration time. If those
 * steps don't exist (e.g., admin removed them), the branch is still
 * created with an empty `questions` array, which the runtime treats
 * as "no branch configured" per the spec 016 zero-questions edge case.
 */
export async function runMultiBranchSopDataMigration(
  deps: MultiBranchMigrationDeps,
): Promise<MultiBranchMigrationResult[]> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  const results: MultiBranchMigrationResult[] = [];

  // Find every sub_type that has a non-null scoring_config_json (these
  // are the seeded car-accident rows from spec 015 plus any custom
  // ones an admin added).
  const subTypeRows = await db
    .select({
      sub_type_id: subTypes.id,
      sub_type_slug: subTypes.slug,
      sub_type_scoring: subTypes.scoring_config_json,
      case_type_id: subTypes.case_type_id,
      case_type_slug: caseTypes.slug,
      account_id: caseTypes.account_id,
    })
    .from(subTypes)
    .innerJoin(caseTypes, eq(subTypes.case_type_id, caseTypes.id))
    .where(isNotNull(subTypes.scoring_config_json));

  for (const row of subTypeRows) {
    if (row.sub_type_scoring === null) {
      results.push({
        account_id: row.account_id,
        case_type_slug: row.case_type_slug,
        sub_type_slug: row.sub_type_slug,
        outcome: 'skipped_no_scoring_config',
      });
      continue;
    }

    // Idempotency check.
    const existing = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.account_id, row.account_id),
          eq(branches.case_type_slug, row.case_type_slug),
          eq(branches.sub_type_slug, row.sub_type_slug),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      results.push({
        account_id: row.account_id,
        case_type_slug: row.case_type_slug,
        sub_type_slug: row.sub_type_slug,
        outcome: 'skipped_already_present',
        branch_id: existing[0].id,
      });
      continue;
    }

    // Build the questions array from live spec-015 sop_steps.
    // Spec 015 placed the 8 scoring questions at positions 5–13 with
    // `applies_when_sub_type_slug = '<sub_type_slug>'`; we read those
    // rows for this account's published SOP and project them into the
    // BranchQuestion shape.
    const publishedSop = await db
      .select({ id: sopConfigurations.id })
      .from(sopConfigurations)
      .where(
        and(
          eq(sopConfigurations.account_id, row.account_id),
          eq(sopConfigurations.is_published, true),
        ),
      )
      .limit(1);

    const stepsForBranch = publishedSop.length === 0
      ? []
      : await db
          .select({
            slug: sopSteps.slug,
            position: sopSteps.position,
            question_text: sopSteps.question_text,
            inline_chips_json: sopSteps.inline_chips_json,
            applies_when_sub_type_slug: sopSteps.applies_when_sub_type_slug,
          })
          .from(sopSteps)
          .where(
            and(
              eq(sopSteps.sop_configuration_id, publishedSop[0].id),
              eq(sopSteps.applies_when_sub_type_slug, row.sub_type_slug),
            ),
          );

    const questions = stepsForBranch
      .sort((a, b) => a.position - b.position)
      .map((step, idx) => {
        let chips: Array<{ slug: string; label: string; score_weight: number }> = [];
        if (step.inline_chips_json) {
          try {
            const parsed = JSON.parse(step.inline_chips_json) as Array<{
              slug: string;
              label: string;
              score_weight?: number;
            }>;
            chips = parsed
              .filter((c) => typeof c.score_weight === 'number')
              .map((c) => ({ slug: c.slug, label: c.label, score_weight: c.score_weight as number }));
          } catch {
            chips = [];
          }
        }
        return {
          id: step.slug,
          position: idx,
          text: step.question_text,
          preface: null as string | null,
          chips,
          free_text_allowed: chips.length === 0,
          multi_select: false,
        };
      });

    // Materialize the version row with the spec 015 thresholds + toggles
    // unpacked from scoring_config_json (validated by runtime later;
    // here we trust the spec 015 producer).
    const scoringConfig = JSON.parse(row.sub_type_scoring) as {
      thresholds_self: unknown;
      thresholds_family_friend: unknown;
      hard_overrides_enabled: unknown;
    };

    const branchId = nanoid();
    const versionId = nanoid();
    const ts = now();

    await db.insert(branches).values({
      id: branchId,
      account_id: row.account_id,
      case_type_slug: row.case_type_slug,
      sub_type_slug: row.sub_type_slug,
      is_active: true,
      current_version_id: versionId,
      created_at: ts,
      updated_at: ts,
    });

    await db.insert(branchVersions).values({
      id: versionId,
      branch_id: branchId,
      version_number: 1,
      is_published: true,
      questions_json: JSON.stringify(questions),
      classification_thresholds_json: JSON.stringify({
        self: scoringConfig.thresholds_self,
        family_friend: scoringConfig.thresholds_family_friend,
      }),
      hard_override_toggles_json: JSON.stringify(scoringConfig.hard_overrides_enabled),
      published_at: ts,
      created_at: ts,
      created_by_user_id: 'system_migration_0004',
    });

    results.push({
      account_id: row.account_id,
      case_type_slug: row.case_type_slug,
      sub_type_slug: row.sub_type_slug,
      outcome: 'inserted',
      branch_id: branchId,
      version_id: versionId,
    });
  }

  return results;
}
