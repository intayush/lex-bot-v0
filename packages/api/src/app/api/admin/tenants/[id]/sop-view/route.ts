import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '../../../../../../lib/admin-guard';
import { getSopFlowView } from '../../../../../../lib/admin/sop-view';

/** 027 US5 — GET /api/admin/tenants/[id]/sop-view (read-only, FR-023/FR-024). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const view = await getSopFlowView(id);
  if (!view) {
    return NextResponse.json({ error: 'No published SOP for this tenant' }, { status: 404 });
  }
  return NextResponse.json(view);
}
