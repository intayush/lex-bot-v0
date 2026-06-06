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

import { db, schema } from '../../db';
import type { Branch, BranchVersion } from '@legal-chatbot/shared';

export interface BranchLookupArgs {
  accountId: string;
  caseTypeSlug: string;
  subTypeSlug: string;
}

export type BranchLookupResult =
  | { branch: Branch; version: BranchVersion }
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
      branch_created_at: schema.branches.created_at,
      branch_updated_at: schema.branches.updated_at,
      version_id: schema.branchVersions.id,
      version_branch_id: schema.branchVersions.branch_id,
      version_number: schema.branchVersions.version_number,
      version_is_published: schema.branchVersions.is_published,
      version_questions_json: schema.branchVersions.questions_json,
      version_thresholds_json: schema.branchVersions.classification_thresholds_json,
      version_overrides_json: schema.branchVersions.hard_override_toggles_json,
      version_published_at: schema.branchVersions.published_at,
      version_created_at: schema.branchVersions.created_at,
      version_created_by: schema.branchVersions.created_by_user_id,
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
      created_at: Number(new Date(row.branch_created_at)),
      updated_at: Number(new Date(row.branch_updated_at)),
    },
    version: {
      id: row.version_id,
      branch_id: row.version_branch_id,
      version_number: row.version_number,
      is_published: row.version_is_published,
      questions: questions as BranchVersion['questions'],
      classification_thresholds: JSON.parse(
        row.version_thresholds_json,
      ) as BranchVersion['classification_thresholds'],
      hard_override_toggles: JSON.parse(
        row.version_overrides_json,
      ) as BranchVersion['hard_override_toggles'],
      published_at:
        row.version_published_at === null
          ? null
          : Number(new Date(row.version_published_at)),
      created_at: Number(new Date(row.version_created_at)),
      created_by_user_id: row.version_created_by,
    },
  };
}

