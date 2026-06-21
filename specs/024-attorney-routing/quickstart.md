# Quickstart — Attorney Management & Hot Lead Email Routing

**Feature**: 024-attorney-routing

End-to-end validation against a local dev environment.

## Prerequisites

- `pnpm dev` running (API on :3000, widget on :5173)
- Dev DB seeded: `pnpm db:seed`
- `RESEND_API_KEY` set in `packages/api/.env.local`
- `EMAIL_FROM` set in `packages/api/.env.local` (verified sender address)
- Browser logged into `http://localhost:3000/dashboard` as `dev@legalchatbot.com`

---

## Step 1 — Add an attorney

1. Open Configuration → **Attorneys** tab.
2. Click **Add attorney**.
3. Fill: Name = "Test Attorney", Email = "attorney@test.com", Mobile = "+14125550001".
4. Select case types: **DUI**.
5. Click **Save**.

**Expected**: Attorney appears in the list with the DUI badge. No errors.

---

## Step 2 — Edit an attorney

1. Click **Edit** on "Test Attorney".
2. Add "Criminal Defense" to their case types.
3. Click **Save**.

**Expected**: Attorney row now shows both DUI and Criminal Defense badges.

---

## Step 3 — Delete an attorney

1. Click **Delete** on "Test Attorney".
2. Confirm the deletion prompt.

**Expected**: Attorney is removed from the list. (Re-add them for Steps 4–5.)

---

## Step 4 — Trigger a HOT lead and verify email routing

1. Re-add "Test Attorney" with case type "DUI" (as per Step 1).
2. Open the widget at `http://localhost:5173`.
3. Complete a DUI intake conversation through the contact form. The LLM must classify the lead as HOT. (Use a scenario with injury + recent incident to maximise the HOT score.)
4. Wait up to 60 seconds.

**Expected**:
- The `notifications` table contains a row with `type = 'attorney_lead_routing'`, `delivery_channel = 'email'`, `attorney_id = <Test Attorney's id>`, `delivered_at` set to a timestamp (not null).
- `attorney@test.com` inbox receives an email with subject containing "New HOT lead: DUI".
- The email body contains the visitor's name, contact info, and case description.

**Verify in DB**:
```sql
SELECT type, delivery_channel, attorney_id, delivered_at, title
FROM notifications
WHERE type = 'attorney_lead_routing'
ORDER BY created_at DESC LIMIT 5;
```

---

## Step 5 — Verify WARM lead does NOT route

1. Complete another DUI intake but answer in a way that produces a WARM or COLD classification (no injury, older incident).
2. Wait 30 seconds.

**Expected**: No new `attorney_lead_routing` notification row for this session. No email received.

---

## Step 6 — Verify no routing for unmatched case type

1. Add "Test Attorney 2" with email "attorney2@test.com" and case type **Personal Injury** only.
2. Complete a HOT DUI intake (same as Step 4).
3. Wait 30 seconds.

**Expected**: "attorney@test.com" receives an email (DUI match). "attorney2@test.com" does NOT receive an email (Personal Injury, not DUI).

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| Attorneys tab not visible | Config page not updated to pass attorney data |
| Email not received after 60s | `RESEND_API_KEY` not set, or `delivered_at` is `'FAILED'` — check console logs |
| Routing fires for non-HOT lead | HOT check in `captureLead` not wired to routing path |
| Duplicate emails | Dedup-by-attorney-per-lead logic missing in routing query |
