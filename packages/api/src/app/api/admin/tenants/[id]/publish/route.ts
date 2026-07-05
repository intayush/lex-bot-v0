import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '../../../../../../lib/admin-guard';
import { recordAdminAction } from '../../../../../../lib/admin/audit';
import { publishTenant } from '../../../../../../lib/admin/tenant-provisioning';

/**
 * 027 US2 — POST /api/admin/tenants/[id]/publish.
 * Publishes the latest draft config + SOP; sets onboarding_status='live' (FR-010).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id: accountId } = await params;
  const { published } = await publishTenant(accountId);
  if (!published) {
    return NextResponse.json({ error: 'No draft ready to publish' }, { status: 409 });
  }

  await recordAdminAction(guard.adminId, 'tenant.publish', accountId);
  return NextResponse.json({ onboardingStatus: 'live' });
}
