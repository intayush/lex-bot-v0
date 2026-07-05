/**
 * 027-platform-admin-console — fleet overview aggregation (US1).
 *
 * Builds a per-tenant summary across ALL non-deleted accounts using grouped
 * queries (no per-tenant N+1). 30-day lead count + estimated spend + last
 * activity are derived from existing tables + `usage_events`.
 */
import { and, gte, isNull, sql } from 'drizzle-orm';
import type { TenantSummary } from '@legal-chatbot/shared';
import { db, schema } from '../../db/index';
import { estimateSpend } from './pricing';

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function getFleetSummary(now: () => Date = () => new Date()): Promise<TenantSummary[]> {
  const since = new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Base: all active (non-soft-deleted) accounts.
  const accounts = await db
    .select()
    .from(schema.accounts)
    .where(isNull(schema.accounts.deleted_at));

  if (accounts.length === 0) return [];

  // 30-day lead counts grouped by account.
  const leadCounts = await db
    .select({
      account_id: schema.leads.account_id,
      count: sql<number>`count(*)`,
    })
    .from(schema.leads)
    .where(gte(schema.leads.created_at, since))
    .groupBy(schema.leads.account_id);
  const leadCountByAccount = new Map(leadCounts.map((r) => [r.account_id, Number(r.count)]));

  // 30-day usage grouped by account + provider/model for spend estimation.
  const usage = await db
    .select({
      account_id: schema.usageEvents.account_id,
      provider: schema.usageEvents.provider,
      model: schema.usageEvents.model,
      prompt: sql<number>`sum(${schema.usageEvents.prompt_tokens})`,
      completion: sql<number>`sum(${schema.usageEvents.completion_tokens})`,
    })
    .from(schema.usageEvents)
    .where(gte(schema.usageEvents.created_at, since))
    .groupBy(schema.usageEvents.account_id, schema.usageEvents.provider, schema.usageEvents.model);
  const spendByAccount = new Map<string, number>();
  for (const row of usage) {
    const spend = estimateSpend(row.provider, row.model, Number(row.prompt), Number(row.completion));
    spendByAccount.set(row.account_id, (spendByAccount.get(row.account_id) ?? 0) + spend);
  }

  // Last activity = most recent session per account.
  const lastActivity = await db
    .select({
      account_id: schema.sessions.account_id,
      last: sql<string>`max(${schema.sessions.updated_at})`,
    })
    .from(schema.sessions)
    .groupBy(schema.sessions.account_id);
  const lastActivityByAccount = new Map(lastActivity.map((r) => [r.account_id, r.last]));

  return accounts.map((a) => ({
    accountId: a.id,
    firmName: a.firm_name ?? null,
    email: a.email,
    status: (a.status as TenantSummary['status']) ?? 'active',
    onboardingStatus: (a.onboarding_status as TenantSummary['onboardingStatus']) ?? 'live',
    leadCount30d: leadCountByAccount.get(a.id) ?? 0,
    estimatedSpend30d: Math.round((spendByAccount.get(a.id) ?? 0) * 10000) / 10000,
    lastActivityAt: lastActivityByAccount.get(a.id) ?? null,
  }));
}
