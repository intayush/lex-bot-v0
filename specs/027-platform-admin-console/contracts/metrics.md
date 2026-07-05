# Contract: Per-tenant metrics

## GET /api/admin/tenants/[id]/metrics?window=30d
- 200: `TenantMetrics`
```
TenantMetrics = {
  window: "7d" | "30d" | "90d",         // default 30d
  funnel: {
    conversationsStarted: number,        // sessions in window
    leadsCaptured: number,
    breakdown: { HOT: number, WARM: number, COLD: number, SPAM: number },
    conversionRate: number               // leadsCaptured / conversationsStarted (0 if none)
  },
  usageCost: {
    conversationVolume: { date: string, count: number }[],
    avgMessagesPerConversation: number,
    tokens: { prompt: number, completion: number, total: number },
    estimatedSpend: number,              // derived at read-time from price map
    byProviderModel: { provider, model, totalTokens, estimatedSpend }[]
  },
  routing: {
    hotLeadsRouted: number,              // HOT leads with dispatched notification (spec 024)
    emailsDispatched: number,
    followUpActions: { contacted, call_no_answer, meeting_fixed, none }  // spec 013
  }
}
```
- All figures derived from `sessions`, `leads`, `usage_events`, routing/action
  data — filtered by `account_id` + window (FR-021).
- Zero-traffic tenant → all counts 0, `conversionRate` 0, empty arrays; no error
  (FR-022, SC-006).
- If some conversations lack `usage_events`, spend is estimated from available
  events; the response MUST NOT imply full-tenant zero cost (edge case).
