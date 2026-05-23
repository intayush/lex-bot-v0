# Contract: Cost Monitoring

**Owner**: Hardening (`008-hardening`)
**Source of Truth**: §11.3.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/dashboard/cost` | GET | Aggregate cost data for the dashboard |
| `/api/dashboard/spend-alerts` | GET/POST/DELETE | Configure alerts |
| `/api/dashboard/budget-cap` | GET/PUT | Configure daily budget cap |

All authenticated via iron-session.

## GET /api/dashboard/cost

Query params:
- `period`: `today` \| `week` \| `month` (default: `month`).

Response:

```ts
{
  today_spend_usd: number;
  week_spend_usd: number;
  month_spend_usd: number;
  daily_breakdown: Array<{
    date: string;          // YYYY-MM-DD
    spend_usd: number;
    conversations: number;
    tokens_in: number;
    tokens_out: number;
  }>;
  alerts: Array<SpendAlert>;
  budget_cap: DailyBudgetCap | null;
}
```

Behavior:
1. Aggregate `token_usage` rows for `account_id` over the
   requested period.
2. Apply per-token pricing (from `apiEnv.GEMINI_PRICE_*`).
3. Return totals + per-day breakdown.

## POST /api/dashboard/spend-alerts

Body:

```ts
{
  threshold_usd: z.number().positive(),
  period: z.enum(['daily', 'weekly', 'monthly']),
  enabled: z.boolean().default(true),
}
```

INSERTs a new `spend_alerts` row. Returns `{ id, success: true }`.

## DELETE /api/dashboard/spend-alerts/{id}

Removes an alert config.

## GET /api/dashboard/budget-cap

Returns the account's `daily_budget_caps` row (or null if not
configured).

## PUT /api/dashboard/budget-cap

Body:

```ts
{
  daily_limit_usd: z.number().positive(),
  enabled: z.boolean().default(true),
}
```

UPSERTs the row (UNIQUE on `account_id`).

## Alert Triggering (server-side)

After every chat turn (in `004-chat-api-agent`'s `onFinish`):

1. Fetch the account's enabled `spend_alerts`.
2. For each alert: compute spend over the alert's `period`;
   if spend ≥ `threshold_usd` AND the alert has not triggered
   for this period yet, INSERT a `notifications` row of
   `type: 'system'` and UPDATE `last_triggered_at`.

## Budget Cap Enforcement (server-side)

At chat turn entry (in `004-chat-api-agent`'s route):

1. Fetch the account's `daily_budget_caps` row.
2. If row exists, enabled, and
   `current_day_spend_usd >= daily_limit_usd`:
   - Return a fixed assistant message: "Service has been
     temporarily paused for today. Please call us at
     {{phone}}."
   - Do NOT call the LLM.
3. Else: proceed; on `onFinish`, increment
   `current_day_spend_usd` by the turn's cost.

## Tests

- Cost aggregation: insert known `token_usage` rows; assert
  totals match.
- Alert triggering: insert spend, simulate turn, assert
  `notifications` row created.
- Budget cap: with cap set and exceeded, the chat route
  returns the disabled message; `token_usage` is NOT recorded.

