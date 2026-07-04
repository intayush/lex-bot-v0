import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Message, SOPState, SOPStateHistory, SOPStateSnapshot } from '@legal-chatbot/shared';
import { sopStateSchema, sopStateHistorySchema } from '@legal-chatbot/shared';

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
 * Persist appended messages AND the latest SOP state in a single UPDATE.
 * The chat route's onFinish callback uses this to keep both in sync
 * (010-sop-workflow T031).
 *
 * 021-chat-api-latency T022: the signature now takes `existingHistory`
 * (already read by the chat route at request time) and `newMessages` to
 * append. This removes the internal SELECT, saving a DB round-trip on the
 * critical path. The caller is responsible for passing the correct
 * existingHistory — use the `history` value from the chat route's request-
 * phase load (getSessionForSOP).
 *
 * `sopState` may be null when the account has no published SOP.
 */
export async function appendMessagesAndSOPState(
  sessionId: string,
  existingHistory: Message[],
  newMessages: Message[],
  sopState: SOPState | null,
  priorSopState: SOPState | null,
  leadIdThisTurn: string | null = null,
): Promise<void> {
  const updated = [...existingHistory, ...newMessages];
  const now = new Date().toISOString();

  // Read the current undo stack for this row (single select).
  const rows = await db
    .select({ history: schema.sessions.sop_state_history_json })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));
  let stack: SOPStateHistory = [];
  if (rows[0]?.history) {
    try {
      stack = sopStateHistorySchema.parse(JSON.parse(rows[0].history));
    } catch {
      stack = []; // corrupted stack → start fresh; undo depth resets, no crash
    }
  }

  // Push a snapshot of the state ENTERING this turn.
  const snapshot: SOPStateSnapshot = {
    sop_state: priorSopState,
    message_count: existingHistory.length,
    lead_id: leadIdThisTurn,
  };
  stack.push(snapshot);
  if (stack.length > 10) stack.shift(); // drop oldest

  await db.update(schema.sessions)
    .set({
      messages_json: JSON.stringify(updated),
      sop_state_json: sopState ? JSON.stringify(sopState) : null,
      sop_state_history_json: JSON.stringify(stack),
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

/**
 * Undo one exchange: pop the top snapshot, restore sop_state_json,
 * truncate messages_json to the snapshot's message_count, and soft-delete
 * the lead that turn created (if any). Idempotent no-op on an empty stack.
 *
 * Ordered sequential writes (neon-http has no interactive transactions).
 * The widget disables the undo button in-flight, so there is one writer
 * per session during an undo.
 */
export async function revertLastTurn(sessionId: string): Promise<{
  messages: Message[];
  sopState: SOPState | null;
}> {
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));
  const row = rows[0];
  if (!row) return { messages: [], sopState: null };

  const messages = JSON.parse(row.messages_json) as Message[];

  // Parse the current SOP state (for the no-op return path).
  let currentSop: SOPState | null = null;
  if (row.sop_state_json) {
    try { currentSop = sopStateSchema.parse(JSON.parse(row.sop_state_json)); }
    catch { currentSop = null; }
  }

  // Parse the undo stack.
  let stack: SOPStateHistory = [];
  if (row.sop_state_history_json) {
    try { stack = sopStateHistorySchema.parse(JSON.parse(row.sop_state_history_json)); }
    catch { stack = []; }
  }

  // Empty stack → nothing to undo.
  if (stack.length === 0) {
    return { messages, sopState: currentSop };
  }

  const snapshot = stack.pop()!;
  const restoredMessages = messages.slice(0, snapshot.message_count);
  const restoredSop = snapshot.sop_state;
  const now = new Date().toISOString();

  await db.update(schema.sessions)
    .set({
      messages_json: JSON.stringify(restoredMessages),
      sop_state_json: restoredSop ? JSON.stringify(restoredSop) : null,
      sop_state_history_json: JSON.stringify(stack),
      updated_at: now,
    })
    .where(eq(schema.sessions.id, sessionId));

  // Soft-delete the lead this turn created (option B).
  if (snapshot.lead_id) {
    await db.update(schema.leads)
      .set({ reverted_at: now })
      .where(eq(schema.leads.id, snapshot.lead_id));
  }

  return { messages: restoredMessages, sopState: restoredSop };
}
