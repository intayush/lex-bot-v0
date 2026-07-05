import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../../../../../../db/index';
import { requireSuperAdmin } from '../../../../../../lib/admin-guard';
import { recordAdminAction } from '../../../../../../lib/admin/audit';
import { generateApiKey } from '../../../../../../lib/admin/tenant-provisioning';

/**
 * 027 US6 — POST /api/admin/tenants/[id]/rotate-key.
 * Issues a new widget key (plaintext shown once), revokes all previous keys.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deleted_at)));
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();

  // Revoke existing active keys, then issue a fresh one.
  await db
    .update(schema.apiKeys)
    .set({ revoked_at: now })
    .where(and(eq(schema.apiKeys.account_id, id), isNull(schema.apiKeys.revoked_at)));

  const { plaintext, keyHash } = await generateApiKey();
  await db.insert(schema.apiKeys).values({
    id: nanoid(),
    account_id: id,
    key_hash: keyHash,
    label: 'Rotated',
    context_store_url: process.env.CONTEXT_STORE_URL || 'http://localhost:5173/chatbot-context/',
    created_at: now,
  });

  await recordAdminAction(guard.adminId, 'tenant.rotate_key', id);
  return NextResponse.json({ apiKey: plaintext });
}
