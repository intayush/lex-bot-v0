/**
 * 027-platform-admin-console — per-tenant metrics aggregation (US4).
 *
 * All figures derived from existing tables + `usage_events` (FR-021), scoped by
 * account_id + a date window. Estimated spend computed at read-time from the
 * price map (never stored).
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { MetricsWindow, TenantMetrics } from '@legal-chatbot/shared';
import { db, schema } from '../../db/index';
import { estimateSpend } from './pricing';

const WINDOW_DAYS: Record<MetricsWindow, number> = { '7d': 7, '30d': 30, '90d': 90 };

export async function getTenantMetrics(
  accountId: string,
  window: MetricsWindow = '30d',
  now: () => Date = () => new Date(),
): Promise<TenantMetrics> {
  const since = new Date(now().getTime() - WINDOW_DAYS[window] * 24 * 60 * 60 * 1000).toISOString();

  // --- Funnel ---
  const [sessionCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.account_id, accountId), gte(schema.sessions.created_at, since)));
  const conversationsStarted = Number(sessionCountRow?.count ?? 0);

  const leadRows = await db
    .select({ classification: schema.leads.classification, count: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(eq(schema.leads.account_id, accountId), gte(schema.leads.created_at, since)))
    .groupBy(schema.leads.classification);
  const breakdown = { HOT: 0, WARM: 0, COLD: 0, SPAM: 0 };
  let leadsCaptured = 0;
  for (const r of leadRows) {
    const n = Number(r.count);
    leadsCaptured += n;
    if (r.classification in breakdown) breakdown[r.classification as keyof typeof breakdown] += n;
  }
  const conversionRate = conversationsStarted > 0 ? leadsCaptured / conversationsStarted : 0;

  // --- Usage & cost ---
  const usageRows = await db
    .select({
      provider: schema.usageEvents.provider,
      model: schema.usageEvents.model,
      prompt: sql<number>`sum(${schema.usageEvents.prompt_tokens})`,
      completion: sql<number>`sum(${schema.usageEvents.completion_tokens})`,
      total: sql<number>`sum(${schema.usageEvents.total_tokens})`,
    })
    .from(schema.usageEvents)
    .where(and(eq(schema.usageEvents.account_id, accountId), gte(schema.usageEvents.created_at, since)))
    .groupBy(schema.usageEvents.provider, schema.usageEvents.model);

  let promptTotal = 0;
  let completionTotal = 0;
  let tokenTotal = 0;
  let estimatedSpend = 0;
  const byProviderModel = usageRows.map((r) => {
    const p = Number(r.prompt ?? 0);
    const c = Number(r.completion ?? 0);
    const t = Number(r.total ?? 0);
    promptTotal += p;
    completionTotal += c;
    tokenTotal += t;
    const spend = estimateSpend(r.provider, r.model, p, c);
    estimatedSpend += spend;
    return { provider: r.provider as never, model: r.model, totalTokens: t, estimatedSpend: round4(spend) };
  });

  // Daily conversation volume.
  const volumeRows = await db
    .select({
      date: sql<string>`substr(${schema.sessions.created_at}, 1, 10)`,
      count: sql<number>`count(*)`,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.account_id, accountId), gte(schema.sessions.created_at, since)))
    .groupBy(sql`substr(${schema.sessions.created_at}, 1, 10)`);
  const conversationVolume = volumeRows
    .map((r) => ({ date: r.date, count: Number(r.count) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const [usageEventCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.usageEvents)
    .where(and(eq(schema.usageEvents.account_id, accountId), gte(schema.usageEvents.created_at, since)));
  const usageEventCount = Number(usageEventCountRow?.count ?? 0);
  const avgMessagesPerConversation =
    conversationsStarted > 0 ? round2(usageEventCount / conversationsStarted) : 0;

  // --- Routing outcomes ---
  const [emailRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.account_id, accountId),
        eq(schema.notifications.delivery_channel, 'email'),
        gte(schema.notifications.created_at, since),
      ),
    );
  const emailsDispatched = Number(emailRow?.count ?? 0);

  const actionRows = await db
    .select({ action: schema.leads.follow_up_action, count: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(eq(schema.leads.account_id, accountId), gte(schema.leads.created_at, since)))
    .groupBy(schema.leads.follow_up_action);
  const followUpActions = { contacted: 0, call_no_answer: 0, meeting_fixed: 0, none: 0 };
  for (const r of actionRows) {
    const key = (r.action ?? 'none') as keyof typeof followUpActions;
    if (key in followUpActions) followUpActions[key] += Number(r.count);
    else followUpActions.none += Number(r.count);
  }

  return {
    window,
    funnel: { conversationsStarted, leadsCaptured, breakdown, conversionRate: round4(conversionRate) },
    usageCost: {
      conversationVolume,
      avgMessagesPerConversation,
      tokens: { prompt: promptTotal, completion: completionTotal, total: tokenTotal },
      estimatedSpend: round4(estimatedSpend),
      byProviderModel,
    },
    routing: { hotLeadsRouted: breakdown.HOT, emailsDispatched, followUpActions },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
