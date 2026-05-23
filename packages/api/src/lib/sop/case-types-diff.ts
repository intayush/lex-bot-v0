/**
 * Pure diff helper for the dashboard case-types-save Route Handler
 * (`POST /api/dashboard/sop/case-types`).
 *
 * Given the existing rows for an account and the incoming list from the
 * dashboard, computes a transactional plan:
 *   - Insert new case-types (slug not in existing).
 *   - Update existing case-types (slug match; label/position/is_in_scope drift).
 *   - Delete case-types missing from incoming (cascade-delete sub-types).
 *   - Same diff applied to sub-types per case-type, with two flavors:
 *     - `subTypeInsertsForExistingParents` keyed by `case_type_id`
 *     - `subTypeInsertsForNewParents` keyed by `parent_slug` (id assigned
 *       inside the transaction after the parent INSERT).
 *
 * Source of truth: contracts/sop-config-routes-contract.md (case-types diff
 * behavior) + data-model.md (cascade-delete on case_type → sub_types).
 */

export type CaseTypeRow = {
  id: string;
  slug: string;
  label: string;
  position: number;
  is_in_scope: boolean;
};

export type SubTypeRow = {
  id: string;
  case_type_id: string;
  slug: string;
  label: string;
  position: number;
};

export type SubTypeIncoming = {
  slug: string;
  label: string;
  position: number;
};

export type CaseTypeIncoming = {
  slug: string;
  label: string;
  position: number;
  is_in_scope: boolean;
  sub_types: readonly SubTypeIncoming[];
};

export type CaseTypeInsert = {
  slug: string;
  label: string;
  position: number;
  is_in_scope: boolean;
};

export type CaseTypeUpdate = {
  id: string;
  label: string;
  position: number;
  is_in_scope: boolean;
};

export type CaseTypeDelete = {
  id: string;
};

export type SubTypeInsertForNewParent = {
  parent_slug: string;
  slug: string;
  label: string;
  position: number;
};

export type SubTypeInsertForExistingParent = {
  case_type_id: string;
  slug: string;
  label: string;
  position: number;
};

export type SubTypeUpdate = {
  id: string;
  label: string;
  position: number;
};

export type SubTypeDelete = {
  id: string;
};

export type CaseTypesDiffPlan = {
  caseTypeInserts: CaseTypeInsert[];
  caseTypeUpdates: CaseTypeUpdate[];
  caseTypeDeletes: CaseTypeDelete[];
  subTypeInsertsForNewParents: SubTypeInsertForNewParent[];
  subTypeInsertsForExistingParents: SubTypeInsertForExistingParent[];
  subTypeUpdates: SubTypeUpdate[];
  subTypeDeletes: SubTypeDelete[];
};

export function diffCaseTypes(input: {
  existing: readonly CaseTypeRow[];
  existingSubTypes: readonly SubTypeRow[];
  incoming: readonly CaseTypeIncoming[];
}): CaseTypesDiffPlan {
  const { existing, existingSubTypes, incoming } = input;

  // Validate uniqueness on incoming side. Throws so the Route Handler
  // can return a 400 with the message.
  const incomingSlugs = new Set<string>();
  for (const ct of incoming) {
    if (incomingSlugs.has(ct.slug)) {
      throw new Error(`Duplicate case-type slug in incoming list: "${ct.slug}".`);
    }
    incomingSlugs.add(ct.slug);
    const stSlugs = new Set<string>();
    for (const st of ct.sub_types) {
      if (stSlugs.has(st.slug)) {
        throw new Error(`Duplicate sub-type slug "${st.slug}" within case-type "${ct.slug}".`);
      }
      stSlugs.add(st.slug);
    }
  }

  const existingBySlug = new Map<string, CaseTypeRow>();
  for (const row of existing) existingBySlug.set(row.slug, row);

  const subTypesByParentId = new Map<string, SubTypeRow[]>();
  for (const row of existingSubTypes) {
    const list = subTypesByParentId.get(row.case_type_id);
    if (list) list.push(row);
    else subTypesByParentId.set(row.case_type_id, [row]);
  }

  const plan: CaseTypesDiffPlan = {
    caseTypeInserts: [],
    caseTypeUpdates: [],
    caseTypeDeletes: [],
    subTypeInsertsForNewParents: [],
    subTypeInsertsForExistingParents: [],
    subTypeUpdates: [],
    subTypeDeletes: [],
  };

  // Pass 1: walk incoming → insert / update.
  for (const ct of incoming) {
    const existingMatch = existingBySlug.get(ct.slug);
    if (!existingMatch) {
      plan.caseTypeInserts.push({
        slug: ct.slug,
        label: ct.label,
        position: ct.position,
        is_in_scope: ct.is_in_scope,
      });
      // All its sub-types are inserts under the new (about-to-be-created) parent.
      for (const st of ct.sub_types) {
        plan.subTypeInsertsForNewParents.push({
          parent_slug: ct.slug,
          slug: st.slug,
          label: st.label,
          position: st.position,
        });
      }
      continue;
    }

    // Update only if any field drifted.
    if (
      existingMatch.label !== ct.label
      || existingMatch.position !== ct.position
      || existingMatch.is_in_scope !== ct.is_in_scope
    ) {
      plan.caseTypeUpdates.push({
        id: existingMatch.id,
        label: ct.label,
        position: ct.position,
        is_in_scope: ct.is_in_scope,
      });
    }

    // Diff sub-types under this existing parent.
    const existingSubsForParent = subTypesByParentId.get(existingMatch.id) ?? [];
    const existingSubBySlug = new Map<string, SubTypeRow>();
    for (const st of existingSubsForParent) existingSubBySlug.set(st.slug, st);

    const incomingSubSlugs = new Set<string>();
    for (const st of ct.sub_types) {
      incomingSubSlugs.add(st.slug);
      const existingSt = existingSubBySlug.get(st.slug);
      if (!existingSt) {
        plan.subTypeInsertsForExistingParents.push({
          case_type_id: existingMatch.id,
          slug: st.slug,
          label: st.label,
          position: st.position,
        });
      } else if (existingSt.label !== st.label || existingSt.position !== st.position) {
        plan.subTypeUpdates.push({
          id: existingSt.id,
          label: st.label,
          position: st.position,
        });
      }
    }
    // Sub-types under this parent that aren't in incoming → delete.
    for (const existingSt of existingSubsForParent) {
      if (!incomingSubSlugs.has(existingSt.slug)) {
        plan.subTypeDeletes.push({ id: existingSt.id });
      }
    }
  }

  // Pass 2: existing case-types not in incoming → delete (and cascade their sub-types).
  for (const existingCt of existing) {
    if (!incomingSlugs.has(existingCt.slug)) {
      plan.caseTypeDeletes.push({ id: existingCt.id });
      const subs = subTypesByParentId.get(existingCt.id) ?? [];
      for (const st of subs) {
        plan.subTypeDeletes.push({ id: st.id });
      }
    }
  }

  return plan;
}
