/**
 * Spec 016 — Branch lookup runtime contract.
 *
 * Resolves an `(account_id, case_type_slug, sub_type_slug)` tuple to
 * either an active configured Branch + its current published Version,
 * or `{ branch: null }` when no active configured branch with at
 * least one question exists for the pair.
 *
 * Called from the SOP advancer immediately after Step 6 (contact)
 * satisfies. When `{ branch: null }` is returned, the runtime
 * finalizes via the default-only path (FR-007). Otherwise the
 * runtime enters branch execution (FR-008).
 *
 * See: contracts/branch-runtime-contract.md §branch-lookup.ts.
 */

import { and, eq } from 'drizzle-orm';

import { db, schema } from '../../db/index.js';

export interface BranchLookupArgs {
  accountId: string;
  caseTypeSlug: string;
  subTypeSlug: string;
}

export interface ResolvedBranch {
  id: string;
  account_id: string;
  case_type_slug: string;
  sub_type_slug: string;
  is_active: boolean;
  current_version_id: string;
}

export interface ResolvedBranchVersion {
  id: string;
  branch_id: string;
  version_number: number;
  is_published: boolean;
  questions_json: string;
  classification_thresholds_json: string;
  hard_override_toggles_json: string;
}

export type BranchLookupResult =
  | { branch: ResolvedBranch; version: ResolvedBranchVersion }
  | { branch: null; version?: undefined };

/**
 * O(1) read keyed by the `(account_id, case_type_slug, sub_type_slug)`
 * UNIQUE index on `branches`, joined to the row's
 * `current_version_id` on `branch_versions`.
 *
 * Filtering rules (FR-007 / FR-009 / FR-011):
 *  - `branches.is_active = false` → null.
 *  - No `current_version_id` set (only drafts exist) → null.
 *  - Version's `questions_json` parses to an empty array → null.
 *  - Version's `questions_json` fails to parse → null (treated as
 *    "no branch configured" per FR-011 fail-safe; the runtime
 *    finalizes via the default-only path and a structured ERROR log
 *    is emitted upstream).
 */
export async function lookupBranch(
  args: BranchLookupArgs,
): Promise<BranchLookupResult> {
  const rows = await db
    .select({
      branch_id: schema.branches.id,
      branch_account_id: schema.branches.account_id,
      branch_case_type_slug: schema.branches.case_type_slug,
      branch_sub_type_slug: schema.branches.sub_type_slug,
      branch_is_active: schema.branches.is_active,
      branch_current_version_id: schema.branches.current_version_id,
      version_id: schema.branchVersions.id,
      version_branch_id: schema.branchVersions.branch_id,
      version_number: schema.branchVersions.version_number,
      version_is_published: schema.branchVersions.is_published,
      version_questions_json: schema.branchVersions.questions_json,
      version_thresholds_json: schema.branchVersions.classification_thresholds_json,
      version_overrides_json: schema.branchVersions.hard_override_toggles_json,
    })
    .from(schema.branches)
    .innerJoin(
      schema.branchVersions,
      eq(schema.branches.current_version_id, schema.branchVersions.id),
    )
    .where(
      and(
        eq(schema.branches.account_id, args.accountId),
        eq(schema.branches.case_type_slug, args.caseTypeSlug),
        eq(schema.branches.sub_type_slug, args.subTypeSlug),
      ),
    )
    .limit(1);

  if (rows.length === 0) return { branch: null };
  const row = rows[0];

  if (row.branch_is_active === false) return { branch: null };
  if (row.branch_current_version_id === null) return { branch: null };

  // Zero-questions edge case (data-model.md): treat as unconfigured.
  let questions: unknown;
  try {
    questions = JSON.parse(row.version_questions_json);
  } catch {
    return { branch: null };
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return { branch: null };
  }

  return {
    branch: {
      id: row.branch_id,
      account_id: row.branch_account_id,
      case_type_slug: row.branch_case_type_slug,
      sub_type_slug: row.branch_sub_type_slug,
      is_active: row.branch_is_active,
      current_version_id: row.branch_current_version_id,
    },
    version: {
      id: row.version_id,
      branch_id: row.version_branch_id,
      version_number: row.version_number,
      is_published: row.version_is_published,
      questions_json: row.version_questions_json,
      classification_thresholds_json: row.version_thresholds_json,
      hard_override_toggles_json: row.version_overrides_json,
    },
  };
}
