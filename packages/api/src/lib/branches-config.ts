/**
 * Spec 016 — server-side helpers used by `/dashboard/sop` page
 * (the SSR component) to preload the Branches tab without a
 * client round-trip.
 *
 * Mirrors the Promise.all pattern used by `getLatestSOP`,
 * `getCaseTypes`, and `getGoodbyePhrases`. Returns the same
 * `BranchPairSummary[]` shape that
 * `/api/dashboard/branches` GET emits, so the dashboard tab
 * client component can either consume the SSR-provided list
 * or call the API itself for refresh.
 */

import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import type { BranchPairSummary } from '@legal-chatbot/shared';

export async function listBranchPairsForAccount(
  accountId: string,
): Promise<BranchPairSummary[]> {
  const [caseTypes, subTypes, branches, publishedVersions] = await Promise.all([
    db
      .select({
        id: schema.caseTypes.id,
        slug: schema.caseTypes.slug,
        label: schema.caseTypes.label,
        position: schema.caseTypes.position,
      })
      .from(schema.caseTypes)
      .where(eq(schema.caseTypes.account_id, accountId))
      .orderBy(asc(schema.caseTypes.position)),
    db
      .select({
        id: schema.subTypes.id,
        case_type_id: schema.subTypes.case_type_id,
        slug: schema.subTypes.slug,
        label: schema.subTypes.label,
        position: schema.subTypes.position,
      })
      .from(schema.subTypes)
      .innerJoin(schema.caseTypes, eq(schema.subTypes.case_type_id, schema.caseTypes.id))
      .where(eq(schema.caseTypes.account_id, accountId))
      .orderBy(asc(schema.subTypes.position)),
    db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.account_id, accountId)),
    db
      .select({
        id: schema.branchVersions.id,
        branch_id: schema.branchVersions.branch_id,
        version_number: schema.branchVersions.version_number,
        is_published: schema.branchVersions.is_published,
        questions_json: schema.branchVersions.questions_json,
      })
      .from(schema.branchVersions)
      .innerJoin(schema.branches, eq(schema.branchVersions.branch_id, schema.branches.id))
      .where(
        and(
          eq(schema.branches.account_id, accountId),
          eq(schema.branchVersions.is_published, true),
        ),
      ),
  ]);

  const caseTypesById = new Map(caseTypes.map((ct) => [ct.id, ct]));
  const branchByPair = new Map<string, (typeof branches)[number]>();
  for (const b of branches) {
    branchByPair.set(`${b.case_type_slug}::${b.sub_type_slug}`, b);
  }
  const publishedByBranchId = new Map<string, (typeof publishedVersions)[number]>();
  for (const v of publishedVersions) publishedByBranchId.set(v.branch_id, v);

  const pairs: BranchPairSummary[] = [];
  for (const sub of subTypes) {
    const ct = caseTypesById.get(sub.case_type_id);
    if (!ct) continue;
    const branch = branchByPair.get(`${ct.slug}::${sub.slug}`) ?? null;

    let summary: BranchPairSummary['branch'] = null;
    if (branch !== null) {
      const published = branch.current_version_id
        ? publishedByBranchId.get(branch.id)
        : undefined;
      let questionsCount = 0;
      if (published) {
        try {
          const arr = JSON.parse(published.questions_json) as unknown[];
          questionsCount = Array.isArray(arr) ? arr.length : 0;
        } catch {
          questionsCount = 0;
        }
      }
      summary = {
        id: branch.id,
        is_active: branch.is_active,
        current_version_id: branch.current_version_id,
        version_number: published?.version_number ?? null,
        questions_count: questionsCount,
        is_published: published?.is_published ?? false,
        updated_at: Number(new Date(branch.updated_at)),
      };
    }

    pairs.push({
      case_type_slug: ct.slug,
      case_type_label: ct.label,
      sub_type_slug: sub.slug,
      sub_type_label: sub.label,
      branch: summary,
    });
  }

  return pairs;
}
