/**
 * Spec 017 follow-up — Idempotent boot-time remediation that ensures
 * every account has a published Branch row for every default sub-type
 * shipped in `seed-defaults/branches.ts` (DUI, Criminal Defense,
 * non-car-accident Personal Injury, Drug Crime).
 *
 * Companion to `ensure-car-accident-branch.ts`. Family Law and Estate
 * Planning are intentionally excluded (no entries in
 * `DEFAULT_BRANCH_SEEDS`).
 *
 * Behaviour (per (account, sub-type) tuple):
 *  - Look up the matching `sub_types` row by (case_type_slug, sub_type_slug).
 *    If it doesn't exist → outcome `no_sub_type`. (Should never happen on
 *    accounts seeded by `seedSopForAccount`, which always inserts the full
 *    DEFAULT_CASE_TYPES taxonomy.)
 *  - If a `branches` row already exists for the pair → outcome
 *    `skipped_already_present` (idempotent no-op).
 *  - Otherwise insert one `branches` row + one published `branch_versions`
 *    row using the pre-serialised JSON fixtures from
 *    `seed-defaults/branches.ts`.
 *
 * Safe to run multiple times. Per Constitution IV: neon-http (no
 * transactions); partial-failure recovery is by re-running.
 *
 * CLI usage:
 *   pnpm --filter @legal-chatbot/api db:ensure-default-branches
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db, schema } from './index';
import {
  DEFAULT_BRANCH_SEEDS,
  type DefaultBranchSeed,
} from './seed-defaults/branches';

export type DefaultBranchMigrationOutcome =
  | 'inserted'
  | 'skipped_already_present'
  | 'no_sub_type';

export interface DefaultBranchMigrationResult {
  account_id: string;
  case_type_slug: string;
  sub_type_slug: string;
  outcome: DefaultBranchMigrationOutcome;
  branch_id?: string;
  branch_version_id?: string;
}

/**
 * Ensure a single (account, sub-type) Branch exists. Idempotent.
 */
export async function ensureDefaultBranchForAccount(
  accountId: string,
  seed: DefaultBranchSeed,
  now: () => string = () => new Date().toISOString(),
): Promise<DefaultBranchMigrationResult> {
  // Confirm the (case_type, sub_type) sub_type exists for the account.
  const subTypeRows = await db
    .select({ sub_type_slug: schema.subTypes.slug })
    .from(schema.subTypes)
    .innerJoin(
      schema.caseTypes,
      eq(schema.subTypes.case_type_id, schema.caseTypes.id),
    )
    .where(
      and(
        eq(schema.caseTypes.account_id, accountId),
        eq(schema.caseTypes.slug, seed.case_type_slug),
        eq(schema.subTypes.slug, seed.sub_type_slug),
      ),
    )
    .limit(1);

  if (subTypeRows.length === 0) {
    return {
      account_id: accountId,
      case_type_slug: seed.case_type_slug,
      sub_type_slug: seed.sub_type_slug,
      outcome: 'no_sub_type',
    };
  }

  // Idempotency check.
  const existing = await db
    .select({ id: schema.branches.id })
    .from(schema.branches)
    .where(
      and(
        eq(schema.branches.account_id, accountId),
        eq(schema.branches.case_type_slug, seed.case_type_slug),
        eq(schema.branches.sub_type_slug, seed.sub_type_slug),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return {
      account_id: accountId,
      case_type_slug: seed.case_type_slug,
      sub_type_slug: seed.sub_type_slug,
      outcome: 'skipped_already_present',
      branch_id: existing[0].id,
    };
  }

  const branchId = nanoid();
  const versionId = nanoid();
  const ts = now();

  await db.insert(schema.branches).values({
    id: branchId,
    account_id: accountId,
    case_type_slug: seed.case_type_slug,
    sub_type_slug: seed.sub_type_slug,
    is_active: true,
    current_version_id: versionId,
    created_at: ts,
    updated_at: ts,
  });

  await db.insert(schema.branchVersions).values({
    id: versionId,
    branch_id: branchId,
    version_number: 1,
    is_published: true,
    questions_json: seed.questions_json,
    classification_thresholds_json: seed.classification_thresholds_json,
    hard_override_toggles_json: seed.hard_override_toggles_json,
    published_at: ts,
    created_at: ts,
    created_by_user_id: 'system_seed_017',
  });

  return {
    account_id: accountId,
    case_type_slug: seed.case_type_slug,
    sub_type_slug: seed.sub_type_slug,
    outcome: 'inserted',
    branch_id: branchId,
    branch_version_id: versionId,
  };
}

/**
 * Ensure every default branch (DEFAULT_BRANCH_SEEDS) exists for one
 * account. Returns one result per (account, seed) tuple in source order.
 */
export async function ensureDefaultBranchesForAccount(
  accountId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<DefaultBranchMigrationResult[]> {
  const results: DefaultBranchMigrationResult[] = [];
  for (const seed of DEFAULT_BRANCH_SEEDS) {
    results.push(await ensureDefaultBranchForAccount(accountId, seed, now));
  }
  return results;
}

/**
 * Run for every account in the database. Used by `bootstrap-prod.ts`
 * step 3d and by the standalone CLI below.
 */
export async function ensureDefaultBranchesForAllAccounts(): Promise<
  DefaultBranchMigrationResult[]
> {
  const results: DefaultBranchMigrationResult[] = [];
  const accountRows = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts);
  for (const acct of accountRows) {
    const perAccount = await ensureDefaultBranchesForAccount(acct.id);
    results.push(...perAccount);
  }
  return results;
}

// CLI invocation.
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureDefaultBranchesForAllAccounts()
    .then((results) => {
      const inserted = results.filter((r) => r.outcome === 'inserted').length;
      const skipped = results.filter(
        (r) => r.outcome === 'skipped_already_present',
      ).length;
      const noSubType = results.filter((r) => r.outcome === 'no_sub_type').length;
      console.log(
        `Default branches ensured: ${inserted} inserted, ${skipped} skipped, ` +
          `${noSubType} (account, sub-type) tuples missing the sub_type row. ` +
          `${results.length} total tuples processed.`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('ensureDefaultBranches failed:', err);
      process.exit(1);
    });
}
