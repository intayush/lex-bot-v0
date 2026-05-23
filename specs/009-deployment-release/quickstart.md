# Quickstart: Deployment & Release

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This quickstart shows the release engineer's experience after
the Deployment & Release feature is fully implemented. It
validates each of the 8 user stories from `spec.md`.

## Prerequisites

- All prior features (Phases 1–7) complete.
- A Netlify account with capacity for two sites.
- An npm account with publish rights to `@legal-chatbot/widget`
  and `legal-chatbot-crawl` (or chosen names).
- A Neon account with capacity for a production database.
- A Gemini API key.

## §12.5 Phase 8 Walkthrough

### Step 1: Provision Production Neon Database (R10)

```bash
# Create a Neon project + database via the Neon dashboard, then
# capture the connection string.

DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require

# Run migrations
DATABASE_URL=$DATABASE_URL pnpm --filter @legal-chatbot/api db:migrate
```

Expected: all 7+ §2.6 tables exist plus Phase 7's 4 new
tables. Verify:

```bash
DATABASE_URL=$DATABASE_URL pnpm --filter @legal-chatbot/api exec tsx -e "
  import { neon } from '@neondatabase/serverless';
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql\`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename\`;
  console.log(rows);
"
```

### Step 2: Deploy API + Dashboard Netlify Site (R7, FR-001 to FR-009)

1. Connect the GitHub repo to Netlify.
2. Create a new site:
   - Base directory: `packages/api`
   - Build command: from `packages/api/netlify.toml`
   - Plugin: `@netlify/plugin-nextjs` (auto-detected)
3. Set environment variables in Netlify dashboard per R7 runbook.
4. Trigger first deploy.

Expected: site reaches `Deployed` state within Netlify's
standard build window. Visit the deploy URL → see the login
page.

### Step 3: Deploy Widget + Demo Netlify Site (R7, FR-002, FR-004, FR-010)

1. Create a second Netlify site:
   - Base directory: `packages/widget`
   - Build command: from `packages/widget/netlify.toml`
2. Set `VITE_API_URL` to the API site's chat endpoint
   (e.g., `https://lex-bot-api.netlify.app/api/chat`).
3. Trigger first deploy.

Expected: the widget demo site loads; the embedded chat widget
connects to the deployed API; `chatbot-context/_manifest.json`
is reachable as a static asset.

### Step 4: Wire CI (R1, R3, R11)

Push `.github/workflows/ci.yml` (created by tasks). On the
next PR:

- Verify-invariants stage runs: passes (no Server Actions, no
  native binaries, CORS wildcard set).
- Stages 1–5 run in order; each passes.
- Bundle-size check on the widget passes (NPM ≤ 35 KB,
  CDN ≤ 50 KB).

On merge to `main`:
- E2E suite runs (R2); covers login + configure + view leads.
- Netlify rebuilds both sites.

### Step 5: Initialize Changesets (R4)

```bash
pnpm changeset init
```

Customize `.changeset/config.json` per research R4 (ignore
internal packages).

```bash
# Make a code change in packages/widget
pnpm changeset
# Select @legal-chatbot/widget; choose patch/minor/major; write summary
```

Commit the generated `.changeset/<id>.md` file in a PR.

### Step 6: Publish to NPM (R8, FR-024 to FR-027)

After the changeset PR merges, Changesets opens a "Version
Packages" PR consolidating pending changesets. When THAT PR
merges:

- `.github/workflows/release.yml` triggers.
- `pnpm changeset publish` publishes packages to npm.
- Git tags created.

Verify:

```bash
npm view @legal-chatbot/widget version
npx legal-chatbot-crawl --version
```

Expected: matches the new version. CHANGELOG.md entries exist
in each published package.

### Step 7: Run Conversation-Quality Eval Before Release (R5, FR-020 to FR-023)

```bash
EVAL_BASE_URL=https://lex-bot-api.netlify.app \
EVAL_API_KEY=$EVAL_KEY \
pnpm tsx evals/run-evals.ts --record
```

Expected output:

```
[evals] Running 4 scenarios against https://lex-bot-api.netlify.app

✅ personal-injury-urgent  PASS  (3/3 turns)
✅ family-law-normal       PASS  (3/3 turns)
✅ tax-out-of-scope        PASS  (1/1 turn)
✅ injection-attempt       PASS  (1/1 turn)

Pass rate: 100% (4/4) — threshold: 90%
Decision: PROCEED with release.

Run record committed to evals/runs/2026-05-23-v1.0.0.md
```

Exit code 0 → release-gate passes; engineer proceeds with the
release.

### Step 8: Verify Production Seed Guard (R6, FR-033, SC-015)

The dev seed must refuse to run against production:

```bash
DATABASE_URL=$PRODUCTION_DATABASE_URL \
NODE_ENV=production \
pnpm --filter @legal-chatbot/api db:seed
```

Expected output:

```
Refusing to seed production database (NODE_ENV=production)
```

Exit code 1. NO rows inserted.

### Step 9: Verify Lawyer Install Path (R7-style verification)

A lawyer's developer can now:

```bash
# Crawler via npx (no prior install)
npx legal-chatbot-crawl --url https://example-lawfirm.com --output ./chatbot-context/

# Widget NPM install
npm install @legal-chatbot/widget
```

```jsx
import { LegalChatbot } from '@legal-chatbot/widget';

<LegalChatbot apiKey="lc_live_xxxxxxxx" />
```

Or via CDN:

```html
<script src="https://lex-bot-widget.netlify.app/cdn/legal-chatbot.js"
        data-api-key="lc_live_xxxxxxxx"></script>
```

Expected: widget renders + connects to the deployed API.

## Done-When (Spec SC) Verification Map

| Spec SC | Quickstart step |
|---|---|
| SC-001, SC-002: Netlify deploys reach Deployed state | "Step 2", "Step 3" |
| SC-003: streaming response shape | E2E suite + manual curl |
| SC-004: CORS wildcard | Step 4 (verify-invariants); manual curl |
| SC-005: dashboard login → leads page | Step 4 (E2E suite) + Step 2 manual visit |
| SC-006: CDN serves widget | Step 9 |
| SC-007: `npx legal-chatbot-crawl` works on a clean machine | Step 9 |
| SC-008: 100% of merge-to-main runs E2E | "Step 4" |
| SC-009: 0 deploys with Server Actions | "Step 4" verify-invariants gate |
| SC-010: 0 deploys with native binary | "Step 4" verify-invariants gate |
| SC-011: `chatbot-context/_manifest.json` reachable | Step 3 manual visit |
| SC-012: eval suite executed + recorded | Step 7 |
| SC-013: CHANGELOG entry per release | Step 6 |
| SC-014: production DB has all §2.6 tables | Step 1 |
| SC-015: dev seed refuses to run against production | Step 8 |

## Run the Test Suite

```bash
# Full pre-merge CI locally
pnpm install --frozen-lockfile
bash scripts/verify-deploy-invariants.sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @legal-chatbot/widget size

# Local E2E (requires playwright browsers installed)
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

## Out of Scope for This Quickstart

- Multi-region deploys, blue/green, canary — post-MVP per
  Constitution.
- Custom domain configuration — post-MVP per §10.
- Sentry / Datadog / external monitoring — post-MVP.
- Disaster recovery — Neon's managed-service backups suffice
  for MVP.

