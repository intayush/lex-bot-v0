/**
 * 020-branch-csv-import — GET /api/dashboard/branches/[caseType]/[subType]/template
 *
 * Returns a pre-filled CSV template for the given (case_type, sub_type) pair.
 * The lawyer downloads this, fills it in, and uploads it via the import route.
 */
import { getAuthSession } from '../../../../../../../lib/dashboard-session';
import { generateTemplateCsv } from '../../../../../../../lib/branch-csv';
import { corsHeaders } from '../../../../../chat/cors';

interface RouteContext {
  params: Promise<{ caseType: string; subType: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { caseType, subType } = await ctx.params;
  const csv = generateTemplateCsv(caseType, subType);
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
