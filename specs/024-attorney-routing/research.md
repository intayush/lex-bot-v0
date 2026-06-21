# Phase 0 — Research: Attorney Management & Hot Lead Email Routing

**Feature**: 024-attorney-routing · **Date**: 2026-06-21

---

## R1 — Queue Technology

**Decision**: Use the existing `notifications` table as a durable queue. Email-channel rows have `delivery_channel = 'email'` and `delivered_at = null` (pending). The `runAfterResponse()` / `next/server after()` mechanism (already in production for spec 021) acts as the consumer.

**Rationale**:
- Constitution IV prohibits persistent workers — BullMQ requires Redis, SQS requires infra provisioning, both violate the Netlify serverless constraint.
- The `notifications` table already has `delivery_channel` (text), `delivered_at` (nullable), and `lead_id` FK. Adding `attorney_id` FK and writing rows with `delivery_channel = 'email'` creates a durable pending-message queue with zero new infrastructure.
- `runAfterResponse()` is already battle-tested in the codebase (spec 021, leads deferred writes). It runs after the HTTP response, so the chatbot latency is unaffected.
- Durability: if the serverless function crashes mid-send, the `notifications` row remains with `delivered_at = null` and can be retried (e.g. by a scheduled cleanup job or on next HOT lead for the same session — out of scope, but the data is not lost).

**Alternatives considered**:
- BullMQ + Redis — rejected (Constitution IV: no persistent server processes).
- Inngest — rejected (external SaaS dependency, adds cost, overkill for this volume).
- AWS SQS — rejected (requires AWS credentials, external infra, violates serverless simplicity).
- pg_notify — rejected (requires a persistent listener process; not compatible with serverless).

---

## R2 — Email Provider

**Decision**: **Resend** (`resend` npm package). One-file integration, official Next.js/Netlify support, TypeScript SDK, 3,000 free emails/month.

**Integration pattern**:
```typescript
// packages/api/src/lib/email.ts
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  return resend.emails.send({ from: process.env.EMAIL_FROM ?? 'noreply@legalchatbot.com', to, subject, html });
}
```

**Environment variables required**:
- `RESEND_API_KEY` — API key from Resend dashboard
- `EMAIL_FROM` — verified sender address (e.g. `leads@firm.com`)

**Alternatives considered**:
- Nodemailer + SMTP — rejected (requires SMTP server credentials, more complex config, not serverless-native).
- SendGrid — heavier SDK, more opinionated templates.
- AWS SES — requires AWS credentials, IAM setup.

---

## R3 — UI Placement

**Decision**: New `'Attorneys'` string tab appended to the `tabs` array in `config-form.tsx`. Renders an `AttorneysTab` client component alongside the existing Persona/Boundaries/Escalation/Contact/Custom tabs.

**Rationale**:
- Attorneys are firm-level configuration data, not SOP workflow data → belongs in the Configuration page, not the SOP editor.
- The config-form tab pattern is simpler than the SOP editor's TabId enum — just a string in an array, activeTab = index. Matches the existing 5 tabs perfectly.
- The page's server-side fetch already passes `history` and `latestVersionId` through — attorney data can be passed the same way.

---

## R4 — Routing Trigger Location

**Decision**: Inside `captureLead()` in `packages/api/src/lib/leads.ts`, immediately AFTER the existing `urgent_lead` notification INSERT (lines 430-442). Wrapped in the existing `runAfterResponse()` deferred path.

**Exact insertion point**: After `emitLeadClassifiedLog()` call (line 443), still within the `if (wasNotUrgent && isStillUrgent)` block. The routing also fires when the INSERT branch creates a HOT lead for the first time.

**Rationale**: Reuses the HOT check that already exists. The deferred path (spec 021) ensures zero latency impact. Fits the existing pattern perfectly.

---

## R5 — Attorney Data Scope

**Decision**: Attorneys are scoped to `account_id`. Case type assignments reference `case_type_slug` (not `case_type_id`) to decouple from the case_types table's PK — slug is the stable identifier.

**Rationale**: When a routing notification fires, the lead's `case_type` is already a slug string (from the SOP state). Matching attorneys by slug avoids a join and simplifies the routing query.

---

## Open Questions Resolved

All NEEDS CLARIFICATION items from the spec have been resolved above. Ready to proceed to Phase 1.
