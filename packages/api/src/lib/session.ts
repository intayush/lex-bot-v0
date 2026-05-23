import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Message, SOPState } from '@legal-chatbot/shared';
import { sopStateSchema } from '@legal-chatbot/shared';

export async function createSession(accountId: string, isPreview = false): Promise<string> {
  const id = `sess_${nanoid()}`;
  const now = new Date().toISOString();

  await db.insert(schema.sessions).values({
    id,
    account_id: accountId,
    messages_json: '[]',
    is_preview: isPreview,
    sop_state_json: null,
    created_at: now,
    updated_at: now,
  });

  return id;
}

export async function getSessionMessages(sessionId: string): Promise<Message[]> {
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));

  const row = rows[0];
  if (!row) return [];
  return JSON.parse(row.messages_json) as Message[];
}

/**
 * Load the session row's SOP state alongside its created_at anchor and
 * messages, in a single query. Returns null fields when the session is
 * missing.
 *
 * Used by the chat route on every turn (010-sop-workflow T031) so the
 * SOP runtime can be initialized from a known anchor and resumed across
 * turns deterministically.
 */
export async function getSessionForSOP(sessionId: string): Promise<{
  messages: Message[];
  sopState: SOPState | null;
  conversationAnchorIso: string;
} | null> {
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));

  const row = rows[0];
  if (!row) return null;

  const messages = JSON.parse(row.messages_json) as Message[];
  const conversationAnchorIso = row.created_at;

  let sopState: SOPState | null = null;
  if (row.sop_state_json) {
    try {
      sopState = sopStateSchema.parse(JSON.parse(row.sop_state_json));
    } catch (err) {
      // Corrupted state: log and treat as absent. The route handler will
      // re-initialize from the currently-published SOP.
      console.warn('[session] failed to parse sop_state_json for', sessionId, err);
      sopState = null;
    }
  }

  return { messages, sopState, conversationAnchorIso };
}

export async function appendMessages(sessionId: string, messages: Message[]): Promise<void> {
  const existing = await getSessionMessages(sessionId);
  const updated = [...existing, ...messages];
  const now = new Date().toISOString();

  await db.update(schema.sessions)
    .set({
      messages_json: JSON.stringify(updated),
      updated_at: now,
    })
    .where(eq(schema.sessions.id, sessionId));
}

/**
 * Persist appended messages AND the latest SOP state in a single update.
 * The chat route's onFinish callback uses this to keep both in sync
 * (010-sop-workflow T031).
 *
 * `sopState` may be null when the account has no published SOP.
 */
export async function appendMessagesAndSOPState(
  sessionId: string,
  messages: Message[],
  sopState: SOPState | null,
): Promise<void> {
  const existing = await getSessionMessages(sessionId);
  const updated = [...existing, ...messages];
  const now = new Date().toISOString();

  await db.update(schema.sessions)
    .set({
      messages_json: JSON.stringify(updated),
      sop_state_json: sopState ? JSON.stringify(sopState) : null,
      updated_at: now,
    })
    .where(eq(schema.sessions.id, sessionId));
}

export async function sessionExists(sessionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));
  return !!rows[0];
}
