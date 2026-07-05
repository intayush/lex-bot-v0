import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { setTenantStatusSchema } from '@legal-chatbot/shared';
import { db, schema } from '../../../../../../db/index';
import { requireSuperAdmin } from '../../../../../../lib/admin-guard';
import { recordAdminAction } from '../../../../../../lib/admin/audit';

/**
 * 027 US6 — PATCH /api/admin/tenants/[id]/status (suspend / reactivate).
 * Suspend sets status='suspended' AND revokes the tenant's API keys so
 * verifyApiKey rejects them (chatbot stops serving). Reactivate reverses both.
 *
 * NOTE (analysis finding I1): verifyApiKey caches results for up to 60s, so a
 * suspend takes effect within ≤60s (accepted propagation delay). Reactivation
 * un-revokes keys; the negative cache entry also expires within 60s.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = setTenantStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  const { status } = parsed.data;

  const rows = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deleted_at)));
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  await db.update(schema.accounts).set({ status }).where(eq(schema.accounts.id, id));

  if (status === 'suspended') {
    // Revoke all currently-active keys.
    await db
      .update(schema.apiKeys)
      .set({ revoked_at: now })
      .where(and(eq(schema.apiKeys.account_id, id), isNull(schema.apiKeys.revoked_at)));
  } else {
    // Reactivate: un-revoke keys (best-effort — restores prior keys).
    await db
      .update(schema.apiKeys)
      .set({ revoked_at: null })
      .where(eq(schema.apiKeys.account_id, id));
  }

  await recordAdminAction(
    guard.adminId,
    status === 'suspended' ? 'tenant.suspend' : 'tenant.reactivate',
    id,
  );
  return NextResponse.json({ success: true });
}
