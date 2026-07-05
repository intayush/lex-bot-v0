import { NextResponse } from 'next/server';
import { metricsWindowSchema } from '@legal-chatbot/shared';
import { requireSuperAdmin } from '../../../../../../lib/admin-guard';
import { getTenantMetrics } from '../../../../../../lib/admin/metrics';

/** 027 US4 — GET /api/admin/tenants/[id]/metrics?window=30d. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const url = new URL(req.url);
  const parsedWindow = metricsWindowSchema.safeParse(url.searchParams.get('window') ?? undefined);
  const window = parsedWindow.success ? parsedWindow.data : '30d';

  const metrics = await getTenantMetrics(id, window);
  return NextResponse.json(metrics);
}
