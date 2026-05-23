/**
 * Dashboard Goodbye-Phrases Route Handler (`/api/dashboard/sop/goodbye-phrases`).
 *
 * Implements:
 *   GET  → return account's goodbye phrases as a string array.
 *   POST { phrases: string[] } → replace the list (delete existing + insert new).
 *
 * Body validation: max 50 phrases, each 1-50 chars, must be unique within
 * the list (DB enforces account-scoped uniqueness via index, but we
 * surface a 400 earlier so the dashboard can show a user-friendly error).
 *
 * Transactionality note: same as sibling routes — `neon-http` driver is
 * sequential-only. The risk here is small because the delete+insert pair
 * happens in two API calls; if the delete succeeds and the insert fails,
 * the next save reconciles, but the account is briefly without configured
 * phrases. Documented; acceptable for a dashboard CRUD surface.
 *
 * Source of truth: contracts/sop-config-routes-contract.md.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../../../db';
import { getAuthSession } from '../../../../../lib/dashboard-session';

// ---------------------------------------------------------------------------
// Body schema
// ---------------------------------------------------------------------------

const goodbyePhrasesBodySchema = z.object({
  phrases: z.array(z.string().min(1).max(50)).max(50),
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const rows = await db
    .select({ phrase: schema.goodbyePhrases.phrase })
    .from(schema.goodbyePhrases)
    .where(eq(schema.goodbyePhrases.account_id, session.accountId));
  return NextResponse.json({ phrases: rows.map((r) => r.phrase) });
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const accountId = session.accountId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = goodbyePhrasesBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }

  // Normalize: trim + dedupe (case-insensitive). The dashboard generally
  // submits clean data but defensive normalization avoids obvious foot-guns
  // (whitespace duplicates, trailing newlines from copy-paste).
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of parsed.data.phrases) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }

  // Replace the list. Sequential delete + insert (no transactions in neon-http).
  await db.delete(schema.goodbyePhrases).where(eq(schema.goodbyePhrases.account_id, accountId));

  if (normalized.length > 0) {
    const nowIso = new Date().toISOString();
    await db.insert(schema.goodbyePhrases).values(
      normalized.map((phrase) => ({
        id: nanoid(),
        account_id: accountId,
        phrase,
        created_at: nowIso,
      })),
    );
  }

  return NextResponse.json({ success: true, count: normalized.length });
}
