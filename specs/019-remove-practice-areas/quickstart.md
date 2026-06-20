# Quickstart & Validation Guide: Remove Practice Areas (019)

**Branch**: `019-remove-practice-areas`
**Date**: 2026-06-20

---

## Prerequisites

- `pnpm dev` running (API + widget test app)
- DB seeded: `pnpm db:seed`
- Logged into the dashboard at `http://localhost:3000/dashboard`

---

## Scenario 1 — Practice Areas Tab Is Gone from Configuration

**Validates**: FR-001, US1

1. Open `http://localhost:3000/dashboard/config`
2. Observe the tab bar.

**Expected**: Tabs are `Persona | Questions | Boundaries | Escalation | Contact | Custom`. No "Practice Areas" tab.

**What would fail (old behavior)**: "Practice Areas" tab visible as tab index 1.

---

## Scenario 2 — Out-of-Scope Response Field Exists and Is Editable

**Validates**: FR-002, FR-003, US2

1. Open Configuration → Boundaries tab.
2. Scroll to the bottom of the tab.

**Expected**: An "Out-of-Scope Response" textarea is present, pre-populated with the account's saved value.

3. Edit the text to `"TEST: We don't handle that matter."`, click **Save Draft**, then **Publish**.
4. Start a new chat session on the widget test app.
5. Ask the chatbot about an out-of-scope topic (e.g., "Can you help me with a tax dispute?").

**Expected**: Chatbot responds with `"TEST: We don't handle that matter."` (or similar, using the updated text in its deflection).

---

## Scenario 3 — Greeting Quick-Reply Chips Come from Case Types

**Validates**: FR-006, FR-007, FR-008, FR-009, US3

1. Open the SOP → Case Types tab.
2. Mark "Estate Planning" as **out-of-scope** (if it is currently in-scope). Save.
3. Open a new widget session on the test app.

**Expected on greeting screen**: "Estate Planning" chip does NOT appear. All other in-scope case types appear in position order.

4. Mark "Estate Planning" back as **in-scope**. Save.
5. Open a new widget session.

**Expected**: "Estate Planning" chip appears.

6. Tap any greeting chip (e.g., "DUI").

**Expected**: Message `"I need help with DUI"` is sent; SOP Step 1 (case type) registers as captured.

---

## Scenario 4 — System Prompt Uses Case Types Only (No Legacy Fallback)

**Validates**: FR-011, FR-012, US4

1. Using a test account or dev tools, inspect the system prompt for an active chat session (check structured logs for `system_prompt` or `messages[0].content`).

**Expected**: The `## Practice Areas (In Scope)` block lists case type labels matching the in-scope rows — not strings from the old `practice_areas.active` config array.

2. Temporarily remove all case types from the account (or mark all out-of-scope).
3. Start a new chat session; inspect the system prompt.

**Expected**: `## Practice Areas (In Scope)` block is present but empty (no bullet items). The bot does NOT fall back to old practice_areas strings.

---

## Scenario 5 — Existing Accounts Don't Lose Their Deflection Text

**Validates**: FR-015, SC-004

1. Before running the feature, note the current `out_of_scope_response` value for a test account (check via the Configuration → Boundaries tab after deploy).
2. Deploy the feature.
3. Open Configuration → Boundaries.

**Expected**: The "Out-of-Scope Response" field is pre-populated with the same text that was previously stored in `practice_areas.out_of_scope_response`. No data loss.

---

## Scenario 6 — Save Does Not Corrupt Old `practice_areas` Data

**Validates**: FR-004, SC-001

1. Save the Configuration form (any tab, any change).
2. Inspect the stored `config_json` in the DB (or via the API).

**Expected**: The saved JSON includes the promoted `out_of_scope_response` field at the top level. Any prior `practice_areas` key that was in the JSON is still present (not deleted).

---

## Unit Test Runs

```bash
# Shared schema tests
pnpm --filter @legal-chatbot/shared exec vitest run

# System prompt tests (removes legacy fallback test)
pnpm --filter @legal-chatbot/api exec vitest run src/lib/system-prompt.test.ts

# Widget tests (field renamed)
pnpm --filter @legal-chatbot/widget exec vitest run
```

All must pass with zero failures.

## Type Check

```bash
pnpm --filter @legal-chatbot/shared exec tsc --noEmit
pnpm --filter @legal-chatbot/api exec tsc --noEmit
pnpm --filter @legal-chatbot/widget exec tsc --noEmit
```

Zero errors. Specifically confirm that `config.practice_areas.out_of_scope_response` no longer appears anywhere — TypeScript will flag it as an access on an optional field.
