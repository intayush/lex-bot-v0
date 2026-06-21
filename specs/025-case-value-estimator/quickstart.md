# Quickstart — Case Value Estimator

**Feature**: 025-case-value-estimator

End-to-end validation against a local dev environment.

## Prerequisites

- `pnpm dev` running (API on :3000, widget on :5173)
- Dev DB seeded: `pnpm db:seed`
- Browser logged into `http://localhost:3000/dashboard`

---

## Step 1 — Verify seed data

1. Open **Branches** tab in SOP settings.
2. Navigate to **Personal Injury → Car Accident**.
3. Click **Edit branch**.

**Expected**: A "Case Value Estimator" section is visible. The toggle is ON. Three bands are configured:
- HOT (76–100): $75,000 – $250,000
- WARM (51–75): $15,000 – $75,000
- COLD (26–50): $3,000 – $15,000

Repeat for Slip & Fall, Medical Malpractice, and Dog Bite to confirm all four Personal Injury branches are pre-configured.

---

## Step 2 — Configure a new value band manually

1. Navigate to **Branches → DUI → First Offense**.
2. Click **Edit branch**.
3. Find the "Case Value Estimator" section. Toggle it **ON**.
4. Add a band: Score 76–100, Value $10,000 – $50,000.
5. Click **Save draft** then **Publish**.

**Expected**: Configuration saves without error. The branch is now published with the case value band.

---

## Step 3 — Capture a HOT lead and see the badge

1. Open the widget at `http://localhost:5173`.
2. Complete a Personal Injury → Car Accident intake. Answer all branch questions with high-scoring responses to land in HOT (score ≥ 76). Submit the contact form.
3. Open `http://localhost:3000/dashboard/leads`.

**Expected**: The captured lead shows a green **"$75K – $250K"** badge in the Estimated Value column.

---

## Step 4 — Verify SPAM leads show no badge

1. Capture a lead where the responses force a low score (SPAM, score ≤ 25).
2. Open the Leads dashboard.

**Expected**: The SPAM lead shows no value badge, even though Car Accident has a configured estimator.

---

## Step 5 — Toggle off at case type level

1. Open **Branches → Personal Injury → Car Accident**.
2. Toggle the case value estimator **OFF**.
3. Save (no new version needed — this is a branch-level toggle).
4. Open the Leads dashboard.

**Expected**: All Car Accident leads now show no value badge, regardless of their score. Other case types are unaffected.

---

## Step 6 — CSV upload with case value config

1. Download the branch CSV template for **Personal Injury → Slip & Fall**.
2. Verify the template contains a `[CASE_VALUE]` section at the bottom with `case_value_enabled,YES` and the three pre-seeded bands.
3. Modify one band's value range.
4. Upload the modified CSV.

**Expected**: The branch editor preview shows the updated value bands. Save and publish to make it live.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| Value badge not appearing | `is_case_value_enabled` is false on the branch — check toggle in editor |
| Badge shows for SPAM lead | Classification check missing in badge resolution logic |
| Seed data missing | Migration not applied — run `pnpm db:migrate` before `pnpm db:seed` |
| CSV upload loses case value config | `[CASE_VALUE]` section parser not wired into import handler |
