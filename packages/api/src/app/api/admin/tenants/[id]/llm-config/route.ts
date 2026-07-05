import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { llmConfigInputSchema } from '@legal-chatbot/shared';
import { db, schema } from '../../../../../../db/index';
import { requireSuperAdmin } from '../../../../../../lib/admin-guard';
import { recordAdminAction } from '../../../../../../lib/admin/audit';
import { encrypt } from '../../../../../../lib/crypto';
import { invalidateLlmConfigCache } from '../../../../../../lib/llm/provider-resolver';

/** Safe view — NEVER includes key material (FR-016, SC-005). */
function toView(cfg: typeof schema.accountLlmConfig.$inferSelect) {
  return {
    provider: cfg.provider,
    model: cfg.model,
    hasKey: cfg.api_key_encrypted != null,
    isActive: cfg.is_active,
    updatedAt: cfg.updated_at,
  };
}

/** 027 US3 — GET current LLM config (or null → platform default). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const rows = await db
    .select()
    .from(schema.accountLlmConfig)
    .where(eq(schema.accountLlmConfig.account_id, id));
  return NextResponse.json(rows[0] ? toView(rows[0]) : null);
}

/** 027 US3 — PUT (upsert) LLM config; encrypt key on write; invalidate cache. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = llmConfigInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid LLM configuration', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { provider, model, apiKey, clearKey, isActive } = parsed.data;
  const now = new Date().toISOString();

  const existingRows = await db
    .select()
    .from(schema.accountLlmConfig)
    .where(eq(schema.accountLlmConfig.account_id, id));
  const existing = existingRows[0];

  // Determine the key column's next value.
  let encryptedKey: string | null | undefined;
  if (clearKey) encryptedKey = null;
  else if (apiKey) encryptedKey = encrypt(apiKey);
  else encryptedKey = undefined; // leave unchanged

  if (existing) {
    await db
      .update(schema.accountLlmConfig)
      .set({
        provider,
        model,
        is_active: isActive ?? existing.is_active,
        ...(encryptedKey !== undefined ? { api_key_encrypted: encryptedKey } : {}),
        updated_at: now,
      })
      .where(eq(schema.accountLlmConfig.id, existing.id));
  } else {
    await db.insert(schema.accountLlmConfig).values({
      id: nanoid(),
      account_id: id,
      provider,
      model,
      api_key_encrypted: encryptedKey ?? null,
      is_active: isActive ?? true,
      created_at: now,
      updated_at: now,
    });
  }

  invalidateLlmConfigCache(id);
  // Audit records provider + model ONLY — never the key (Constitution VIII).
  await recordAdminAction(guard.adminId, 'llm_config.update', id, { provider, model });

  const freshRows = await db
    .select()
    .from(schema.accountLlmConfig)
    .where(eq(schema.accountLlmConfig.account_id, id));
  return NextResponse.json(toView(freshRows[0]));
}
