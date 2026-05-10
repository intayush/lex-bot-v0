import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Message } from '@legal-chatbot/shared';

export async function createSession(accountId: string, isPreview = false): Promise<string> {
  const id = `sess_${nanoid()}`;
  const now = new Date().toISOString();

  await db.insert(schema.sessions).values({
    id,
    account_id: accountId,
    messages_json: '[]',
    is_preview: isPreview,
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

export async function sessionExists(sessionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));
  return !!rows[0];
}
