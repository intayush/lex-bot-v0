# Contract: Routing Queue & Email Dispatch

**Feature**: 024-attorney-routing

---

## Queue Architecture

The `notifications` table acts as the durable email queue:

```
captureLead() detects HOT classification
  → queries attorneys WHERE case_type_slug = lead.case_type AND account_id = lead.account_id
  → for each matching attorney:
      INSERT notifications {
        type: 'attorney_lead_routing',
        delivery_channel: 'email',
        attorney_id: attorney.id,
        lead_id: lead.id,
        delivered_at: null   ← pending
      }
  → all of the above runs inside runAfterResponse() / next/server after()
    so the chatbot HTTP response returns BEFORE any of this executes
  → after() fires, reads each pending notification row, calls sendEmail(), sets delivered_at
```

---

## Routing Notification Row

Written to `notifications` table with the following shape:

| Field | Value |
|-------|-------|
| `type` | `'attorney_lead_routing'` |
| `delivery_channel` | `'email'` |
| `attorney_id` | The matched attorney's ID |
| `lead_id` | The lead's ID |
| `account_id` | The firm's account ID |
| `title` | `"New HOT lead: {case_type_label}"` |
| `body` | JSON-encoded `RoutingNotificationPayload` (see data-model.md) |
| `read` | `false` (not relevant for email channel) |
| `delivered_at` | `null` initially; set to ISO timestamp on successful send |

---

## Email Content Contract

Each routing email sent to a matching attorney MUST include:

| Field | Content |
|-------|---------|
| **To** | Attorney's email address |
| **Subject** | `"New HOT lead: {case_type_label} — {lead_name or 'Anonymous'}"` |
| **Salutation** | Attorney's name |
| **Lead name** | Visitor's full name (or "Not provided") |
| **Contact email** | Visitor's email (or "Not provided") |
| **Contact phone** | Visitor's phone (or "Not provided") |
| **Case type** | Human-readable label (e.g. "DUI") |
| **Description** | Lead's brief description (or "Not provided") |
| **Dashboard link** | URL to the dashboard leads page |
| **Timestamp** | When the lead was captured |

---

## Dispatch Semantics

- **Fire-and-log**: Email is sent once. If it fails, the failure is logged with lead ID and attorney ID. No automatic retry in this feature (retry / dead-letter queue is a future enhancement).
- **One email per attorney**: Even if an attorney is assigned to multiple case types that match the lead, they receive exactly one email (deduped by attorney_id per lead).
- **Non-blocking**: The entire routing path runs inside `after()` — the chatbot's HTTP response has already returned before any DB queries or email sends begin.
- **Independent of dashboard notification**: The existing `urgent_lead` dashboard notification fires independently and is not replaced or modified.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| No matching attorneys | Silently skip — no notification row written |
| Resend API returns error | Log `{ leadId, attorneyId, error }` to console; set `delivered_at` to a sentinel (e.g. `'FAILED'`) so the row is not retried indefinitely |
| Attorney deleted before email fires | The FK constraint allows null; if attorney row is gone, skip the send and log |
| `RESEND_API_KEY` not set | Log warning, skip email send, lead still captured normally |
