# Contract: SOP State

**Owner**: SOP Workflow (`010-sop-workflow`)
**Source of Truth**: spec.md FR-041 to FR-044, FR-058 to FR-060.

## Persistent Shape (`sessions.sop_state_json`)

The full SOP runtime state per session, validated via Zod (`packages/shared/src/schemas/sop.ts → sopStateSchema`):

```ts
const sopStateSchema = z.object({
  sop_configuration_id: z.string(),
  sop_version: z.number().int().positive(),
  conversation_anchor_iso: z.string(),                  // ISO 8601 UTC
  steps: z.array(z.object({
    step_id: z.string(),
    slug: z.string(),
    status: z.enum(['pending', 'complete', 'skipped']),
    captured_value: z.string().nullable(),
    captured_at: z.string().nullable(),
    inferred: z.boolean(),
  })),
  qualified_lead_threshold: z.number().int().positive(),
  current_progress: z.number().int().nonneg(),
  is_finalized: z.boolean(),
  out_of_scope_termination: z.boolean(),
});
```

Stored as JSON-serialized text in `sessions.sop_state_json`.

## Wire Shape (`x-sop-state` Header)

Compact form sent to the widget on every chat-API response. The widget's `useSOPState` hook parses it and updates the `<ProgressBar>` state.

```ts
const sopStateHeaderSchema = z.object({
  current: z.number().int().nonneg(),
  total: z.number().int().positive(),
  pending_step_id: z.string().nullable(),
  pending_step_slug: z.string().nullable(),
  is_finalized: z.boolean(),
});
```

Header value: `JSON.stringify(payload)`. Total payload size: < 200 bytes typical, < 1 KB hard cap.

CORS: `Access-Control-Expose-Headers` MUST include `x-sop-state` so the widget's `fetch` reads it. The Phase 3 `cors.ts` is updated to add this.

## Initialization

- **Fresh session, account has published SOP**: agent initializes `sop_state_json` from the currently published SOP configuration; all steps `pending`.
- **Fresh session, account has NO SOP**: agent operates without SOP; widget hides the progress bar (FR-038); legacy §7.5 system-prompt flow is the fallback (out of scope for this feature; documented as edge case in spec.md).
- **Resumed session with existing `sop_state_json`**: state loaded as-is; SOP version that started the session is honored even if a newer SOP version has been published mid-conversation (FR-044).

## Transitions

State transitions are exhaustively documented in `data-model.md`. The route handler in `004-chat-api-agent` calls `lib/sop/state-machine.ts → advanceSOP(state, action)` after each turn. The function returns a new immutable `SOPState`.

## Persistence Lifecycle

| When | Action |
|---|---|
| First chat turn after session create | Initialize `sop_state_json` from published SOP, persist on existing `appendMessages` write |
| Each subsequent turn (`onFinish`) | Update `sop_state_json` in the same write that persists `messages_json` |
| At SOP finalization (Step 6 finalize OR out-of-scope termination) | Set `is_finalized=true`; `captureLead` snapshots the state to `leads.sop_state_snapshot` |
| Session expiry (30+ min idle) | No write. State remains as the last persisted value |

## Failure Modes

| Failure | Behavior |
|---|---|
| `sop_state_json` parse fails (Zod) on read | Re-initialize from currently published SOP; emit `sop_state_corrupted` log event with session_id |
| Published SOP referenced by `sop_configuration_id` no longer exists | Re-initialize from current published SOP; log warning |
| `qualified_lead_threshold` exceeds count of `counts_toward_threshold` steps | Validation error at config save (caught by Zod); never reaches state init |
| `x-sop-state` header missing on response | Widget falls back to last-known state (or hides bar if no prior state) |

## Logging

All transitions emit Foundation logger events (per spec.md FR-058). Payload conventions:

- Captured-value summaries are 30-char-truncated AND PII-redacted (regex strips emails, phones, names matching `\b[A-Z][a-z]+\s+[A-Z][a-z]+\b` patterns).
- Step ids and slugs are NOT redacted (Constitution V tolerates these as non-PII identifiers).

## Tests

Unit tests in `packages/api/src/lib/sop/state-machine.test.ts` MUST cover:

- Initialization from a published SOP creates `pending` rows for each step in order.
- `capture_step` action flips status to `complete` and sets `captured_at`.
- `skip_step` action flips status to `skipped` and leaves `captured_at` null.
- `finalize` action with all required steps complete sets `is_finalized=true`.
- `finalize` action with required steps still pending throws (state machine refuses).
- Out-of-scope termination action sets both `is_finalized=true` AND `out_of_scope_termination=true`.

