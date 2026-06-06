/**
 * Spec 016 — Idempotent boot-time remediation that ensures every
 * account's seeded `(personal_injury, car_accident)` sub_type has a
 * corresponding active `branches` row plus a published
 * `branch_versions` row populated with the spec 015 scoring questions
 * (relocated to `CAR_ACCIDENT_BRANCH_QUESTIONS_JSON`), thresholds, and
 * hard-override toggles.
 *
 * This replaces `ensure-car-accident-scoring.ts` from spec 015. The
 * spec 015 function inserted 9 SOP steps + scoring_config_json into
 * `sub_types`; spec 016 supersedes that model entirely (FR-029,
 * research.md R2).
 *
 * Behaviour:
 *  - Iterate every account.
 *  - For each account, look up the (personal_injury, car_accident)
 *    sub_type by slug pair. If it doesn't exist → outcome
 *    `no_car_accident_subtype`.
 *  - If a `branches` row already exists for the pair → outcome
 *    `skipped_already_present` (idempotent no-op).
 *  - Otherwise insert one `branches` row + one published
 *    `branch_versions` row using the seeded JSON fixtures from
 *    `seed-defaults/sop.ts`.
 *
 * Safe to run multiple times. Multi-account: processes accounts in
 * series; account-isolated. Per Constitution IV the function uses
 * neon-http (no transactions); partial-failure recovery is by
 * re-running.
 *
 * CLI usage:
 *   pnpm --filter @legal-chatbot/api db:ensure-car-accident-branch
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db, schema } from './index.js';
import {
  CAR_ACCIDENT_BRANCH_HARD_OVERRIDES_JSON,
  CAR_ACCIDENT_BRANCH_QUESTIONS_JSON,
  CAR_ACCIDENT_BRANCH_THRESHOLDS_JSON,
} from './seed-defaults/sop.js';

export type CarAccidentBranchMigrationOutcome =
  | 'inserted'
  | 'skipped_already_present'
  | 'no_car_accident_subtype';

export interface CarAccidentBranchMigrationResult {
  account_id: string;
  outcome: CarAccidentBranchMigrationOutcome;
  branch_id?: string;
  branch_version_id?: string;
}

export async function ensureCarAccidentBranchForAccount(
  accountId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<CarAccidentBranchMigrationResult> {
  // Confirm the (personal_injury, car_accident) sub_type exists for the account.
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
        eq(schema.caseTypes.slug, 'personal_injury'),
        eq(schema.subTypes.slug, 'car_accident'),
      ),
    )
    .limit(1);

  if (subTypeRows.length === 0) {
    return { account_id: accountId, outcome: 'no_car_accident_subtype' };
  }

  // Idempotency check.
  const existing = await db
    .select({ id: schema.branches.id })
    .from(schema.branches)
    .where(
      and(
        eq(schema.branches.account_id, accountId),
        eq(schema.branches.case_type_slug, 'personal_injury'),
        eq(schema.branches.sub_type_slug, 'car_accident'),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return {
      account_id: accountId,
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
    case_type_slug: 'personal_injury',
    sub_type_slug: 'car_accident',
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
    questions_json: CAR_ACCIDENT_BRANCH_QUESTIONS_JSON,
    classification_thresholds_json: CAR_ACCIDENT_BRANCH_THRESHOLDS_JSON,
    hard_override_toggles_json: CAR_ACCIDENT_BRANCH_HARD_OVERRIDES_JSON,
    published_at: ts,
    created_at: ts,
    created_by_user_id: 'system_seed_016',
  });

  return {
    account_id: accountId,
    outcome: 'inserted',
    branch_id: branchId,
    branch_version_id: versionId,
  };
}

export async function ensureCarAccidentBranchForAllAccounts(): Promise<
  CarAccidentBranchMigrationResult[]
> {
  const results: CarAccidentBranchMigrationResult[] = [];
  const accountRows = await db.select({ id: schema.accounts.id }).from(schema.accounts);
  for (const acct of accountRows) {
    results.push(await ensureCarAccidentBranchForAccount(acct.id));
  }
  return results;
}

// CLI invocation.
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureCarAccidentBranchForAllAccounts()
    .then((results) => {
      const inserted = results.filter((r) => r.outcome === 'inserted').length;
      const skipped = results.filter((r) => r.outcome === 'skipped_already_present').length;
      const noSubType = results.filter((r) => r.outcome === 'no_car_accident_subtype').length;
      console.log(
        `Car-accident branch ensured: ${inserted} inserted, ${skipped} skipped, ${noSubType} accounts without car_accident sub_type.`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('ensureCarAccidentBranch failed:', err);
      process.exit(1);
    });
}
