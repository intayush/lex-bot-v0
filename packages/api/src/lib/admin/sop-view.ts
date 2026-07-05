/**
 * 027-platform-admin-console — read-only SOP flow assembler (US5).
 *
 * Builds a normalized `SopFlowView` tree for a tenant's active (published) SOP:
 * steps → case types → sub-types → configured branch questions. Pure read; no
 * mutation. Sourced from sopConfigurations/sopSteps/caseTypes/subTypes/
 * branches/branchVersions. Returns null when the tenant has no published SOP.
 */
import { and, eq, desc } from 'drizzle-orm';
import { db, schema } from '../../db/index';

export interface SopFlowView {
  version: number;
  qualifiedLeadThreshold: number;
  steps: {
    position: number;
    slug: string;
    questionText: string;
    chipSource: string | null;
    appliesWhenSubTypeSlug: string | null;
    isRequired: boolean;
    countsTowardThreshold: boolean;
  }[];
  caseTypes: {
    slug: string;
    label: string;
    subTypes: {
      slug: string;
      label: string;
      branch: {
        questions: { position: number; text: string; chips: { label: string; weight: number }[] }[];
      } | null;
    }[];
  }[];
}

export async function getSopFlowView(accountId: string): Promise<SopFlowView | null> {
  // Latest published SOP configuration (fall back to latest if none published).
  const published = await db
    .select()
    .from(schema.sopConfigurations)
    .where(and(eq(schema.sopConfigurations.account_id, accountId), eq(schema.sopConfigurations.is_published, true)))
    .orderBy(desc(schema.sopConfigurations.version));
  const sop = published[0];
  if (!sop) return null;

  const steps = await db
    .select()
    .from(schema.sopSteps)
    .where(eq(schema.sopSteps.sop_configuration_id, sop.id));

  const caseTypes = await db
    .select()
    .from(schema.caseTypes)
    .where(eq(schema.caseTypes.account_id, accountId));

  // Branches for this account, plus their current published version questions.
  const branches = await db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.account_id, accountId));

  // Map (case_type_slug, sub_type_slug) → questions[].
  const branchQuestions = new Map<string, { position: number; text: string; chips: { label: string; weight: number }[] }[]>();
  for (const b of branches) {
    if (!b.current_version_id) continue;
    const versions = await db
      .select()
      .from(schema.branchVersions)
      .where(eq(schema.branchVersions.id, b.current_version_id));
    const v = versions[0];
    if (!v) continue;
    try {
      const questions = JSON.parse(v.questions_json) as Array<{
        position: number;
        text: string;
        chips: Array<{ label: string; score_weight: number }>;
      }>;
      branchQuestions.set(
        `${b.case_type_slug}::${b.sub_type_slug}`,
        questions
          .map((q) => ({
            position: q.position,
            text: q.text,
            chips: (q.chips ?? []).map((c) => ({ label: c.label, weight: c.score_weight })),
          }))
          .sort((a, z) => a.position - z.position),
      );
    } catch {
      // Skip malformed version JSON rather than fail the whole view.
    }
  }

  const caseTypeViews = [];
  for (const ct of caseTypes.sort((a, b) => a.position - b.position)) {
    const subs = await db
      .select()
      .from(schema.subTypes)
      .where(eq(schema.subTypes.case_type_id, ct.id));
    caseTypeViews.push({
      slug: ct.slug,
      label: ct.label,
      subTypes: subs
        .sort((a, b) => a.position - b.position)
        .map((st) => {
          const questions = branchQuestions.get(`${ct.slug}::${st.slug}`);
          return {
            slug: st.slug,
            label: st.label,
            branch: questions ? { questions } : null,
          };
        }),
    });
  }

  return {
    version: sop.version,
    qualifiedLeadThreshold: sop.qualified_lead_threshold,
    steps: steps
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        position: s.position,
        slug: s.slug,
        questionText: s.question_text,
        chipSource: s.chip_source,
        appliesWhenSubTypeSlug: s.applies_when_sub_type_slug,
        isRequired: s.is_required,
        countsTowardThreshold: s.counts_toward_threshold,
      })),
    caseTypes: caseTypeViews,
  };
}
