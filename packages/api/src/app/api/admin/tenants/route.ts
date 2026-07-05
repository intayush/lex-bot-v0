import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { registerTenantSchema } from '@legal-chatbot/shared';
import { db, schema } from '../../../../db/index';
import { requireSuperAdmin } from '../../../../lib/admin-guard';
import { getFleetSummary } from '../../../../lib/admin/fleet';
import { recordAdminAction } from '../../../../lib/admin/audit';
import { generateApiKey } from '../../../../lib/admin/tenant-provisioning';

/** GET /api/admin/tenants — fleet overview (US1, FR-004). */
export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const tenants = await getFleetSummary();
  return NextResponse.json({ tenants });
}

/** POST /api/admin/tenants — register a new tenant (US2, FR-006/FR-007). */
export async function POST(req: Request) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = registerTenantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { email, firmName } = parsed.data;

  const existing = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email));
  if (existing.length > 0) {
    return NextResponse.json(
      { error: 'A tenant with this email already exists' },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const accountId = nanoid();
  // Registration creates the account with a placeholder password_hash — the
  // firm sets its own password out-of-band; the console is operator-driven.
  const placeholderHash = await bcrypt.hash(nanoid(), 10);
  await db.insert(schema.accounts).values({
    id: accountId,
    email,
    password_hash: placeholderHash,
    firm_name: firmName,
    created_at: now,
    status: 'active',
    onboarding_status: 'draft',
    deleted_at: null,
  });

  // Provision a widget API key; plaintext shown exactly once.
  const { plaintext, keyHash } = await generateApiKey();
  await db.insert(schema.apiKeys).values({
    id: nanoid(),
    account_id: accountId,
    key_hash: keyHash,
    label: 'Primary',
    context_store_url: process.env.CONTEXT_STORE_URL || 'http://localhost:5173/chatbot-context/',
    created_at: now,
  });

  await recordAdminAction(guard.adminId, 'tenant.create', accountId, { firmName });

  return NextResponse.json({ accountId, apiKey: plaintext }, { status: 201 });
}
