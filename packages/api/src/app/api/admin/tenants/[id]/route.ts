import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../../../../../db/index';
import { requireSuperAdmin } from '../../../../../lib/admin-guard';
import { recordAdminAction } from '../../../../../lib/admin/audit';

/** 027 US2 — GET /api/admin/tenants/[id] tenant detail (FR-005). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deleted_at)));
  const acct = rows[0];
  if (!acct) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const llmRows = await db
    .select()
    .from(schema.accountLlmConfig)
    .where(eq(schema.accountLlmConfig.account_id, id));
  const llm = llmRows[0];

  return NextResponse.json({
    tenant: {
      accountId: acct.id,
      firmName: acct.firm_name,
      email: acct.email,
      status: acct.status,
      onboardingStatus: acct.onboarding_status,
    },
    llmConfig: llm
      ? {
          provider: llm.provider,
          model: llm.model,
          hasKey: llm.api_key_encrypted != null,
          isActive: llm.is_active,
          updatedAt: llm.updated_at,
        }
      : null,
  });
}

/**
 * 027 US6 — DELETE /api/admin/tenants/[id]: soft-delete with archival snapshot
 * of lead/PII data; never a hard wipe (FR-027, Constitution V).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deleted_at)));
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();

  // Archive each lead row before soft-deleting the tenant (Constitution V).
  const leadRows = await db.select().from(schema.leads).where(eq(schema.leads.account_id, id));
  for (const lead of leadRows) {
    await db.insert(schema.archivedData).values({
      id: nanoid(),
      account_id: id,
      original_table: 'leads',
      original_id: lead.id,
      data_json: JSON.stringify(lead),
      deleted_by_user_at: now,
      archived_at: now,
    });
  }

  await db.update(schema.accounts).set({ deleted_at: now }).where(eq(schema.accounts.id, id));

  await recordAdminAction(guard.adminId, 'tenant.delete', id, { archivedLeads: leadRows.length });
  return NextResponse.json({ success: true });
}
