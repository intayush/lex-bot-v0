import { NextResponse } from 'next/server';
import { wizardSubmissionSchema } from '@legal-chatbot/shared';
import { requireSuperAdmin } from '../../../../../../lib/admin-guard';
import { recordAdminAction } from '../../../../../../lib/admin/audit';
import {
  saveOnboardingDraft,
  seedSopAndBranches,
} from '../../../../../../lib/admin/tenant-provisioning';

/**
 * 027 US2 — PUT /api/admin/tenants/[id]/onboarding.
 * Saves wizard progress; when `finish:true` and all required sections present,
 * generates the draft config + SOP + default branches (FR-008..FR-012).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id: accountId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = wizardSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid submission' }, { status: 400 });
  }
  const submission = parsed.data;

  // Save progress (upsert draft config) regardless of finish.
  const { ready, missing } = await saveOnboardingDraft(accountId, submission);

  if (submission.finish) {
    if (!ready) {
      return NextResponse.json(
        { error: 'Required sections are missing', missing },
        { status: 422 },
      );
    }
    await seedSopAndBranches(accountId);
    await recordAdminAction(guard.adminId, 'tenant.onboard', accountId);
    return NextResponse.json({ onboardingStatus: 'draft', draftReady: true });
  }

  return NextResponse.json({ onboardingStatus: 'draft', draftReady: ready });
}
