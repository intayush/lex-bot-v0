import { NextResponse } from 'next/server';
import { wizardSubmissionSchema, wizardDraftSchema } from '@legal-chatbot/shared';
import { requireSuperAdmin } from '../../../../../../lib/admin-guard';
import { recordAdminAction } from '../../../../../../lib/admin/audit';
import {
  saveOnboardingDraft,
  seedSopAndBranches,
  provisionAttorneys,
  saveWizardDraft,
  getWizardDraft,
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

  if (body?.finish === true) {
    // Finish path: strict validation
    const parsed = wizardSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid submission' }, { status: 400 });
    }
    const submission = parsed.data;
    const { ready, missing } = await saveOnboardingDraft(accountId, submission);
    if (!ready) {
      return NextResponse.json(
        { error: 'Required sections are missing', missing },
        { status: 422 },
      );
    }
    await seedSopAndBranches(accountId, submission.caseTypeSelection);
    if (submission.attorneys && submission.attorneys.length > 0) {
      await provisionAttorneys(accountId, submission.attorneys);
    }
    await recordAdminAction(guard.adminId, 'tenant.onboard', accountId);
    return NextResponse.json({ onboardingStatus: 'draft', draftReady: true });
  }

  // Partial autosave path: permissive draft validation
  const draft = wizardDraftSchema.safeParse(body);
  if (!draft.success) {
    return NextResponse.json({ error: 'Malformed draft' }, { status: 400 });
  }
  await saveWizardDraft(accountId, draft.data);
  return NextResponse.json({ onboardingStatus: 'draft', saved: true });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id: accountId } = await params;
  const draft = await getWizardDraft(accountId);
  return NextResponse.json({ draft });
}
