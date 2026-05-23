# Contract: `notifications` Table Write

**Owner**: Lead Classification (`006-lead-classification`)
**Reader**: Dashboard (`007-dashboard` §8.7 notifications drawer)
**Source of Truth**: §2.6 schema, §7.4 mechanism step 4, §8.7.

## Table

`notifications` — schema defined by `001-foundation` per §2.6.

This contract specifies the **write semantics** for the
`'urgent_lead'` notification type. Other notification types
(`'escalation'`, `'system'`) are reserved by §2.6 for post-MVP
use and are NOT written by this feature.

## When To Write

A notification is created when:

1. `captureLead` is called.
2. `classification === 'urgent'`.
3. NO existing `urgent_lead` notification exists for the same
   `session_id` (deduplication, R3).

If any condition is false, no notification row is created.

## Row Shape

```ts
await tx.insert(notifications).values({
  id: nanoid(),
  account_id: accountId,
  type: 'urgent_lead',
  title: formatNotificationTitle({ case_type, name }),
  body: formatNotificationBody({ brief_description }),
  lead_id: leadId,
  read: false,
  delivery_channel: 'dashboard',
  delivered_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
});
```

## Title Formatting (R1, §8.7)

```ts
function formatNotificationTitle({ case_type, name }: {
  case_type: string | null;
  name: string | null;
}): string {
  const matter = case_type || 'Unknown matter';
  const who    = name || 'Anonymous';
  return `New urgent lead: ${matter} from ${who}`;
}
```

This is the binding §8.7 wording: `"New urgent lead: [case type] from [name]"`.

## Body Formatting (R1)

```ts
function formatNotificationBody({ brief_description }: {
  brief_description: string | null;
}): string {
  if (!brief_description) {
    return 'An urgent lead requires your attention.';
  }
  // Truncate at 280 chars to match common notification UX
  if (brief_description.length > 280) {
    return brief_description.slice(0, 277) + '...';
  }
  return brief_description;
}
```

The body is the lawyer's preview text in the §8.7 notifications
drawer.

## Deduplication Logic

```ts
// Inside the transaction (R2), BEFORE the notification insert:
const existing = await tx
  .select({ id: notifications.id })
  .from(notifications)
  .innerJoin(leads, eq(leads.id, notifications.lead_id))
  .where(and(
    eq(notifications.type, 'urgent_lead'),
    eq(leads.session_id, sessionId),
  ))
  .limit(1);

if (existing[0]) return; // already notified for this session
```

This prevents drawer spam when the LLM calls `captureLead`
multiple times within a single session and re-classifies as
urgent each time.

## Invariants

| Field | Invariant |
|---|---|
| `type` | Always `'urgent_lead'` for this feature |
| `title` | Non-empty; matches §8.7 format (R1) |
| `body` | Non-empty (fallback wording when description missing) |
| `lead_id` | Non-null FK to the just-written lead |
| `read` | Always `false` on insert (Phase 6 mutates) |
| `delivery_channel` | Always `'dashboard'` for MVP |
| `delivered_at` | Set to insert time |

## Atomicity (R2)

The notification insert is part of the same Drizzle transaction
as the lead INSERT/UPDATE. If the notification insert fails, the
lead insert/update is rolled back. If the lead insert/update
fails, the notification insert is never attempted.

## Logging

`notification_created` event emitted via Foundation logger
(R5) with payload `{ notificationId, leadId, accountId }`.

## Tests

- Urgent lead → notification created with §8.7 wording (R1).
- Non-urgent lead → no notification (existing tests verify).
- Repeat urgent `captureLead` for same session → only ONE
  notification row exists (R3 dedup).
- Notification insert failure → lead insert rolled back (R2).
- Title formatting: missing case_type → "Unknown matter"; missing
  name → "Anonymous".
- Body truncation: >280 chars truncated with ellipsis.

