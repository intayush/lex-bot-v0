/**
 * 020-branch-csv-import — GET /api/dashboard/branches/[caseType]/[subType]/template
 *
 * Returns a pre-filled CSV template for the given (case_type, sub_type) pair.
 * The lawyer downloads this, fills it in, and uploads it via the import route.
 */
import { and, eq } from 'drizzle-orm';
import { getAuthSession } from '../../../../../../../lib/dashboard-session';
import { generateTemplateCsv } from '../../../../../../../lib/branch-csv';
import { corsHeaders } from '../../../../../chat/cors';
import { db, schema } from '../../../../../../../db';
import { caseValueConfigSchema, type CaseValueBand } from '@legal-chatbot/shared';

interface RouteContext {
  params: Promise<{ caseType: string; subType: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { caseType, subType } = await ctx.params;

  // 025-case-value-estimator: load existing case value config from the current published version.
  let existingCaseValueConfig: { enabled: boolean; bands: CaseValueBand[] } | null = null;
  try {
    const branchRows = await db
      .select({
        is_case_value_enabled: schema.branches.is_case_value_enabled,
        case_value_config_json: schema.branchVersions.case_value_config_json,
      })
      .from(schema.branches)
      .innerJoin(schema.branchVersions, eq(schema.branchVersions.id, schema.branches.current_version_id))
      .where(and(
        eq(schema.branches.account_id, session.accountId),
        eq(schema.branches.case_type_slug, caseType),
        eq(schema.branches.sub_type_slug, subType),
      ))
      .limit(1);
    const row = branchRows[0];
    if (row?.case_value_config_json) {
      const parsed = caseValueConfigSchema.safeParse(JSON.parse(row.case_value_config_json));
      if (parsed.success) {
        existingCaseValueConfig = { enabled: row.is_case_value_enabled ?? false, bands: parsed.data.bands };
      }
    }
  } catch { /* silently fall back to no config */ }

  const csv = generateTemplateCsv(caseType, subType, existingCaseValueConfig);
  const filename = `branch-template-${caseType}-${subType}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...corsHeaders,
    },
  });
}
