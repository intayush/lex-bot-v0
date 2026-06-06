# Quickstart: Multi-Branch SOP Workflow

**Feature**: 016-multi-branch-sop · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

This is the developer quickstart for implementing and validating the
feature. Follow the order; each section is independently testable per
Constitution III.

## Prerequisites

```sh
# From repo root
pnpm install --frozen-lockfile
pnpm db:migrate         # apply pending migrations including 0004 once it lands
pnpm db:seed            # seeds the new default SOP (6 steps) and the Car Accident branch
```

**Pre-feature baseline (recorded T001 on 2026-06-06)**: shared 77 / api 468 / widget 27 / crawler 56 = 628 tests, 38 files, all green; `pnpm typecheck` clean.

## 1. Reproduce the bug (red test for FR-034)

Replay the negative-flow scenario from `negative-sop-flow.json`
against the current `main` branch. Expected: the assistant asks
car-accident-specific questions for an Assault Charges case
(driver/passenger, insurance, work impact). This is the regression.

```sh
# Run the new Playwright spec — should FAIL on main, PASS after the fix
pnpm --filter @legal-chatbot/api test:e2e -- smoke-016-criminal-defense
```

The spec drives:

- Visitor chooses Criminal Defense → Assault Charges.
- Steps 3–6 answered in default order.
- Asserts no chip whose label contains "driver", "passenger",
  "insurance", or "missed work" ever renders.
- Asserts the lead is captured with classification + null score
  (default-only path).
- Asserts the assistant ends with an open-ended re-prompt.

## 2. Add the new database tables

`packages/api/src/db/schema.ts`:

- Add `branches` table per `data-model.md`.
- Add `branch_versions` table per `data-model.md`.
- Add `branch_snapshot_json` and `branch_incomplete` columns to `leads`.
- Mark `sub_types.scoring_config_json` with a JSDoc `@deprecated`
  comment pointing at this spec.

Generate the migration:

```sh
pnpm --filter @legal-chatbot/api drizzle:generate
# Inspect the generated SQL; rename to 0004_multi_branch_sop.sql
```

Add a TypeScript migration body (a `.ts` sibling) for the data copy
from `sub_types.scoring_config_json` → `branches` + `branch_versions`.
Test it (Constitution III):

## 3. Add the Zod schemas

`packages/shared/src/schemas/branch.ts`:

- `branchChipSchema`
- `branchQuestionSchema` (with refinement for unique chip slugs)
- `branchVersionSchema`
- `branchSchema`
- `branchSnapshotSchema`
- `branchesListResponseSchema`
- `branchDetailResponseSchema`
- `branchSaveRequestSchema`

Re-export from `packages/shared/src/index.ts`.

```sh
pnpm --filter @legal-chatbot/shared test -- schemas/branch
pnpm tsc --noEmit
```

## 4. Implement the runtime modules

In dependency order:

1. `packages/api/src/lib/sop/branch-lookup.ts` (+ test)
2. `packages/api/src/lib/sop/branch-advancer.ts` (+ test)
3. `packages/api/src/lib/sop/branch-snapshot.ts` (+ test)
4. `packages/api/src/lib/scoring/score-lead-partial.ts` (+ test)

Each test file is colocated with its source; tests written FIRST and
visible in the diff before implementation (Constitution III).

```sh
pnpm --filter @legal-chatbot/api test -- lib/sop/branch
pnpm --filter @legal-chatbot/api test -- lib/scoring/score-lead-partial
```

## 5. Wire the runtime into the chat route

`packages/api/src/app/api/chat/route.ts`:

- Remove `analyzeAndFollowUp` from the tools map.
- Delete `packages/api/src/lib/sop/follow-up-tool.ts` and its test.
- Add the structural test
  `packages/api/src/app/api/chat/tool-registry.test.ts` per
  `contracts/tool-registry-contract.md`.

Update `packages/api/src/lib/sop/advancer.ts`:

- After Step 6 (contact) satisfies, call `lookupBranch`.
- If null → finalize default-only.
- Otherwise → enter `branch_running` state and on every subsequent
  visitor turn call `advanceBranch`.

```sh
pnpm --filter @legal-chatbot/api test -- chat/tool-registry
pnpm --filter @legal-chatbot/api test -- lib/sop/advancer
```

## 6. Update the contact-form satisfaction predicate

`packages/api/src/lib/sop/contact-form.ts`:

- Update the satisfaction predicate to: `email != null || phone != null`
  (name optional).
- Add `contact_retry_count` handling per FR-002a (R4).
- On third failure, transition to `terminated_no_contact` and emit
  the configured polite acknowledgement.

```sh
pnpm --filter @legal-chatbot/api test -- lib/sop/contact-form
```

## 7. Update the skip-detector for sequence-safe contact capture

`packages/api/src/lib/sop/skip-detector.ts`:

- When contact info is detected before Step 6 is reached in sequence,
  stash into `sopState.pending_contact` but DO NOT mark Step 6
  complete (FR-005a / R5).
- When the advancer reaches Step 6 with `pending_contact` non-empty,
  emit the configurable confirmation prompt and treat the next visitor
  message as a confirm/correct.

```sh
pnpm --filter @legal-chatbot/api test -- lib/sop/skip-detector
```

## 8. Implement the admin Branches API

`packages/api/src/app/api/admin/branches/route.ts` and
`.../admin/branches/[caseType]/[subType]/route.ts` per
`contracts/branches-admin-api.md`.

```sh
pnpm --filter @legal-chatbot/api test -- api/admin/branches
```

## 9. Build the admin Branches dashboard tab

`packages/dashboard/src/app/dashboard/sop/`:

- Add a third tab labelled "Branches" to the existing tab strip.
- `branches-tab.tsx`: list of (case_type, sub_type) pairs with status
  pills.
- `branch-editor.tsx`: side-panel editor for questions + chips +
  weights + thresholds + toggles.
- Wire to the admin API endpoints from §8.
- Hook into the existing Preview & Test chat (per FR-027).

```sh
pnpm --filter @legal-chatbot/dashboard test -- branches-tab
pnpm --filter @legal-chatbot/dashboard test -- branch-editor
```

## 10. Update the leads dashboard

`packages/dashboard/src/app/dashboard/leads/`:

- Surface `branch_incomplete: true` as a badge in the lead list (FR-011b).
- In the lead detail view, render the `branch_snapshot_json` payload
  (questions + captured chips + score + classification).

## 11. Run the green tests

```sh
pnpm tsc --noEmit
pnpm eslint .
pnpm vitest run
pnpm turbo build
pnpm test:e2e -- smoke-016
```

Both `smoke-016-personal-injury.spec.ts` (happy path) and
`smoke-016-criminal-defense.spec.ts` (regression) MUST pass.

## 12. Manual verification

1. Visit `/dashboard/sop`, click the Branches tab.
2. Confirm Personal Injury → Car Accident shows
   `Configured · Active` with version 1 (post-migration).
3. Confirm every other (case_type, sub_type) pair shows
   `Not configured`.
4. Click `Edit branch` on Car Accident, change the "Driver" chip
   weight from 10 to 15, Save, then Publish.
5. Open the widget; walk Personal Injury → Car Accident through
   Step 6 → branch fires. Confirm the new weight propagates to the
   final lead score.
6. Open a fresh session; walk Criminal Defense → Assault Charges
   through Step 6. Confirm no branch question is asked. Send
   "what does the consultation cost?" — confirm the assistant answers
   within guardrails without re-running the SOP.

## Rollback

1. Revert the dashboard PR; runtime continues to work.
2. Revert the chat route PR; agent regains `analyzeAndFollowUp`
   (regression returns but is recoverable).
3. Drizzle migration is forward-only; set every `branches.is_active`
   to 0 to disable the runtime branch path. Falls back to default-only
   finalization for every pair.

The deprecated-but-not-dropped `sub_types.scoring_config_json` column
is the safety net: if the migration data-copy is bad, the column still
has the spec 015 source-of-truth and a follow-up patch can re-run the
copy.
