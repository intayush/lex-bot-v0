# Quickstart: Lead Action Tracking

**Date**: 2026-05-24
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This quickstart shows the lawyer's experience after the Lead Action
Tracking feature ships. It validates the two user stories from spec.md.

## Prerequisites

- All prior features (001-012) merged + deployed.
- Dev account seeded with at least one captured lead in the dashboard.
  If the dev DB has no leads, walk a SOP through to completion via
  the widget first (see `specs/010-sop-workflow/quickstart.md` US1).
- Migration applied to local + production Neon DBs (see "Migration"
  section below).

## Migration

```bash
# Generate the migration after schema.ts edit (one-time, during implementation)
pnpm --filter @legal-chatbot/api db:generate

# Apply to local / dev / production
pnpm --filter @legal-chatbot/api db:migrate
```

Verify the migration applied cleanly:

```bash
pnpm --filter @legal-chatbot/api exec tsx -e "
  import { db, schema } from './src/db';
  const cols = await db.execute(sql\`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'leads' AND column_name LIKE 'follow_up_%'\`);
  console.log(cols);
"
```

Expected output: `follow_up_action` (nullable=YES) +
`follow_up_action_changed_at` (nullable=YES).

## Walk-through

### US1 — Lawyer Records a Follow-Up Action

1. Sign in to the dashboard at https://lex-bot-v0.netlify.app/dashboard
   (or http://localhost:3000/dashboard for local dev).
2. Navigate to the Leads page.
3. Click into any captured lead.

**Expected timeline**:

- Lead detail page renders.
- Below the lead's case info, a new "Follow-up action" section is
  visible.
- A `<select>` dropdown shows: "No action yet" (selected by default
  if the lead has no recorded action), Contacted, Call didn't answer,
  Client meeting fixed.
- A small "Save" button is next to the dropdown.

4. Select "Contacted" from the dropdown.
5. Click Save.

**Expected**:

- Within ~200ms, the page shows a small confirmation (e.g., a "Saved"
  pill that fades after 2s).
- Below the dropdown, a timestamp now reads "Contacted on May 24,
  2026, 2:14 PM" (or similar — local timezone, current date/time).

6. Reload the page (Ctrl+R / Cmd+R).

**Expected**:

- The dropdown still shows "Contacted" selected.
- The timestamp still reads the same value.

7. Click "Back to Leads" (or navigate back via the sidebar).

**Expected**:

- The leads list table shows a new "Action" column.
- The row for the lead you actioned shows "Contacted" badge.
- Other leads show an em-dash (`—`) or "No action yet" placeholder.

### US2 — Lawyer Scans the Leads List for Actionable Leads

1. From the leads list, observe multiple leads with different action
   states (some "Contacted", some "No action yet", some "Call didn't
   answer", some "Client meeting fixed").

**Expected**:

- Each row's action is clearly visible in the dedicated "Action"
  column.
- The empty state (no action yet) is visually distinguishable from
  the actioned states (e.g., grey em-dash vs. colored badges).

### Edge case: Action change

1. Click into the same lead from US1. Change the action to "Call
   didn't answer". Save.

**Expected**:

- The dropdown updates to "Call didn't answer".
- The timestamp updates to the NEW current time (NOT the prior time).
- The leads list table reflects the new action when navigated back.

### Edge case: Clear the action

1. Click into a lead with a recorded action. Change the dropdown to
   "No action yet". Save.

**Expected**:

- Both the action AND the timestamp clear.
- The leads list table shows the em-dash placeholder for this lead.

### Edge case: Cross-account authorization (security check)

This is hard to reproduce manually with a single dev account. The
Vitest unit test for the route handler covers it:

```bash
pnpm --filter @legal-chatbot/api test route.test.ts -- "cross-account"
```

Expected: the test asserts that a session whose `accountId` doesn't
match the lead's `account_id` receives a 404 response (NOT 403, NOT
200, NOT 401).

## Verification

### Smoke test against local dev

```bash
# Terminal 1: API + dashboard
pnpm --filter @legal-chatbot/api dev

# Terminal 2: drive an action update via curl
# (Need to log in first to get the iron-session cookie.)
curl -s -c /tmp/cookies.txt -X POST -H "Content-Type: application/json" \
  -d '{"email":"dev@legalchatbot.com","password":"password123"}' \
  http://localhost:3000/api/auth/login

# Pick any lead id from the dev DB:
LEAD_ID="<lead-id-from-dev-db>"

# Update the action
curl -s -b /tmp/cookies.txt -X POST -H "Content-Type: application/json" \
  -d '{"action":"contacted"}' \
  "http://localhost:3000/api/dashboard/leads/$LEAD_ID/action"
```

Expected:

```json
{
  "success": true,
  "follow_up_action": "contacted",
  "follow_up_action_changed_at": "2026-05-24T..."
}
```

### Walk spec

```bash
pnpm --filter @legal-chatbot/api e2e -- dashboard-lead-action
```

Should pass green. Run in headed slow-mo to watch:

```bash
pnpm --filter @legal-chatbot/api e2e:walk -- dashboard-lead-action
```

### Production deploy verification

After merging to `main` and pushing (Netlify auto-rebuilds):

```bash
E2E_BASE_URL=https://lex-bot-v0.netlify.app \
E2E_WIDGET_URL=https://lex-bot-chatbot.netlify.app \
pnpm --filter @legal-chatbot/api e2e -- dashboard-lead-action
```

## Done-When (Spec SC) Verification Map

| Spec SC | Quickstart step | How verified |
|---|---|---|
| SC-001 | US1 walk-through, steps 3-5 | Open lead → click select → choose option → save (3 clicks total) |
| SC-002 | US2 walk-through | Em-dash vs. colored badge distinguishes "no action" from actioned |
| SC-003 | US1 walk-through, step 6 | Reload preserves selection + timestamp |
| SC-004 | US1 walk-through, step 5 | Timestamp matches local timezone, current time |
| SC-005 | Cross-account test | Vitest route test asserts 404 on cross-account update |
| SC-006 | Manual regression | Existing filter pills + classification + status badges still render correctly |

## Troubleshooting

- **Migration didn't apply.** Check `packages/api/drizzle/` for the
  generated `.sql` file. Run `pnpm db:migrate` again. Confirm via the
  schema-introspection query above.
- **404 on POST /api/dashboard/leads/[id]/action.** Check whether the
  lead exists for your account. Verify `session.accountId` matches
  `lead.account_id`. (Cross-account 404 is by design.)
- **Action picker not visible on the detail page.** Verify the
  feature branch is deployed. Hard-refresh / open in incognito to
  bypass cache.
- **Table column missing.** Verify the `<LeadTable>` component edit
  landed in the deployed bundle.

## References

- spec.md (this feature's spec)
- plan.md (this feature's implementation plan)
- contracts/lead-action-route-contract.md
- research.md (decisions log)
