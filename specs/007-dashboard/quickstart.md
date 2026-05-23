# Quickstart: Dashboard

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This quickstart shows the lawyer's experience after the Dashboard
feature is fully implemented. It validates the §12.11 done-when
checklist plus per-page acceptance scenarios.

## Prerequisites

- Foundation, Crawler, Context Search, Chat API + Agent, Chat
  Widget, Lead Classification all complete.
- Local dev testbed running: API + dashboard at
  `http://localhost:3000`, widget demo at
  `http://localhost:5173`.
- Schema migrations applied via `pnpm db:migrate` (R12 columns
  + tables).
- Dev seed inserted (`pnpm db:seed`): account
  `dev@legalchatbot.com` / `password123`, an API key, a
  published configuration.

## §12.11 Deliverable Walkthrough

Open `http://localhost:3000/dashboard` (redirects to `/login`).
Log in with `dev@legalchatbot.com` / `password123`. Land on
`/dashboard/leads`.

Expected outcomes (matching §12.11 done-when):

| Criterion | Verification |
|---|---|
| Login works with test credentials | Login → redirect to `/dashboard/leads` succeeds |
| Leads page shows all leads from Phase 5 testing | Captured leads visible in the table |
| Lead detail shows the full chat transcript | Click a lead row → detail page renders Lead Information Panel + Chat Transcript |
| Guardrails form saves and creates a new version | Edit a field on `/dashboard/config`, click Save, query `configurations` table to confirm a new row with incremented `version` |
| Preview chat uses the updated (unpublished) configuration | Click into the preview pane next to the form; chat reflects the unsaved-then-saved (unpublished) draft |
| Publish button makes config live (next real conversation uses it) | Click Publish; drive a new conversation in the widget at `localhost:5173`; agent uses new config |
| Manual browser verification of all pages | Visit each of: Overview, Leads, Lead Detail, Configuration, Notifications, Widget Installation, Crawler Status, Preview & Test |

## Per-Page Verification

### Overview (R11)

`/dashboard` shows:

- Welcome message with firm name.
- Lead counts: 24h, 7d, 30d.
- Unread notifications count (with link).
- Last crawl + pages crawled.
- Quick links.

### Configuration with Version History (R8)

`/dashboard/config` shows the form. Sidebar shows version
history. Click an old version → diff panel shows changes vs.
current draft. Click "Rollback to this version" → new draft
created from historical content; redirected to form prefilled
with that content.

### Notifications Bell + Drawer (R3)

The bell icon in the dashboard header shows the unread count.
Drive an urgent conversation in the widget; within 30 seconds
the bell badge increments. Click the bell → drawer slides out
showing the notification with title `"New urgent lead: <case_type> from <name>"`.
Click the notification → navigate to the lead detail.

Click "Mark all as read" → count → 0; drawer items fade.

### Widget Installation (R4)

`/dashboard/widget-install` shows three sections:

1. API Key Management with the active key (masked,
   `lc_live_••••••••3xyZ`). Click "Generate new key" →
   modal shows the plaintext ONCE; copy it. Click "Revoke" on
   an old key → confirmation; status updates.
2. Installation Snippet with tabs (Script / React / Next.js).
   Each tab pre-fills the API key. Copy button works.
3. Verify Installation: paste a URL where the widget is
   embedded → click Verify → green checkmark on success or
   actionable error message.

### Crawler Status (R5)

`/dashboard/crawler-status` shows:

- Last crawl: timestamp from manifest.
- Pages crawled: file count from manifest.
- Context store URL.
- Health check: green or red.

Three actions:

- **Re-crawl**: shows a copyable CLI command with the
  configured URL and output path.
- **View manifest**: opens a side panel listing every file in
  the manifest with title, section_type, word_count,
  content_hash.
- **Test context retrieval**: textbox + Run button. Type
  "personal injury" → see results from the seeded Shrager
  content.

### Preview & Test (R6)

`/dashboard/preview` embeds the same widget the lawyer's
website uses, with `x-preview: true` so conversations don't
appear in Leads. Alongside the chat: a debug panel showing
per-turn tools called, files retrieved (with scores), and
token usage.

Click "Reset" → conversation cleared; fresh session.

### Lead Actions (R7)

Click into any lead. Sidebar actions:

- **Mark as contacted** → status updates (badge changes).
- **Add internal note** → modal; type a note → submits;
  appears in the lead detail with a timestamp prefix.
- **Dismiss** → status changes; lead disappears from default
  Leads view (toggle "include dismissed" to see again).
- **Export PDF**: downloads a PDF of the lead row + transcript.
- **Export JSON**: downloads a JSON file.
- **Delete**: confirmation modal warning about archival; on
  confirm, lead is removed from view; verify
  `archived_data` row exists with the snapshot.

### Bulk Actions (R7)

On the Leads page, select multiple leads via checkboxes; click
"Mark contacted" or "Export" → bulk operation runs.

### Pagination (R7)

If you have >25 leads, the page shows pagination controls;
navigate pages.

## Auth Flows (R2)

### Signup

Navigate to `/signup` (link from `/login`). Fill email,
password, optional firm name. Submit → auto-logged in →
redirected to `/dashboard/leads`.

### Password Reset

From `/login`, click "Forgot password?". Enter email →
"Check your email for a reset link." (Dev mode prints the
link to console; production sends via SendGrid/Resend.)

Click the link → `/reset-password?token=...`. Enter new
password → submit → "Password updated; you can log in now."

## Privacy Policy Template (R9)

In `/dashboard/config`, the new "Privacy & Compliance" section
shows:

- **Privacy policy URL** input (linked from the widget's
  consent banner per Phase 4).
- **Privacy policy template** textarea pre-populated with the
  binding §11.5 + §1.10 disclosure language.

## Transcript Export (R10)

On a lead detail page, click "Export transcript" → choose PDF
or text → download.

## Run the Test Suite

```bash
pnpm --filter @legal-chatbot/api test
pnpm test:e2e             # Playwright tests of dashboard flows (post-Phase 6 setup)
```

Expected: all unit tests for new helpers pass; Playwright E2E
covers login, configure, view leads (per §9.8 row 3 binding).

## §12.11 Done-When Verification Map

| §12.11 done-when | Quickstart step |
|---|---|
| Login works with test credentials | "Open `http://localhost:3000/dashboard` …" above |
| Leads page shows all leads from Phase 5 testing | Same |
| Lead detail shows the full chat transcript | "Click a lead row →" above |
| Guardrails form saves and creates a new version | "Edit a field on `/dashboard/config`" above |
| Preview chat uses the updated (unpublished) configuration | "Click into the preview pane" above |
| Publish button makes config live | "Click Publish" above |
| Manual browser verification of all pages | "Per-Page Verification" sections above |

## Out of Scope for This Quickstart

- Production deploy — Phase 8 (`009-deployment-release`).
- Cost monitoring + spend alerts — Phase 7
  (`008-hardening` FR-001 to FR-005).
- Optional prompt-injection classifier — Phase 7
  (`008-hardening` FR-014).

