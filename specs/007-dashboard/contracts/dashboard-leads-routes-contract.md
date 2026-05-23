# Contract: Dashboard Leads Routes

**Owner**: Dashboard (`007-dashboard`)
**Source of Truth**: §8.5, §8.6, §1.10, §11.5.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/dashboard/leads/{id}` | PATCH | Update status, add internal note |
| `/api/dashboard/leads/{id}` | DELETE | Delete with archival (R7) |
| `/api/dashboard/leads/{id}/export?format=pdf|json` | GET | Export single lead |
| `/api/dashboard/leads/{id}/transcript?format=pdf|text` | GET | Export transcript (R10) |
| `/api/dashboard/leads/bulk` | POST | Bulk actions |

All authenticated via iron-session.
All scoped: queries filter by `account_id = session.accountId`.

## PATCH /api/dashboard/leads/{id}

Body (partial; any combination):

```ts
{
  status?: 'new' | 'contacted' | 'dismissed',
  append_internal_note?: string,
}
```

Behavior:
1. Validate body via Zod.
2. Verify the lead belongs to `session.accountId`. If not → 404.
3. If `status` provided: UPDATE the column directly.
4. If `append_internal_note` provided: prepend a timestamp
   (`[ISO 8601] `) and append to the existing `internal_notes`
   value (with a newline separator).
5. Return `{ success: true }`.

## DELETE /api/dashboard/leads/{id}

Behavior (in a Drizzle transaction):

1. Verify the lead belongs to `session.accountId`. If not → 404.
2. SELECT the lead row + related notifications + session row.
3. INSERT into `archived_data`:
   ```ts
   {
     id: nanoid(),
     account_id: lead.account_id,
     original_table: 'leads',
     original_id: lead.id,
     data_json: JSON.stringify({ lead, notifications, session }),
     deleted_by_user_at: now(),
     archived_at: now(),
   }
   ```
4. DELETE FROM `notifications` WHERE `lead_id = lead.id`.
5. DELETE FROM `leads` WHERE `id = lead.id`.

Note: the `sessions` row is NOT deleted (other features may
reference it).

Return: `{ success: true, archived_id: <id of archived_data row> }`.

## GET /api/dashboard/leads/{id}/export?format=pdf|json

Behavior:
1. Verify the lead belongs to the account → 404 if not.
2. Read the lead + transcript.
3. If `format=json`: return `application/json` with the lead
   row + transcript embedded.
4. If `format=pdf`: render with server-side React PDF
   (`@react-pdf/renderer`); stream `application/pdf` back.

Filename: `lead-<short-id>-<date>.pdf` or `.json`.

## GET /api/dashboard/leads/{id}/transcript?format=pdf|text (R10)

Behavior:
1. Verify the lead belongs to the account → 404.
2. Read the `sessions.messages_json` for the lead's session.
3. Format as a chat transcript:
   ```
   [2026-05-23 14:30] User: Hi, I was just arrested for DUI...
   [2026-05-23 14:31] Assistant: I'm sorry to hear that...
   ```
4. If `format=text`: return `text/plain`.
5. If `format=pdf`: render to PDF, stream back.

## POST /api/dashboard/leads/bulk

Body:

```ts
{
  ids: z.array(z.string()).min(1).max(100),
  action: z.enum(['contacted', 'dismissed', 'export']),
}
```

Behavior:
1. Validate body.
2. Filter `ids` to those that belong to `session.accountId`.
3. If `action='contacted'`: bulk UPDATE.
4. If `action='dismissed'`: bulk UPDATE.
5. If `action='export'`: return a CSV download with all
   matched leads.

## Pagination (FR-034)

The Leads page (`/dashboard/leads`) supports `?page=N&pageSize=25`
query params. The default `pageSize=25` is binding per §8.5.

Server-rendered Leads page reads:

```ts
const offset = (page - 1) * pageSize;
const rows = await db.select().from(leads)
  .where(and(eq(leads.account_id, accountId), filters))
  .orderBy(desc(leads.created_at))
  .limit(pageSize)
  .offset(offset);
```

## Constitution Compliance

- Constitution II: every body Zod-validated.
- Constitution IV: Route Handlers; Drizzle transaction for
  delete.
- Constitution V: account-scoped reads + writes; `archived_data`
  written on delete.
- Constitution VI: structured-log events emitted for status
  mutations and deletions.

