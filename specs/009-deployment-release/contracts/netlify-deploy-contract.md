# Contract: Netlify Deployment

**Owner**: Deployment & Release (`009-deployment-release`)
**Source of Truth**: §1.8, §1.9, §9.7.

## Two Sites

Per §9.7 the system deploys as TWO Netlify sites from the same
monorepo:

| Site | Base directory | Plugin / Build | Publish dir |
|---|---|---|---|
| API + Dashboard | `packages/api` | `@netlify/plugin-nextjs` | `.next` (auto via plugin) |
| Widget + Demo + Context | `packages/widget` | Vite static build | `packages/widget/dist` |

## API + Dashboard Site

### Existing config (`packages/api/netlify.toml`)

```toml
[build]
  command = "cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @legal-chatbot/shared build && cd packages/api && pnpm build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"

[build.environment]
  NODE_VERSION = "20"
  NETLIFY_NEXT_CSRF_PROTECTION = "false"
```

### Required environment variables (set via Netlify dashboard)

Per R7's runbook:

| Variable | Source |
|---|---|
| `DATABASE_URL` | Neon production connection string |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key |
| `SESSION_SECRET` | iron-session encryption key (≥ 32 chars) |
| `GEMINI_PRICE_PROMPT_PER_1K` | Gemini per-token pricing (Phase 7) |
| `GEMINI_PRICE_COMPLETION_PER_1K` | Gemini per-token pricing (Phase 7) |
| `NODE_ENV` | `production` |
| `FAQ_CACHE_ENABLED` (optional) | `true`/`false` |
| `INJECTION_CLASSIFIER_ENABLED` (optional) | `true`/`false` |
| `SENDGRID_API_KEY` or `RESEND_API_KEY` (optional) | Email provider |

### Functions configuration

The Next.js App Router routes are deployed as Netlify Functions
automatically by `@netlify/plugin-nextjs`. No separate
`netlify/functions/` directory.

### CORS

API responds with `Access-Control-Allow-Origin: *` for the
chat endpoint per §9.7 + Phase 3 contract. The Netlify
configuration does NOT override CORS — it is set in the Route
Handler (`packages/api/src/app/api/chat/cors.ts`).

## Widget + Demo Site

### Existing config (`packages/widget/netlify.toml`)

```toml
[build]
  command = "pnpm install --frozen-lockfile && pnpm --filter @legal-chatbot/shared build && pnpm --filter @legal-chatbot/widget build && cp -r chatbot-context packages/widget/dist/chatbot-context"
  publish = "packages/widget/dist"

[build.environment]
  NODE_VERSION = "20"

[[headers]]
  for = "/chatbot-context/*"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    Cache-Control = "public, max-age=300"
```

### Required environment variables

| Variable | Source |
|---|---|
| `VITE_API_URL` | URL to the API site's chat endpoint (e.g., `https://lex-bot-api.netlify.app/api/chat`) |

### Static asset structure

After build, `packages/widget/dist/` contains:

- `index.html` — demo site.
- `assets/` — Vite-built JS/CSS for the demo.
- `chatbot-context/` — Shrager seed content (copied at build).
- (Phase 4 addition) `cdn/legal-chatbot.js` — CDN bundle for
  the widget script tag.

## Branch Deploys

Netlify's default branch-deploy behavior creates a preview URL
for each PR. This is acceptable per Assumption (no production
spec mandate).

## Post-Deploy Verification

After each Netlify deploy, the operator (or a Netlify
deploy-success webhook, post-MVP) verifies:

1. API site responds 200 to `GET /api/health` (TBD endpoint;
   captured as Assumption).
2. Widget site responds 200 to `GET /chatbot-context/_manifest.json`.
3. Bundle sizes match the size-limit budgets (already enforced
   in CI; this is a sanity check post-deploy).

## Constitution Compliance

- Constitution IV: serverless-only; no native binaries; no
  fs writes; CORS wildcard.
- Constitution V: production env vars never logged
  (Foundation logger redaction).
- Constitution VII: deploy topology matches §9.7 verbatim.

