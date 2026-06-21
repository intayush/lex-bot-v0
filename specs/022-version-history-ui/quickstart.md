# Quickstart — Version History UI

**Feature**: 022-version-history-ui

End-to-end validation of the version history, restore, and label features against a local dev environment.

## Prerequisites

- `pnpm dev` running (API on :3000, widget on :5173)
- Dev DB seeded: `pnpm db:seed` (gives account `dev@legalchatbot.com / password123`)
- Browser logged in to `http://localhost:3000/dashboard` as `dev@legalchatbot.com`

## Step 1 — Seed multiple config versions

Open the dashboard Configuration page and save 3 drafts without publishing:

1. Change the chatbot name to "Alex v2", click **Save draft**
2. Change it to "Alex v3", click **Save draft**
3. Click **Publish**

**Expected**: The version badge reads `v3 Published`. The version history panel lists v3 (Published), v2 (Draft), v1 (Draft) from the seed.

## Step 2 — Restore a config version

1. In the version history panel, click **Restore** on v1 (the original seed version).

**Expected**:
- A new draft `v4` is created with v1's content (chatbot name "Alex")
- The editor reloads showing "Alex" in the name field
- The version badge reads `v4 Draft`
- The history panel lists v4 at the top

## Step 3 — Publish the restored draft

1. Click **Publish** on v4.

**Expected**: Badge reads `v4 Published`. The live widget greeting uses the v1 config (chatbot name "Alex").

## Step 4 — Label a version

1. In the version history panel, click on the label cell for v2.
2. Type "Summer Campaign" and press Enter.

**Expected**: The label "Summer Campaign" appears in the v2 row immediately. No page reload.

## Step 5 — SOP restore (US2)

1. Navigate to the SOP page.
2. Edit the qualified lead threshold to `5`, click **Save draft** (creates v2).
3. In the SOP version history panel, click **Restore** on v1.

**Expected**:
- A new SOP draft `v3` is created with v1's steps and threshold
- The SOP editor loads the restored steps
- The version history panel lists v3 at the top

## Step 6 — Verify SC-006 (history immutability)

After Step 5, open the SOP version history panel and confirm:
- v1 still exists with its original threshold
- v1's step count is unchanged
- No rows were modified or deleted during the restore

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Version history panel is empty | Migration not run | Run `pnpm db:migrate` |
| Restore creates no new version | Route handler bug | Check `POST /api/dashboard/config` action:'restore' handler |
| Label edit doesn't persist | PATCH endpoint not wired | Check `PATCH /api/dashboard/config/label` route |
| SOP restore loses case types | Bug — case types are account-scoped | Case types should be unchanged; check FK structure |
