# Implementation Plan: Attorney Management & Hot Lead Email Routing

**Branch**: `024-attorney-routing` | **Date**: 2026-06-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/024-attorney-routing/spec.md`

## Summary

Two self-contained deliverables:

1. **Attorney management UI** — A new "Attorneys" tab in the Configuration page. Lawyers add/edit/delete attorney records (name, email, mobile, case type assignments). Data stored in two new tables: `attorneys` and `attorney_case_type_assignments`.

2. **HOT lead email routing** — When `captureLead` fires with a HOT classification, a routing notification is published to a queue (implemented as a database-backed queue using the existing `notifications` table with `delivery_channel = 'email'`). The Next.js 15 `after()` API (already used via `runAfterResponse()`) consumes the queue entry and dispatches an email to every attorney whose case type matches the lead's case type, using **Resend** as the email provider.

No new queue infrastructure (Redis, BullMQ, SQS) is required: the `notifications` table row with `delivery_channel = 'email'` IS the queue message. `runAfterResponse()` is the queue consumer — it runs after the HTTP response is sent, reads the pending email notification, and calls Resend. This architecture satisfies the spec's queue constraint while respecting Constitution IV (serverless-compatible, no persistent processes).

## Technical Context

**Language/Version**: TypeScript (strict), Node.js 20+

**Primary Dependencies**: Next.js 15.3 (Route Handlers + `after()` from `next/server`), Drizzle ORM, `@neondatabase/serverless`, **Resend** (new — transactional email provider, Vercel/Netlify native). Zod for validation.

**Storage**: Neon PostgreSQL. Two new tables: `attorneys`, `attorney_case_type_assignments`. Existing `notifications` table extended with `attorney_id` nullable FK for email-channel rows.

**Testing**: Vitest (unit + integration). New unit tests cover the attorney routing logic and email dispatch. Playwright e2e walk for the attorney management UI.

**Target Platform**: Netlify Functions running Next.js 15. `after()` is supported.

**Project Type**: pnpm + Turborepo monorepo. This feature touches `packages/api` only.

**Performance Goals**: HOT lead email reaches attorney within 60 seconds (SC-002). Attorney CRUD operations complete within 1 second (SC-001).

**Constraints**:
- Constitution IV: `after()` is the correct async mechanism — no persistent process/worker allowed.
- Constitution V: Attorneys are account-scoped; no cross-account data exposure.
- Constitution VI: No new agent tools, `maxSteps` unchanged.
- Attorney email addresses must be unique per account (unique index on `account_id, email`).
- Routing fires only on HOT classification, only when at least one matching attorney exists.

**Scale/Scope**: Per spec, routing is at the top-level case type (not sub-type). A firm might have 2-20 attorneys, each covering 1-5 case types.

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. MVP-First Discipline | ✅ PASS | US1 (attorney CRUD) and US2 (email routing) are the minimal viable scope. No scope expansion. |
| II. Type Safety & Schema-Validated Boundaries | ✅ PASS | All new API routes use Zod. Attorney and case type assignment shapes are typed. Resend payloads are typed via the Resend SDK. |
| III. Test-First, Layered Testing Strategy | ✅ PASS | Unit tests for routing logic (which attorneys match a given case type); integration test for email dispatch using a mocked Resend client. |
| IV. Serverless-Compatible & Stateless Server Architecture | ✅ PASS | `runAfterResponse()` / `after()` is the established pattern in this codebase. No Redis, no BullMQ, no persistent worker. The `notifications` table row serves as the durable queue entry — if the function crashes, the row remains undelivered and can be retried. |
| V. Privilege, Privacy, and Data-Boundary Integrity | ✅ PASS | All attorney queries are scoped to `account_id` from the auth session. Attorney email addresses are not exposed to the widget or any public endpoint. |
| VI. Bounded, Observable, Cost-Aware Agent | ✅ PASS | No agent tools modified. Email dispatch is outside the LLM path. |
| VII. Phased Incremental Delivery | ✅ PASS | US1 (attorney UI) ships and is usable independently. US2 (routing) depends only on US1 data existing. |

**Result**: PASS on all seven principles.

## Project Structure

### Documentation (this feature)

```text
specs/024-attorney-routing/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── contracts/
│   ├── attorneys-api.md
│   └── routing-queue-contract.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/api/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── dashboard/
│   │   │       └── attorneys/
│   │   │           └── route.ts            # NEW: GET list, POST create
│   │   │           └── [id]/
│   │   │               └── route.ts        # NEW: PATCH update, DELETE
│   │   └── dashboard/
│   │       └── config/
│   │           ├── page.tsx                # EDIT: fetch attorneys + case types server-side
│   │           ├── config-form.tsx         # EDIT: add Attorneys tab
│   │           └── attorneys-tab.tsx       # NEW: attorney list + add/edit/delete UI
│   ├── db/
│   │   └── schema.ts                       # EDIT: add attorneys, attorney_case_type_assignments tables; extend notifications
│   └── lib/
│       ├── attorneys.ts                    # NEW: CRUD helpers + routing query
│       ├── email.ts                        # NEW: sendEmail() abstraction over Resend
│       └── leads.ts                        # EDIT: publish routing notification in captureLead
├── drizzle/                                # NEW: migration for attorneys + assignments tables
└── package.json                            # EDIT: add resend dependency
```

## Complexity Tracking

> No Constitution violations. One new npm dependency (Resend) is justified — no email infrastructure exists and Resend is the lightest serverless-compatible option.

---

## Phase 0 — Research

See [research.md](./research.md).

**R1: Queue technology decision**
- Decision: Use the existing `notifications` table as the durable queue. A row with `delivery_channel = 'email'` and `delivered_at = null` is a pending message. `runAfterResponse()` is the consumer. This avoids all new infrastructure.
- Rationale: Constitution IV prohibits persistent workers. The `notifications` table already has `delivery_channel` (text, default 'dashboard') and `delivered_at`. Adding `attorney_id` FK and `delivery_channel = 'email'` rows makes it a durable queue with zero new infra.
- Alternative considered: BullMQ/Redis — rejected (Constitution IV, no Redis on Netlify serverless). Inngest — rejected (external dependency, adds cost/complexity). AWS SQS — rejected (same reasons).

**R2: Email provider decision**
- Decision: **Resend** (`resend` npm package). One function call, Netlify-native, generous free tier (3,000 emails/month), TypeScript-first SDK.
- Alternative considered: Nodemailer+SMTP — rejected (requires SMTP credentials management, more config). SendGrid — heavier SDK.

**R3: Attorney management UI placement**
- Decision: New "Attorneys" tab in the Configuration page (`config-form.tsx`), consistent with existing Persona/Boundaries/Escalation/Contact/Custom tabs. Simple string tab ID `'Attorneys'` added to the tabs array.
- Rationale: Attorneys are firm-level configuration data. The Configuration page already has the right server-side data fetching pattern and the PreviewChat sidebar.

**R4: Routing trigger location**
- Decision: Inside `captureLead()` in `leads.ts`, immediately after the existing `urgent_lead` notification INSERT (lines 430-442). The routing notification is enqueued via `runAfterResponse()` exactly as the leads-side writes are already deferred (spec 021).
- Rationale: The HOT classification check already exists there. Reusing the same deferred path keeps the routing zero-latency-impact.

---

## Phase 1 — Design

### Data Model

See [data-model.md](./data-model.md).

New tables:
- `attorneys` — per-account attorney roster
- `attorney_case_type_assignments` — many-to-many: attorney × case_type

Modified:
- `notifications` — add `attorney_id` nullable FK (for email-channel routing rows)

### Contracts

See `contracts/`:
- `contracts/attorneys-api.md` — CRUD endpoints for attorney management
- `contracts/routing-queue-contract.md` — the routing notification message shape and dispatch contract

### Quickstart

See [quickstart.md](./quickstart.md). Manual validation: add attorney → trigger HOT lead → confirm email.

### Agent Context Update

`CLAUDE.md` updated to reference `specs/024-attorney-routing/plan.md`.
