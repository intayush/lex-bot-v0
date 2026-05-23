# Phase 0 Research: Dashboard

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document resolves Technical Context decisions for the
Dashboard against `product-spec-legal-chatbot.md` (§4.1–§4.7,
§8.1–§8.12, §1.10, §11.5, §12.11) and the Lex Bot Constitution
v1.0.0.

There were no `NEEDS CLARIFICATION` markers; items below are the
gap-fill plan for R1–R12.

## R1. Dashboard Package Co-location

**Decision**: Keep the dashboard implementation co-located with
the API in `packages/api/src/app/dashboard/`. The empty
`packages/dashboard/` workspace package remains as a placeholder
referenced by Constitution Required Stack. No code is moved.

**Rationale**:
- §9.7 deployment table row 1: "Dashboard + API | Netlify
  (`@netlify/plugin-nextjs`) | base directory `packages/api`".
  The two are deployed as ONE Next.js site sharing the same
  serverless functions, the same auth cookie, the same Drizzle
  client, and the same env vars. Co-location matches the
  deployment topology.
- §8.11 explicitly lists "Framework: Next.js (React)" once for
  the entire Dashboard surface — it is one Next.js app, not
  two.
- A separate `packages/dashboard/` Next.js app would require
  duplicating the auth helpers, the Drizzle client, the env
  loader, and the iron-session config. The duplication would
  drift over time.
- Constitution Required Stack lists `packages/dashboard` as a
  workspace package but does not mandate that it be the
  populated dashboard implementation. The empty package
  satisfies the workspace listing without forcing a deployment
  topology change.

**Alternatives considered**:
- **Move dashboard into `packages/dashboard/`**: rejected. Would
  require either (a) a second Netlify site, contradicting §9.7,
  or (b) running both Next.js apps under a single deploy via
  custom routing — adds complexity without §-anchor.
- **Remove the empty `packages/dashboard/` package**: rejected.
  Would require a Constitution amendment.

**Implementation notes**:
- Document this rationale in the plan and in
  `packages/dashboard/README.md` (NEW — a small note explaining
  why the package is intentionally empty).
- Future post-MVP work (e.g., white-labeling per §10) may
  revisit; at that point a Constitution amendment can move the
  implementation.

## R2. Account Signup + Password Reset

**Decision**: Add two new auth surfaces:

1. **Signup page** at `/signup` + `POST /api/auth/signup` route.
   Validates email + password (min length 8, complexity per
   standard practice) via Zod, hashes via bcryptjs, inserts
   `accounts` row, sets the iron-session cookie, redirects to
   `/dashboard/leads`.
2. **Password reset flow**:
   - `POST /api/auth/reset-password/request`: takes email,
     looks up account, generates a one-time token (nanoid),
     stores hashed token + expiry in a new `password_resets`
     table, sends email via SendGrid (or any SMTP — not yet
     bound by spec).
   - Reset page at `/reset-password?token=...`.
   - `POST /api/auth/reset-password/confirm`: validates token,
     updates `password_hash`, clears token, returns success.

**Rationale**:
- §8.2 binds: "Email/password authentication for MVP"
  (signup is implicit), "Password reset via email" (FR-004).
- The current implementation only has login + logout; signup
  and reset are missing.
- Constitution V (Privacy/Privilege) makes account-recovery a
  necessary anti-lockout safety mechanism.

**Alternatives considered**:
- Magic-link auth: rejected. §8.2 says "Email/password
  authentication for MVP".
- Defer signup entirely (manual provisioning by us): viable for
  pilot phase but doesn't match "30 minutes to install"
  promise of §1.7.

**Implementation notes**:
- Email provider: §8.2 doesn't bind one. Add a thin email
  adapter in `packages/api/src/lib/email.ts` that prefers
  `SENDGRID_API_KEY` or `RESEND_API_KEY` (whichever is in env)
  and falls back to console output in dev. This is captured in
  spec.md Assumption.
- Password reset tokens have 1-hour expiry; one-time use; stored
  hashed.
- Schema addition: `password_resets` table (R12).

## R3. Notifications Drawer + Bell + Unread Count

**Decision**: Add three components in `packages/api/src/app/dashboard/components/`:

- `<NotificationsBell>`: SVG bell icon in the dashboard header
  showing the unread count badge. Polls `/api/dashboard/notifications`
  every 30 seconds for fresh count (or uses `revalidateTag` if
  Next.js caching tags are configured).
- `<NotificationsDrawer>`: slide-out panel from the right edge
  (§8.7 "Notification drawer slides out"). Lists recent alerts
  (default 50). Each item links to `/dashboard/leads/{lead_id}`
  per §8.7 "Each notification links to the lead detail view".
- `<NotificationsPage>` (full listing): for older notifications,
  paginated.

Routes:
- `GET /api/dashboard/notifications?limit=50&offset=0` →
  list with unread-count metadata.
- `PATCH /api/dashboard/notifications/{id}` → mark read.
- `PATCH /api/dashboard/notifications` (no id, body `{ all: true }`)
  → mark all read.

**Rationale**:
- §8.7 binds the bell + unread-count + drawer + per-item link
  + mark-read / mark-all-read.
- FR-040–FR-045 enumerate.
- Notifications are written by Phase 5 (`006-lead-classification`)
  on urgent lead capture. This feature implements only the
  read + mark-read side.

**Alternatives considered**:
- Server-Sent Events for real-time push: post-MVP. §8.7 doesn't
  require real-time — polling every 30 seconds is acceptable
  for MVP.
- WebSocket connection: post-MVP per §10 "Conversation handoff"
  deferral; same infrastructure not built.

**Implementation notes**:
- The bell sits in `dashboard/layout.tsx` so it's visible on
  every authenticated page.
- Marking all read uses a single UPDATE WHERE account_id = ?
  AND read = false.
- Drawer is keyboard-accessible (Escape closes; Tab cycles).

## R4. Widget Installation Page

**Decision**: Add `/dashboard/widget-install` page with three
sections per §8.8:

### Step 1 — API Key Management

UI showing the active API key (masked: `lc_live_••••••••3xyZ`)
with a copy button and four actions:

- **Generate new key**: `POST /api/dashboard/api-keys` →
  generates `lc_live_<32-char nanoid>`, hashes via bcryptjs,
  inserts into `api_keys`, returns the **plaintext key once**
  (per §2.4 step 2: "the plaintext is shown once at generation,
  never again"). The response payload includes the plaintext
  AND the masked form for storage.
- **Revoke**: `DELETE /api/dashboard/api-keys/{id}` → sets
  `revoked_at = now()`.
- **Rotate**: `POST /api/dashboard/api-keys/{id}/rotate` →
  generates a new key in the same row's account, marks the old
  key for revocation in 24 hours (sets a `rotation_grace_until`
  timestamp; auth still works during the grace period).
- **View** (current): the masked form with copy button.

### Step 2 — Installation Snippet Generator

Tabs for: **Script Tag (HTML)**, **React Component**,
**Next.js**. Each tab pre-fills the lawyer's API key into the
canonical embed snippet. A "Copy to clipboard" button.

The script-tag snippet matches `005-chat-widget`'s CDN contract:

```html
<script src="https://cdn.legalchatbot.com/widget/v1/legal-chatbot.js"
        data-api-key="lc_live_xxxxxxxx"></script>
```

The React snippet:

```jsx
import { LegalChatbot } from '@legal-chatbot/widget';

<LegalChatbot apiKey="lc_live_xxxxxxxx" />
```

### Step 3 — Verify Installation

A button that calls `POST /api/dashboard/verify-install`,
which performs a HEAD request to a configured URL (the
lawyer's site) to detect whether the widget script is
loading. Shows green checkmark on success, troubleshooting
tips on failure (script not found, network error, CORS
issue, etc.).

**Rationale**:
- §8.8 binds the three-step structure.
- FR-046–FR-048.
- API-key plaintext-shown-once (§2.4 step 2) is a
  Constitution V binding.

**Alternatives considered**:
- Auto-rotate keys monthly: post-MVP. Not in spec.
- Multiple concurrent keys: viable but the spec allows it
  implicitly via the `label` column on `api_keys`. MVP shows
  one key per account; multi-key UI is a small extension.

**Implementation notes**:
- Schema addition: `api_keys.rotation_grace_until` column for
  the rotation grace window (R12). Alternatively, the auth
  layer treats `revoked_at > now() - 24h` as still valid; both
  work. The column is more explicit.
- Verify-installation probe runs server-side from Netlify,
  so it bypasses host-page CORS.

## R5. Crawler Status Page

**Decision**: Add `/dashboard/crawler-status` page reading the
manifest from the lawyer's `context_store_url` (the same URL
the API uses for context retrieval). Display:

- **Last crawl**: parsed from `_manifest.json`'s `generated_at`
  field.
- **Pages crawled**: parsed from `_manifest.json`'s
  `files.length`.
- **Context store URL**: from the API key row.
- **Health check**: green if the manifest fetch returns 200
  with valid JSON; red otherwise.

Three actions:

- **Re-crawl**: shows the CLI command to run on the lawyer's
  machine (the dashboard does NOT execute the crawl per §8.9
  "since crawler runs on their machine").
- **View manifest**: opens a side panel showing the parsed
  file list from `_manifest.json`.
- **Test context retrieval**: calls
  `POST /api/dashboard/test-context` with a query; the route
  invokes `searchContext` from `003-context-search` (with
  cache invalidated first per `003-context-search`'s contract)
  and returns the results.

**Rationale**:
- §8.9 binds the four status fields and three actions.
- FR-049–FR-052.

**Alternatives considered**:
- Schedule re-crawls from the dashboard: rejected. §8.9 is
  explicit that the crawler runs on the lawyer's machine.
  Adding cron-job scheduling would require a new
  infrastructure piece.

**Implementation notes**:
- The Re-crawl panel shows a copy-able command tailored to the
  lawyer's `context_store_url`.
- The Test context retrieval action calls
  `cache.invalidate(contextStoreUrl)` BEFORE invoking
  `searchContext` so the lawyer sees the freshest data.
- Health check has a 5-second timeout (consistent with Phase 2's
  `manifest-read-contract.md`).

## R6. Standalone Preview & Test Page

**Decision**: Add `/dashboard/preview` page that embeds the same
`<ChatWidget>` from `005-chat-widget` with:

- The lawyer's dev-only API key (separate from production keys
  to avoid accidental production traffic; or reuse the
  production key with `x-preview: true` header — the latter is
  what `004-chat-api-agent` already implements).
- A debug panel alongside the chat showing per-turn:
  - Tools called (names + parameters).
  - Files retrieved (paths + scores from `searchContext`).
  - Token usage (input + output).
- A "Reset" button clearing the conversation (per §8.10).

The Preview chat ALREADY exists inline in
`/dashboard/config/preview-chat.tsx` (101 LOC). R6 adds a
**standalone** preview page that's reachable from the sidebar
even when the lawyer isn't editing config.

**Rationale**:
- §8.10 binds the standalone Preview & Test page (separate from
  the inline preview in §8.4).
- FR-053–FR-057.
- The debug panel is the testing-feedback loop the lawyer
  needs to verify configuration changes affect chatbot
  behavior.

**Alternatives considered**:
- Only the inline preview: rejected. §8.10 is explicit about a
  standalone page reachable from sidebar nav.

**Implementation notes**:
- The preview page uses the same `<ChatWidget>` component but
  wraps it in a debug-instrumented harness. The widget's
  existing analytics events (Phase 4 R3) feed the debug panel.
- `x-preview: true` header is set so conversations don't
  appear in the Leads page (per §8.10 + Phase 3 implementation
  + Phase 5 partial-lead heuristic skip).
- Debug panel gets tool-call detail by enabling per-session
  debug mode (`enableSessionDebug(sessionId)` from
  Foundation logger) and reading the resulting log lines.
  Alternative: a separate `?debug=1` query parameter on
  `/api/chat` returns the same data inline. The simpler path
  is the analytics-events stream from the widget's `useChat`
  hook.

## R7. Lead Actions

**Decision**: Add seven actions to the lead-detail page, all
backed by `PATCH /api/dashboard/leads/{id}` or
`DELETE /api/dashboard/leads/{id}`:

| Action | Route + Method | Body / Effect |
|---|---|---|
| Mark as contacted | `PATCH /api/dashboard/leads/{id}` | `{ status: 'contacted' }` |
| Add internal note | `PATCH /api/dashboard/leads/{id}` | `{ internal_notes: '<text>' }` (appends with timestamp) |
| Dismiss | `PATCH /api/dashboard/leads/{id}` | `{ status: 'dismissed' }` |
| Export PDF | `GET /api/dashboard/leads/{id}/export?format=pdf` | Returns PDF download |
| Export JSON | `GET /api/dashboard/leads/{id}/export?format=json` | Returns JSON download |
| Delete with archival | `DELETE /api/dashboard/leads/{id}` | Writes to `archived_data`, then clears the row's PII fields (per §1.10 / §11.5 — see R7 sub-decision below) |

Bulk actions (§8.5):

- `POST /api/dashboard/leads/bulk` with body `{ ids: [...], action: 'contacted' | 'export' }`.

Pagination at 25/page implemented via `?page=N&pageSize=25`
query params on `/dashboard/leads`.

### R7 sub-decision: deletion semantics

Per §1.10:
- Lawyer-initiated deletion writes the lead's full row to
  `archived_data` (snapshot).
- Then clears or removes the original `leads` row's
  lawyer-visible content.

Two options:
1. **Hard-delete the row**: simpler; but the foreign key from
   `notifications.lead_id` would dangle.
2. **Clear PII fields, keep row**: preserves FK integrity but
   leaves an empty shell.

**Decision**: Hard-delete the `leads` row AND any
`notifications` rows referencing it (cascade). The
`archived_data` snapshot is the audit copy. This matches the
spec's intent ("removes from active view, retains in DB" —
"in DB" means the archived copy).

**Rationale**:
- §1.10 binds the archival pattern.
- §11.5 binds the deletion mechanism.
- FR-059 + Constitution V (Privacy/Privilege).
- Cascading delete on notifications keeps the schema clean.

### R7 sub-decision: PDF generation

PDF export uses `@react-pdf/renderer` (or a similar
React-based PDF renderer). Generated on the server (Netlify
Function), streamed back to the client. JSON export is a
direct serialization of the row + transcript.

**Alternatives considered**:
- Client-side PDF (`jsPDF`): viable but bloats the dashboard
  bundle; server-side is cleaner.
- Defer PDF entirely: rejected. §8.6 binds "Export as PDF/JSON".

## R8. Configuration Version History + Rollback

**Decision**: Extend the existing `/dashboard/config` page with
a version-history sidebar showing all prior `configurations`
rows for the account, sorted by `version` descending. Each
entry shows the timestamp, an `is_published` badge, and a "View
diff" affordance.

The diff view is a side-by-side rendering of the JSON config of
the selected version vs. the current draft. Use a small
diff-utility (`json-diff` or a hand-rolled
`diff-by-key` walker) to highlight changes per §4.5.

A "Rollback to this version" button calls
`POST /api/dashboard/config` with `{ action: 'rollback', version_id: '<id>' }`.
The handler:

1. Reads the historical row.
2. Inserts a new row with the historical `config_json`,
   incremented `version`, `is_published: false`.
3. Returns the new draft to the form for the lawyer to
   review and publish.

**Rationale**:
- §4.5 binds version history with timestamps + diff view +
  one-click rollback.
- FR-021–FR-024.

**Alternatives considered**:
- Inline rollback (UPDATE existing): rejected. The existing
  rows are immutable history; rollback creates a new draft
  derived from a historical snapshot.
- Library-based diff visualization (`react-diff-viewer`):
  viable; small dependency. Acceptable.

## R9. Privacy Policy Template Surface

**Decision**: Add a "Privacy & Compliance" section to the
Configuration form (Section H, beyond §4.3 A–G) that contains:

- **Privacy policy URL** (text input): the URL the widget links
  to from its consent banner (Phase 4 R5). Stored in the
  configuration JSON.
- **Privacy policy template** (textarea, pre-populated): a
  starter template with placeholders the lawyer customizes.
  Includes the §11.5 mandatory data-retention disclosure
  language. This is the "Draft a privacy policy template that
  lawyers can customize and link from the widget" item from
  §11.5.

The lawyer can either link to an external policy (URL field) or
host the template at a generated URL (`/p/{account_id}/privacy`
served by a public Route Handler — captured as Assumption).

**Rationale**:
- §11.5 binds: "Draft a privacy policy template that lawyers
  can customize and link from the widget."
- FR-060.

**Alternatives considered**:
- Single URL field, no template: rejected. The template is
  binding by §11.5.
- Markdown rendering: viable; defer to lawyer's preferred
  toolchain.

**Implementation notes**:
- The retention-disclosure language is the binding §1.10 +
  §11.5 wording. The template ships as a constant in
  `packages/shared/src/templates/privacy-policy.md` for reuse.
- Phase 7 hardening (`008-hardening`) FR-009 owns the GDPR
  Article 17 language for the same template.

## R10. Transcript Export

**Decision**: Add transcript export to the lead-detail page
(in addition to the row's JSON export from R7). The transcript
is the conversation rendered as a chat view, exported as PDF
or text. Implementation:

- `GET /api/dashboard/leads/{id}/transcript?format=pdf|text`
  → reads the `sessions.messages_json` for the lead's session,
  formats as a chat transcript, returns the file.

**Rationale**:
- §11.5 binds: "Ensure chat transcripts can be exported on
  request."
- FR-061.
- The lead JSON export (R7) is the structured data; the
  transcript is the conversational artifact. Both are useful
  for different reviewers (intake staff vs. legal counsel).

**Alternatives considered**:
- Single export endpoint that bundles row + transcript: viable;
  consider as a future combined-export option. MVP: separate.

## R11. Overview Page

**Decision**: Replace the current 5-LOC stub
`packages/api/src/app/dashboard/page.tsx` with a meaningful
Overview page showing:

- Welcome message ("Welcome back, {firm_name}").
- Recent activity: count of leads in the last 24h, last 7d,
  last 30d.
- Unread notifications count + link.
- Last crawl timestamp + Pages crawled.
- Quick links: Edit configuration, Embed widget, View leads.

**Rationale**:
- §8.3 lists "Overview (home)" as a binding navigation item.
- Without it, the sidebar's "Overview" item links to a stub.
- FR-006 + §8.3.

**Alternatives considered**:
- Skip Overview, redirect to Leads: §8.3 is explicit.

**Implementation notes**:
- All counts are simple Drizzle queries.
- The page is server-rendered for fast first paint.

## R12. Schema Additions

**Decision**: Three small schema changes via Foundation's
`drizzle-kit` migration tooling:

1. `password_resets` table (new, R2):
   ```sql
   CREATE TABLE password_resets (
     id text PRIMARY KEY,
     account_id text NOT NULL REFERENCES accounts(id),
     token_hash text NOT NULL,
     expires_at text NOT NULL,
     used_at text
   );
   CREATE UNIQUE INDEX password_resets_token_hash_unique ON password_resets(token_hash);
   ```

2. `leads.internal_notes` column (new, R7):
   ```sql
   ALTER TABLE leads ADD COLUMN internal_notes text;
   ```

3. `api_keys.rotation_grace_until` column (new, R4):
   ```sql
   ALTER TABLE api_keys ADD COLUMN rotation_grace_until text;
   ```

All three are forward-compatible additions. Migrations
generated via `pnpm --filter @legal-chatbot/api db:generate`.

**Rationale**:
- All three are required by R2, R4, R7 features. Foundation's
  migration tooling handles them idempotently.
- Constitution VII coordinates schema changes via the shared
  schema file in `packages/api/src/db/schema.ts`.

## Constitution Cross-Reference Summary

| Constitution element | Dashboard decision | Aligned |
|---|---|---|
| I (MVP-First) | All decisions cite §-anchors (§4.x, §8.x, §11.5, §12.11) | ✅ |
| II (Type Safety) | All mutation routes Zod-validate body; configurations parsed via shared `configurationSchema`; tool params for Test context retrieval Zod-validated | ✅ |
| III (TDD layered) | Helpers test-first (`leads-actions`, `api-keys`, `notifications`); pages covered by Playwright E2E (§9.8 row 3) | ✅ |
| IV (Serverless / Stateless) | All mutations via Route Handlers (§8.4 + §9.7) — NO Server Actions; iron-session cookie auth; no fs writes; bcryptjs only | ✅ |
| V (Privilege & Privacy) | Account-scoped reads on every query; deletion writes to `archived_data` (R7); transcript export (R10); cookie HTTP-only Secure; logger redaction | ✅ |
| VI (Observable Agent) | Dashboard surfaces agent-bounded properties (token usage, tool calls) via debug panel (R6); rate limits owned upstream | ✅ |
| VII (Phased Delivery) | Schema additions coordinated via Foundation tooling (R12); Preview chat reuses Phase 4 widget (R6); Test context retrieval reuses Phase 2 cache invalidation (R5) | ✅ |
| Required Stack | Next.js + Tailwind + Drizzle + bcryptjs + iron-session + Vitest + Playwright — all already in use | ✅ |
| Architectural Limits | Pagination 25/page; all other limits upstream | ✅ |

## Open Questions — None

All decisions resolve cleanly. No `NEEDS CLARIFICATION` markers
remain. Ready to proceed to Phase 1.
