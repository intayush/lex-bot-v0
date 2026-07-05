/**
 * 027-platform-admin-console — per-conversation token-usage capture (US4,
 * Constitution VI). Writes a `usage_events` row with the resolved provider/model
 * and token counts. Called from the chat route's onFinish, deferred post-stream.
 */
import { nanoid } from 'nanoid';
import { db, schema } from '../db/index';

export interface UsageEventInput {
  accountId: string;
  sessionId: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function recordUsageEvent(input: UsageEventInput): Promise<void> {
  await db.insert(schema.usageEvents).values({
    id: nanoid(),
    account_id: input.accountId,
    session_id: input.sessionId,
    provider: input.provider,
    model: input.model,
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
    total_tokens: input.totalTokens,
    created_at: new Date().toISOString(),
  });
}
