# Contract: `/api/dashboard/notifications`

**Owner**: Dashboard (`007-dashboard`)
**Source of Truth**: §8.7.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/dashboard/notifications` | GET | List recent + unread count |
| `/api/dashboard/notifications/{id}` | PATCH | Mark single read |
| `/api/dashboard/notifications` | PATCH | Mark all read |

## GET /api/dashboard/notifications

Query params:
- `limit` (default 50, max 100).
- `offset` (default 0).
- `unread_only` (boolean, default false).

Response:

```ts
{
  notifications: Array<{
    id: string;
    type: 'urgent_lead' | 'escalation' | 'system';
    title: string;
    body: string;
    lead_id: string | null;
    read: boolean;
    created_at: string;
  }>;
  unread_count: number;
  total_count: number;
}
```

Behavior:
1. Authenticated via iron-session.
2. Query `notifications` WHERE `account_id = session.accountId`,
   ordered by `created_at` DESC, paginated.
3. Return list + counts.

The bell badge polls this endpoint every 30 seconds (R3) to
update the unread count.

## PATCH /api/dashboard/notifications/{id}

Body: `{ read: true }`.

Behavior:
1. Authenticated.
2. Verify the notification belongs to the account → 404 if not.
3. UPDATE `notifications SET read = true WHERE id = ? AND
   account_id = ?`.
4. Return `{ success: true }`.

## PATCH /api/dashboard/notifications

Body: `{ all: true }`.

Behavior:
1. Authenticated.
2. UPDATE `notifications SET read = true WHERE account_id = ?
   AND read = false`.
3. Return `{ success: true, marked: <count> }`.

## Determinism

The drawer's display order is deterministic given a stable
`created_at` ordering. Bell badge count is the COUNT of
`read = false` rows.

## Constitution Compliance

- Constitution II: Zod-validated bodies.
- Constitution IV: Route Handlers.
- Constitution V: account-scoped reads + writes.

