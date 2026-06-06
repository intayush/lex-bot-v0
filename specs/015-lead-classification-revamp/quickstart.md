# Quickstart: Lead Classification Revamp

**Audience**: Developer or operator validating the 015 implementation
end-to-end.

**Prerequisites**:

- Local dev stack running (`pnpm dev` from repo root brings up the
  test app + API + dashboard + context store, per Constitution
  Local-Development requirement).
- `.env.local` configured with a Neon dev branch in `DATABASE_URL`.
- A clean dev DB seed: `pnpm --filter @legal-chatbot/api db:reset && pnpm --filter @legal-chatbot/api db:seed`.
- Default admin user is logged in (or can `loginAsDev` from a fresh
  browser session).

This document walks through every user story in `spec.md` and gives
a manual verification path. Each story has its own section with
step-by-step actions and expected observations.

The numbered stories (US1–US7) match the spec's user-story
priorities.

## Migration verification (run first)

Before touching any user story, verify the migration applied cleanly.

1. `pnpm --filter @legal-chatbot/api db:migrate` — expect zero
   errors.
2. Open Neon SQL console (or use `psql $DATABASE_URL`) and run:
   ```sql
   SELECT classification, COUNT(*) FROM leads GROUP BY classification;
   ```
   Expected: every row's classification is one of `HOT`, `WARM`,
   `COLD`, `SPAM`. Zero rows with `urgent`, `normal`, or
   `unqualified`.
3. Run:
   ```sql
   SELECT column_name, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'leads'
     AND column_name IN ('lead_score', 'score_reasons_json',
                         'request_type', 'geographic_qualification',
                         'geographic_qualification_details_json');
   ```
   Expected: 5 rows, all `is_nullable = YES`.
4. Run:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'sub_types' AND column_name = 'scoring_config_json';
   ```
   Expected: 1 row.
5. Run:
   ```sql
   SELECT scoring_config_json FROM sub_types WHERE slug = 'car_accident';
   ```
   Expected: a non-null JSON document matching the seeded car-accident
   `ScoringConfig` (see `contracts/scoring-config.md` for the shape).
6. Run:
   ```sql
   SELECT COUNT(*) FROM sub_types WHERE scoring_config_json IS NOT NULL;
   ```
   Expected: 1 (only car_accident is configured in MVP).

If any check fails, do not proceed; fix the migration first.

## Story 1 — Visitor walks the SOP for a car-accident lead

**Goal**: Confirm visitor flow renders the 8 scoring questions plus
2 metadata questions for car_accident, and the resulting lead
carries a deterministic classification, lead_score, and reasons.

### Steps

1. Open the chat widget on the local test app.
2. Type "I had a car accident" or tap **Personal Injury** chip.
3. Tap the **Car Accident** sub-type chip.
4. Free-text answer to "Where did this happen?": "Boston, MA".
5. Free-text answer to "Can you briefly tell us what happened?":
   "Other driver ran a red light".
6. **NEW step (position 5) — Request Type**: chip row should show
   `Myself` and `Friend / Family Member`. Tap `Myself`.
7. **NEW step (position 6) — Geographic Qualification**: chip row
   should show `Yes` and `No`. Tap `Yes` (assumes the firm is
   configured to serve Boston; otherwise the chips ask for city/state).
8. **NEW step 7 — Accident Timing**: chip row shows the 6 timing
   chips (`Today`, `Within Last 7 Days`, `Within Last 30 Days`,
   `Within Last 6 Months`, `More Than 6 Months Ago`, `I Don't Know`).
   Tap `Today` (+20 weight).
9. **NEW step 8 — Injury**: tap `Yes` (+15 weight).
10. **NEW step 9 — Medical Treatment**: tap `Emergency Room Visit`
    (+15 weight).
11. **NEW step 10 — Accident Role**: tap `Driver` (+5 weight per
    xlsx).
12. **NEW step 11 — Insurance Activity**: tap `Requested Recorded
    Statement` (+15 weight).
13. **NEW step 12 — Work Impact**: tap `Missed Work` (+10 weight).
14. **NEW step 13 — Attorney Status**: tap `No` (+20 weight).
15. **Step 14 (was 5) — When**: tap `Today`.
16. **Step 15 (was 6) — Contact**: fill name `Jane Doe`, email
    `jane@example.org`, phone `+1 617 555 0101`. Submit.
17. Wait for the SOP to finalize (assistant should send a
    confirmation message).
18. Check the leads dashboard — the new lead should appear with
    classification `HOT`, score `100` (+20+15+15+5+15+10+20+15 =
    115, capped at 100), and reasons:
    - "Today" (timing)
    - "Yes" (injury)
    - "Emergency Room Visit"
    - "Driver" (accident role) — wait, this is +5, |5| ≥ 5 so it's
      included
    - "Requested Recorded Statement"
    - "Missed Work" (+10, included)
    - "No lawyer" (or similar phrasing per implementation choice)
    - "Phone provided" + "Email provided" (Q8 contact +10 + +5;
      whether these appear as discrete reasons depends on whether
      they meet the |w| ≥ 5 rule individually — phone +10 yes,
      email +5 yes)

19. Re-walk the SOP a second time with the SAME chip selections.
    The new lead must have IDENTICAL classification, score, and
    reasons. (FR-004 / SC-001 deterministic outcome).

### Expected observations

- Chip rows for the 8 scoring + 2 metadata steps render in correct
  order between Step 4 (what happened) and Step 14 (when).
- The contact form is still the LAST step (Step 15).
- The progress indicator shows `<n>/15` (or whatever total the SOP
  reports — confirm against the new step count).
- Score is exactly the same on the second walk.

## Story 2 — Lawyer sees new score, classification, reasons

**Goal**: Confirm the leads dashboard displays the 4-value
classification scheme, the score column, the reasons cell, and the
filter controls.

### Steps

1. Log in as admin, open `/dashboard/leads`.
2. Verify the header includes a **Score** column.
3. Verify the filter bar shows 5 chips: `All`, `HOT`, `WARM`, `COLD`,
   `SPAM` (no `urgent`, no `normal`, no `unqualified`).
4. Tap the `HOT` filter — only HOT leads should be visible; the count
   badge should update.
5. Click into one HOT car-accident lead from Story 1's walks.
6. Verify the row shows the score, classification badge, and a
   reasons cell. Hover (or expand) the reasons cell to see the
   list of phrases.
7. Find a legacy lead (created before migration) — verify its
   classification badge is one of HOT/WARM/SPAM (not COLD; legacy
   has no COLD bucket per FR-031), the Score column shows `—`
   (placeholder), and the reasons cell is empty.

### Expected observations

- Four distinct colours for the four classifications (HOT red /
  WARM orange / COLD blue / SPAM gray, per FR-025).
- Score column placeholder is `—` (or the project's existing
  empty-cell convention).
- No row shows a string value other than the four enum values.

## Story 3 — Admin configures scoring from the dashboard

**Goal**: Confirm an admin can adjust thresholds + hard-override
toggles for car_accident, the change persists, and the next visitor's
lead reflects it.

### Steps

1. Log in as admin, open `/dashboard/sop`, switch to the **Case
   Types** tab.
2. Expand `Personal Injury`. Find the `Car Accident` sub-type row.
3. The sub-type row should show a new **Scoring** sub-section
   (collapsed by default). Expand it.
4. Verify the panel shows:
   - **Self thresholds**: 4 numeric inputs (HOT / WARM / COLD /
     SPAM) preloaded with `[76,100]`, `[51,75]`, `[26,50]`, `[0,25]`.
   - **Family/Friend thresholds**: 3 numeric inputs (HOT / WARM /
     SPAM) preloaded with `[76,100]`, `[26,75]`, `[0,25]`.
   - **Hard-override toggles**: 4 checkboxes, all checked by default.
   - **Scoring questions preview**: read-only list of the 8 scoring
     questions with each chip's label and `score_weight`.
5. Change the Self HOT lower bound from `76` to `80`. Save.
6. Reload the page. Verify the value persists.
7. **Negative test**: change the Self HOT lower bound to `40`
   (which would overlap with COLD `[26,50]`). Try to save. Expect
   a validation error referencing "non-overlapping" or
   "contiguous"; the saved config is unchanged.
8. **Disable test**: uncheck the `fake_info` toggle. Save. Walk a
   visitor through the SOP with name="Test User" and email=valid
   format; the resulting lead should NOT be downgraded to SPAM by
   the fake-info rule (other rules still apply — if both phone
   and email are missing, missing-contact still fires).
9. **Threshold-change test**: revert the toggles. Walk a visitor
   whose original score was 78 (HOT under the default 76 boundary).
   Set the HOT lower bound back to 80, walk the same visitor again
   — the new lead should be classified `WARM` (since 78 < 80).

### Expected observations

- The scoring questions / chip weights are read-only (admin cannot
  edit individual chip weights from the dashboard in MVP per spec
  §Assumptions).
- Setting a threshold so the four buckets don't cover [0,100]
  contiguously yields a validation error per FR-020.
- Toggle changes affect classification on the very next visitor
  walk (no cache lag).

## Story 4 — Hard-override SPAM rules

**Goal**: Confirm each of the four hard-overrides downgrades
otherwise-HOT leads to SPAM.

### Setup

For each test, walk the SOP with HOT-tier answers EXCEPT the field
the rule inspects. Scores below are illustrative; actual values
depend on chip selections.

### Test A — `missing_contact`

1. Walk SOP with HOT answers (Today / Yes / ER Visit / Driver /
   Requested Statement / Missed Work / No lawyer).
2. On the contact form, leave BOTH phone and email blank but
   submit the form (if the contact-form UI allows it; if it
   blocks empty submission, this test confirms the form-level
   guard rather than the override).
3. Verify the resulting lead's classification is `SPAM`,
   `lead_score` reflects the raw rule-based score (not null —
   the score still computed; the override only changes the
   classification), and `reasons` array ends with
   `"missing_contact"` (or the configured phrase).

### Test B — `out_of_scope`

1. As admin, mark some case_type as `is_in_scope = false`.
2. Walk SOP and tap that out-of-scope case type.
3. The SOP should still finalize. The captured lead has
   classification `SPAM` with reason `"out_of_scope"`.

### Test C — `no_injury_no_treatment`

1. Walk SOP with HOT timing (`Today`, +20).
2. On the Injury question, tap `No` (-20 weight).
3. On the Medical Treatment question, tap `No Treatment` (-10).
4. Continue with HOT answers for everything else.
5. Verify classification `SPAM`, reason
   `"no_injury_no_treatment"`. The score (likely
   20 - 20 - 10 + …) is still recorded.

### Test D — `fake_info`

1. Walk SOP with HOT answers.
2. Contact form: name `test`, email `test@test.com`, phone
   valid.
3. Verify classification `SPAM`, reason `"fake_info"`.
4. Inspect server logs (`pnpm dev` console output): the
   structured log entry should include `"hard_override_fired":
   "fake_info"` but MUST NOT contain the strings `"test"`,
   `"test@test.com"`, or any phone digits. (Constitution V /
   FR-010d compliance check.)

### Test E — Multiple rules fire

1. Walk SOP with `injury=No` + `treatment=No Treatment` AND empty
   contact form.
2. Verify classification `SPAM`, reasons array contains both
   `"no_injury_no_treatment"` and `"missing_contact"` (in fixed
   evaluation order per FR-008: `missing_contact` first, then
   `no_injury_no_treatment`).

## Story 5 — Self vs Family/Friend tables

**Goal**: Confirm the Family/Friend threshold table is honoured for
non-self requesters.

### Steps

1. Walk SOP with answers that produce a score around 35 (e.g.,
   timing `Within Last 6 Months` (+5), injury `Yes` (+15),
   treatment `Doctor Visit` (+10), no other strong signals).
   Roughly: 5 + 15 + 10 = 30. Add Phone (+10) + Email (+5) = 45.
2. **Walk A — Self**: on the Request Type question, tap `Myself`.
   Score 45 should land in `COLD` (Self table:
   `cold = [26, 50]`).
3. **Walk B — Friend/Family**: same answers but tap `Friend /
   Family Member`. Score 45 should land in `WARM` (Family/Friend
   table: `warm = [26, 75]`, no COLD bucket).
4. Verify the two leads in the dashboard show different
   classifications despite identical scores.

## Story 6 — Legacy lead migration

**Goal**: Confirm pre-015 leads display correctly with mapped
classifications.

### Steps

1. Verified during "Migration verification" above. No additional
   manual steps needed.
2. Bonus: open one legacy lead's detail view; confirm
   `classification_rationale` and `urgency_factors_json` (from the
   legacy LLM emit) are still present (FR-032 — migration preserves
   these fields).

## Story 7 — Sub-types without scoring config fall through

**Goal**: Confirm non-car-accident sub_types continue to work via the
LLM fallback.

### Steps

1. Walk SOP picking `DUI → First Offense` (or any sub_type with
   `scoring_config_json IS NULL`).
2. Verify the SOP advances directly from Step 4 ("what happened?")
   to Step 5 ("when did this happen?"). NO scoring questions are
   asked.
3. Submit the contact form to finalize.
4. The captured lead has:
   - `classification` ∈ `{HOT, WARM, COLD, SPAM}` (from the LLM's
     `captureLead` tool emission).
   - `lead_score = NULL`.
   - `score_reasons_json = NULL`.
   - `request_type = NULL`.
   - `geographic_qualification = NULL`.
5. The dashboard row shows the LLM-supplied classification with the
   correct colour, and the Score column shows the placeholder.
6. **Server log check**: the structured log line for this
   finalization should have `"scoring_path": "llm_fallback"`,
   `"lead_score": null`, `"reasons": []`.

## Story 4b (subset) — Scoring error fallback

**Goal**: Confirm FR-010b's safe-default activates when the scorer
fails.

### Setup

This is artificially induced — production should never reach this
path. Use a development-only injection.

### Steps

1. As admin, manually corrupt the car_accident scoring config in the
   DB:
   ```sql
   UPDATE sub_types SET scoring_config_json = '{"schema_version":1, "thresholds_self":"BAD"}' WHERE slug = 'car_accident';
   ```
2. Walk a visitor through the car_accident SOP.
3. The SOP should still finalize (FR-010b: never block flow on
   scoring error).
4. The captured lead has:
   - `classification = 'SPAM'` (safe default).
   - `lead_score = NULL`.
   - `score_reasons_json = '["scoring_error"]'`.
5. The dashboard row should display the lead with a "scoring failed"
   indicator (per FR-029a) — for example, a small ⚠ icon next to the
   SPAM classification badge.
6. **Server log check**: the structured log line should be at
   ERROR level (`console.error`), with
   `"scoring_path": "scoring_error"` and a `"_error"` field naming the
   parse failure (but NEVER the captured PII).
7. Restore the correct scoring config:
   ```bash
   pnpm --filter @legal-chatbot/api db:ensure-car-accident-scoring
   ```
   Verify the next walk produces a clean rule-based-scored lead.

## Cleanup

After all manual checks:

1. `pnpm --filter @legal-chatbot/api db:reset && pnpm --filter @legal-chatbot/api db:seed` — restores the dev DB to a clean known state.
2. Re-run `pnpm test` — all unit + integration tests pass.
3. Re-run `pnpm test:e2e` — the new walk spec
   (`widget-lead-classification.walk.spec.ts`) passes.

## Sign-off checklist

- [ ] Migration applied; legacy classification values are zero.
- [ ] Story 1: deterministic HOT lead for car_accident.
- [ ] Story 2: dashboard shows 4-value classifications + score column.
- [ ] Story 3: admin edits persist and affect the next walk.
- [ ] Story 4: each of the 4 hard-overrides downgrades a HOT lead.
- [ ] Story 5: Self vs Family/Friend tables produce different
      classifications for the same score.
- [ ] Story 6: legacy leads display correctly with mapped
      classifications.
- [ ] Story 7: non-car-accident sub_types use the LLM fallback.
- [ ] Story 4b: scoring-error fallback activates and is observable.
- [ ] No PII in any new log line.
- [ ] `pnpm test` and `pnpm test:e2e` both green.
