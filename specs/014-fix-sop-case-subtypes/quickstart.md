# Quickstart — Verify 014 Fix SOP Case Sub-Type Chips

**Feature**: 014-fix-sop-case-subtypes
**Branch**: `014-fix-sop-case`

This document walks you through manually verifying every user story in
the feature spec after the implementation lands. Each section assumes a
fresh local checkout with `pnpm install` already run.

## Prerequisites

```bash
# In the repo root:
pnpm install
pnpm db:migrate          # apply existing schema (no new migrations in this feature)
pnpm db:seed             # seed defaults including DUI/PI/etc. with sub-types
pnpm dev                 # bring up the API + dashboard + widget testbed
```

Open the dashboard at `http://localhost:3000/dashboard/login` and sign
in with the dev seed credentials (see `packages/api/src/db/seed.ts`).

## Story 1 — Visitor sees correct sub-type chips

1. Open the widget test page at `http://localhost:5173/` (the local
   widget testbed served by `pnpm dev`).
2. Open the chat panel and wait for the case-type chip row to render.
3. Tap the **DUI** chip.
4. **Verify**: the next assistant message asks "What kind of DUI matter
   is this?" (with the literal token `{case_type}` replaced by `DUI`).
5. **Verify**: the chip row now shows exactly the seeded DUI sub-types:
   *First Offense*, *Repeat Offense*, *DUI with Injury*, *DUI with
   Property Damage*. No case-type labels (DUI, Personal Injury, etc.)
   appear in the chip row.
6. Repeat steps 1–5 for **Personal Injury** → expect *Car Accident*,
   *Slip and Fall*, *Medical Malpractice*, *Dog Bite*.
7. Repeat for **Drug Crime** → expect *Possession*, *Distribution*,
   *Trafficking*.

## Story 2 — Default sub-types ship out of the box

1. Reset the dev DB: `pnpm db:reset && pnpm db:seed`.
2. Sign into the dashboard and open `/dashboard/sop`.
3. Click the **Case Types** tab.
4. **Verify**: each of the six default case types (DUI, Criminal
   Defense, Personal Injury, Family Law, Drug Crime, Estate Planning)
   shows a non-zero sub-type count in its header row.
5. Expand each case type. **Verify** at least three sub-types per case
   type with sensible labels for that practice area.

## Story 2 — Existing-account remediation

1. Manually empty the sub-types for one default case type via SQL:
   ```sql
   DELETE FROM sub_types WHERE case_type_id = (
     SELECT id FROM case_types WHERE account_id = '<dev-account>' AND slug = 'dui'
   );
   ```
2. Reload the dashboard's Case Types tab. **Verify** the DUI row shows
   `0 sub-types` and the warning indicator (Story 4 below).
3. Run the remediation:
   ```bash
   pnpm --filter @legal-chatbot/api db:ensure-default-sub-types
   ```
4. **Verify** the script's output reports `outcome: 'inserted'` for the
   dev account's DUI case type and `outcome: 'skipped_already_present'`
   for the others.
5. Reload the dashboard. **Verify** DUI now shows its default 4
   sub-types again.
6. Run the script a second time. **Verify** all rows now report
   `outcome: 'skipped_already_present'` (idempotency).

## Story 3 — Lawyer edits sub-types from the dashboard

1. Sign into `/dashboard/sop` and open the **Case Types** tab.
2. Expand **Personal Injury**.
3. **Add a sub-type**: type `Workplace Accident` in the label input.
   **Verify** the slug input is read-only and shows `workplace_accident`
   immediately. Click **Add**. The row appears at the end of the list.
4. **Reorder**: use the up/down arrows to move *Workplace Accident*
   above *Dog Bite*. **Verify** the order updates immediately.
5. **Rename**: click into the *Slip and Fall* label, change to
   `Slip & Fall`. **Verify** the slug stays `slip_fall` (lock applies on
   rename).
6. **Click Save**.
7. **Reload the page**. **Verify** all changes persisted (label,
   ordering, new row).
8. **Open the visitor widget** in another browser. Tap **Personal
   Injury**. **Verify** the new chip row reflects the saved order and
   labels (including the renamed *Slip & Fall* and the new *Workplace
   Accident*).

## Story 3 — Validation: duplicate label rejection

1. In the **Personal Injury** sub-types list, type a label that
   collides (case-insensitive) with an existing sub-type — e.g.,
   `dog bite` (existing: *Dog Bite*).
2. Click **Add**.
3. **Verify** the inline error reads
   `Sub-type label "dog bite" already exists under "Personal Injury"`.
4. **Verify** no new row appears in the list. Reload — no row persisted.

## Story 3 — Validation: empty label rejection

1. Type spaces only into the label input.
2. Click **Add**.
3. **Verify** an inline error indicates the label cannot be empty.

## Story 4 — Empty sub-types case type skips Step 2

1. In the dashboard Case Types tab, expand **Estate Planning** and
   delete every sub-type. **Save**.
2. **Verify** the *Estate Planning* row now shows the warning indicator
   (a `⚠` or analogous `data-testid="empty-sub-types-warning"`) with a
   tooltip explaining that visitors who pick this case type will skip
   Step 2.
3. Open the visitor widget in another browser session.
4. Tap the **Estate Planning** chip.
5. **Verify** the assistant's NEXT question is "Where did this happen?"
   (Step 3) — NOT "What kind of Estate Planning matter is this?".
6. **Verify** no chip row is visible at the moment Step 2 would have
   been asked, AND the previous turn's chips do not linger.
7. **Verify** the progress bar shows `2 / 6` (case_type complete +
   sub_type skipped both count toward progress).
8. Re-add at least one sub-type via the dashboard. Save. Open a fresh
   widget session. Tap *Estate Planning*. **Verify** Step 2 is asked
   again with the newly-added sub-type chip.

## Story 1 — Edge case: visitor types free text

1. In a fresh widget session, type `dui` into the input (no chip tap).
2. **Verify** the SOP captures the case_type as `dui` (slug, not label)
   and the next chip row shows DUI sub-types — exactly the same as if
   the visitor had tapped the chip.
3. Repeat with mixed case: `DUI`, `Dui`. **Verify** all forms work.

## Story 1 — Edge case: visitor changes their mind

1. Tap **DUI**. The widget shows DUI sub-types.
2. Type `actually it's a personal injury case`.
3. **Verify** the assistant acknowledges the correction.
4. **Verify** the next chip row shows Personal Injury sub-types (not
   DUI's). The previously selected DUI sub-type, if any, is cleared.

## Run the test suite

After each manual verification, run the gating tests:

```bash
# Unit + integration:
pnpm test

# Type checks across all packages:
pnpm -w turbo run typecheck

# Walk specs:
pnpm e2e:walk
```

Expected: all unit/integration tests pass; the new walk specs
`widget-sop-subtype-chips.walk.spec.ts` pass; the extended
`sop-tabs.walk.spec.ts` passes.

## Roll back instructions (if needed)

This feature ships no SQL migrations. To roll back:

1. Revert the branch.
2. Older `chat_sessions.sop_state_json` and `leads.sop_state_snapshot`
   payloads continue to parse cleanly because the new
   `captured_label` field is optional and defaults to `null`.
3. The remediation script (`db:ensure-default-sub-types`) is data-only;
   nothing needs reverting beyond the code change.
