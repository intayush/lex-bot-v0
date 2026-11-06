# VPC Agent Plan — herdr-orchestrated, autonomous development for legal-chatbot

Status: proposal v2 (incorporates your decisions, see §16). You are the **orchestrator only**. Every role is a `pi` agent run under herdr on a VPC. Production is protected by **automated safeguards**, not a human merge/publish click. Exactly two things stop for you: **destructive DB migrations** and **secret rotation** (plus the guardrail-self-protection exception in §16, which you can veto).

Related: `vpc-setup/` (bootstrap-vpc.sh, setup-herdr-layout.sh, deploy-*.sh, DEPLOY-AGENT-RUNBOOK.md) — reused after the fixes in §14.

---

## 0. URGENT before anything else

1. **Leaked GitHub PAT in `git remote -v`** (`origin` → `https://intayush:ghp_…@github.com/intayush/lex-bot-v0.git`). Revoke it, then `git remote set-url origin git@github.com:intayush/lex-bot-v0.git`. `origin2` is a broken bare `https://github.com`; remove it. Never copy `.git/config` to the VPC.
2. **Check whether the "dev" Neon DB is actually production.** `packages/api/playwright.config.ts` says e2e tests run against "the real Neon dev DB" using `packages/api/.env.local`, and the root `.env` and `.env.local` both point at Neon endpoint `ep-solitary-waterfall-aqb5cwtt-pooler…/neondb`. You say no staging/dev DB exists. Compare that endpoint with `DATABASE_URL` in Netlify's `lex-bot-v0` env: if equal, **every local e2e run and every `db:migrate` has been hitting production**. Agents must never receive that URL (see §6a).
3. `.env` holds a live-looking `GEMINI_API_KEY`; never rsync it to the VPC. Rotating it is a hard stop for you (§11).
4. `.gitignore` ignores `.env.example`; un-ignore it and commit names only.

## 1. What the project is (inspected)

| Item | Finding |
|---|---|
| Stack | pnpm 9.15 + Turborepo monorepo, Node ≥20, TypeScript 5.8, vitest 4, Playwright |
| Packages | `api` (Next 15, Drizzle, Playwright e2e), `dashboard` (Next 15, no own netlify.toml — served by the api site), `widget` (Vite/React 19), `shared` (zod → `dist`, must be built first), `crawler` |
| Root scripts | `build`, `test`, `lint`, `typecheck`, `smoke` (= api Playwright chromium), `regression` (= `pnpm test && pnpm smoke`), `db:migrate`, `db:seed` |
| **Netlify sites (confirmed by you)** | **`lex-bot-v0`** = API + dashboard (`packages/api/netlify.toml`, Next plugin) → https://lex-bot-v0.netlify.app. **`lex-bot-chatbot`** = dummy website with the widget attached (`packages/widget/netlify.toml`, static `packages/widget/dist`) → https://lex-bot-chatbot.netlify.app (widget README already uses `lex-bot-chatbot.netlify.app/cdn/legal-chatbot.js`). |
| Site-name mismatch fixed | `legal-chatbot-demo` appeared in `vpc-setup/deploy-{status,compare,push}.sh`, `vpc-setup/DEPLOY-AGENT-RUNBOOK.md` and the root `README.md` (live-demo link) and was wrong; all now say `lex-bot-chatbot`. The repo itself is `intayush/lex-bot-v0`, same string as the API *site* — don't confuse repo and site. |
| CI | **No `.github/`** → no Actions, no PR checks. Only gate today is the Netlify build. Phase 1 fixes this. |
| Database | **Neon serverless Postgres**, Drizzle ORM, driver `@neondatabase/serverless` (`neon-http`: HTTP, not a plain TCP Postgres client). 13 migrations in `packages/api/drizzle/` (0000–0012), plus an idempotent data migration (`runMultiBranchSopDataMigration`) run by `src/db/migrate.ts`. |
| Migrations today | Run **manually** via `pnpm db:migrate`; **not** part of the Netlify build. |
| Unit tests | Use a hand-maintained in-memory **SQLite mirror** of the schema (`src/db/test-schema.ts`) and a dummy `DATABASE_URL`; no real DB needed. Drift risk between `schema.ts` and `test-schema.ts` (Phase 1: add a parity test). |
| e2e | `playwright.config.ts` boots `pnpm dev` and runs sequentially against whatever DB `.env.local` names (see §0.2). |
| Runtime env names | `DATABASE_URL`, `SESSION_SECRET`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `CONTEXT_STORE_URL`, `DASHBOARD_URL`, `ADMIN_SEED_EMAIL/PASSWORD`, `RATE_LIMIT_DISABLED` |

Design consequence: on a PR Netlify builds **deploy previews** for both sites; on merge to `main` it builds **production and (auto-publish ON, decision 4) publishes immediately**. So the only things between an agent and production are: CI + review + test checks (§7), migration safety (§6a), and the post-deploy smoke/auto-rollback watchdog (§5).

---

## 2. VPC topology and sizing

```
 your laptop (herdr client, Tailscale)          GitHub (repo, PRs, Actions, Apps)       Netlify (2 sites, auto-publish ON)
        │ herdr --machine vpc (SSH over tailnet)     ▲ push/PR/checks                      ▲ build on push
        ▼                                            │                                     │
 ┌────────────── VPC: private subnet, NO public inbound ───────────────────────────────────────┐
 │ VM agents-1 (Ubuntu 24.04)   herdr server, session "lexbot"                                 │
 │  users: agent-coder, agent-review, agent-test, agent-deploy, agent-lead (separate uids)     │
 │  root-owned wrappers in /usr/local/sbin: nf, neon-branch, (sudoers allow-list per role)     │
 │  systemd: herdr.service, nf-watchdog.timer (backup rollback watchdog, §5)                   │
 │  ws: orchestra | coder-N (worktree) | review-N | test-N | deploy                            │
 │ Egress allow-list: github.com, api.netlify.com, *.netlify.app, registry.npmjs.org,          │
 │   *.neon.tech, LLM provider API(s), playwright CDN                                          │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
 GitHub Actions (independent of the VM): ci, migration-gate, post-deploy watchdog, synthetic prod smoke
```

| Phase | Shape | Notes |
|---|---|---|
| Pilot (≤4 concurrent agents) | 8 vCPU / 16 GB / 160 GB NVMe (Hetzner CCX23, AWS m7i.2xlarge, GCP e2-standard-8) | Next build ≈ 2–3 GB RAM, Chromium ≈ 1 GB each |
| Scale (≤8) | 16 vCPU / 32 GB / 320 GB, or second VM via `herdr machine add` | |
| Always | 4 GB swap, shared pnpm store, turbo cache, nightly `git worktree prune` + `pnpm store prune`, auto-stop when idle >2 h | ≈ $60–200/mo |

Prefer x86 for parity with Netlify's build image (ARM works too). `docs/containerization.md` in pi's docs describes running pi in containers; optional hardening: one rootless container per role instead of Linux users.

## 3. Networking and access

- **Tailscale** on VM + laptop (`tailscale up --ssh --advertise-tags=tag:agents`); security group has **no inbound at all**. ACL: only you → `tag:agents:22`; the VM cannot reach your laptop. MagicDNS name `agents-1`.
- Fallback without Tailscale: SG allows 22 from your IP only, key-only auth, `PermitRootLogin no`, fail2ban.
- Hardening: unattended-upgrades, `ufw default deny incoming`, agents run **without sudo** except allow-listed wrappers (§9), `loginctl enable-linger` so herdr survives logout.
- Git: SSH remote only; per-role GitHub App tokens (§9).

## 4. Installing herdr, connecting it, starting `pi` agents

On the VM (per `vpc-setup/bootstrap-vpc.sh`: Node 20, pnpm 9, git, build-essential):

```bash
curl -fsSL https://herdr.dev/install.sh | bash && herdr --version
npm i -g @earendil-works/pi-coding-agent   # confirm the package name for the installed pi on your laptop: `pi --version`
loginctl enable-linger agent
# systemd --user unit "herdr.service" keeps the server up (confirm exact server start flags with `herdr --help`/herdr.dev/llms.txt;
# fallback: start `herdr --session lexbot` once inside tmux — herdr persists the session itself)
```
Laptop:
```bash
herdr machine add agent@agents-1 --label vpc --remote-session lexbot
herdr machine list; herdr machine status; herdr machine reconnect vpc      # re-auth if lapsed
herdr --machine vpc workspace list                                           # all control is JSON over this
herdr --remote agent@agents-1 --session lexbot                               # full TUI when you want to watch
```
`herdr machine disable vpc` is your soft kill switch from the laptop side.

### Starting a `pi` agent (all roles; `--kind pi` is the only kind used)
`agent start` needs an existing pane at a shell prompt, so: create worktree/workspace → find its pane → start.

```bash
H="herdr --machine vpc"
$H worktree create --cwd ~/legal-chatbot --branch agent/T-042-widget-fix --base origin/main --path ~/wt/T-042 --label T-042 --no-focus
PANE=$($H pane list --workspace <ws_id> | jq -r '.[0].pane_id')                  # shape: confirm from the JSON you get back
$H pane send-text $PANE 'start-role coder T-042'                                  # role launcher: loads ~/.secrets/coder.env, cds to worktree (see below)
$H agent start coder-t042 --kind pi --pane $PANE -- \
   --model <provider/id> --thinking medium \
   --session-dir ~/agent-state/T-042/pi/coder \
   --name coder-T-042 \
   -ne -e ~/agent-guard/pi-guard.ts \
   --no-mcp -ns \
   --append-system-prompt ~/legal-chatbot/docs/agents/coder.md
$H agent prompt coder-t042 "Read ~/agent-state/tasks/T-042.md and begin." --wait --until idle --until blocked --timeout 1800000
$H agent wait coder-t042 --until done
```
Notes on the flags (from `pi --help`): `-ne` drops auto-discovered extensions (personal packages such as pi-subagents/advisor are **not** loaded on the VPC, so agents can't spawn unbounded children or consult extra models); explicit `-e` still loads our guard. `--tools/--exclude-tools` shape the tool set per role (§8). `--session-dir` puts each agent's JSONL transcript where the token accountant reads it. Agent names must match `[a-z][a-z0-9_-]{0,31}`.

## 5. Netlify build/deploy status, logs, and automatic rollback

### 5.1 Facts used
Every push builds. Deploy fields: `id`, `state` (`new|building|uploading|uploaded|preparing|prepared|processing|ready|error`), `error_message`, `commit_ref`, `branch`, `context` (`production|deploy-preview|branch-deploy`), `published_at`, `deploy_ssl_url`, `build_id`. Netlify also posts GitHub commit statuses `netlify/<site>/deploy-preview`. With auto-publish ON, a `ready` production deploy is **live immediately**; a failed build is never published. (Endpoint names are from Netlify's OpenAPI; run each once in Phase 2 to confirm — especially the thinly documented build-log endpoint.)

### 5.2 Options evaluated
| Option | Status | Build log | Fit |
|---|---|---|---|
| A. Netlify API/CLI + PAT, poll `listSiteDeploys` by `commit_ref` | ✅ exact | ✅ | **Primary for status/logs/rollback** |
| B. GitHub commit status / check-runs API | ✅ per SHA | link only | **Fallback 1** (no Netlify token needed) |
| C. GitHub Actions | ✅ CI + the **watchdog** | ✅ `gh run view --log-failed` | **Required**; hosts the deterministic post-deploy check |
| D. Deploy-notification webhooks → receiver (JWS-verified) | ✅ push | ✅ error_message | Optional Phase 4 latency upgrade |
| E. Build hooks | ❌ | ❌ | retrigger only (`curl -X POST $BUILD_HOOK`) |
| F. Log drains / `netlify logs:function` | runtime only | ❌ | post-deploy investigation |

### 5.3 Token handling (important: Netlify PATs are not scoped)
A Netlify PAT carries its user's full team access; "read-only" isn't a PAT property. Therefore:
- **No agent holds a Netlify token.** Agents call root-owned wrapper `nf` via `sudo -n` (allow-listed in `/etc/sudoers.d/agents`). The token lives in `/etc/lexbot/netlify.token` (0600 root).
- `nf` subcommands (allow-list, hard-coded site IDs for `lex-bot-v0` and `lex-bot-chatbot` only): `deploys <site> [n]`, `deploy <id>`, `log <id>`, `wait <site> <sha>`, `rollback <site>` (**deployer role only**, and only to a previously `ready` production deploy of that site), `autopublish <site> on|off`. It has **no** subcommand for env vars, domains, site settings, or deletion — which is how "secret rotation needs me" is enforced on the Netlify side.
- Use a dedicated Netlify service user (non-owner, no billing). A second copy of the PAT is stored as a GitHub Actions **environment secret** (`production-watchdog`) for §5.5.

### 5.4 Status & logs (deployer agent, via `nf`)
```bash
sudo -n nf deploys lex-bot-v0 5      # = netlify api listSiteDeploys --data '{"site_id":"…","per_page":5}' | jq '.[]|{id,state,branch,context,commit_ref,error_message,published_at}'
sudo -n nf wait lex-bot-v0 <SHA> 1200     # polls every 15 s until ready/error; writes ~/agent-state/deploys/<SHA>.{json,summary.json,build.log}; exit 0 ready / 1 error / 2 timeout
sudo -n nf log <DEPLOY_ID>           # GET https://api.netlify.com/api/v1/deploys/<id>/log (confirm in Phase 2); falls back to getSiteBuild + error_message
```
Reference implementation of `wait` (adapt from `vpc-setup/deploy-status.sh`, replace its grep-JSON with `jq`):
```bash
dep=$(curl -fsS -H "Authorization: Bearer $TOK" "$API/sites/$SITE/deploys?per_page=20" | jq -c --arg s "$SHA" '[.[]|select(.commit_ref==$s)]|first // empty')
state=$(jq -r .state <<<"$dep")      # loop; on error: GET /deploys/$id, /deploys/$id/log, save, print last 80 lines
```
Fallbacks: **B** `gh pr checks <PR> --watch --fail-fast`; `gh api repos/intayush/lex-bot-v0/commits/<SHA>/status --jq '.statuses[]|{context,state,target_url}'`; **C** `gh run view <id> --log-failed`. **A′** if no log endpoint: reproduce the exact Netlify build locally (`pnpm install --frozen-lockfile && pnpm --filter @legal-chatbot/shared build && cd packages/api && pnpm build`; Node 20 pinned).

### 5.5 Post-deploy smoke + automatic rollback (replaces the human publish gate)
Primary: GitHub Actions workflow `.github/workflows/post-deploy.yml`, trigger `push` to `main` (runs independent of the VM and of any LLM):

1. For each site whose build ran: poll until the deploy with `commit_ref == $GITHUB_SHA`, `context=production` is `ready` or `error` (timeout 15 min; "no deploy appeared within 5 min after checks" = build skipped by an `ignore` rule → pass).
2. `state=error` → nothing was published (Netlify never publishes failed builds). Create issue `deploy-failed <sha>` with `error_message` + last 80 log lines and label `agent-task` (a coder picks it up). No rollback needed.
3. `state=ready` → **smoke against the live URL** (`scripts/smoke/live.sh`, run at +0, +3, +10 min to catch warm-up/slow failures):
   - `lex-bot-v0`: `GET /api/health` is 200 and returns `{commit: $SHA}` (Netlify exposes `COMMIT_REF` at build; this proves the *new* code is serving), `GET /login` 200, `GET /api/config` with the smoke API key returns the expected shape, and one `POST /api/chat` round-trip with a dedicated **smoke account** flagged `is_smoke` so it creates no lead email/notification (Phase 1 code task; the existing Playwright e2e suite is **never** run against production — it writes data).
   - `lex-bot-chatbot`: `GET /` 200, `GET /cdn/legal-chatbot.js` 200 non-empty, `GET /chatbot-context/...` 200 with CORS header, headless-Chromium page load asserting the widget mounts and its `/api/config` call to `lex-bot-v0` succeeds.
4. **Any smoke failure** → rollback:
   ```bash
   PREV=$(gh variable get LAST_GOOD_${SITE//-/_})                     # set after every passing smoke
   netlify api restoreSiteDeploy --data "{\"site_id\":\"$SITE_ID\",\"deploy_id\":\"$PREV\"}"   # publishes the previous deploy instantly
   scripts/smoke/live.sh   # re-verify; if this fails too → page you (hard failure, §11)
   gh issue create --title "AUTO-ROLLBACK $SITE $SHA" --label agent-task,incident ...
   ```
   Smoke pass → `gh variable set LAST_GOOD_<SITE> --body <deploy_id>`.
5. After rollback Netlify **stops auto-publishing** for the site (publishing an older deploy locks it). That is desirable: the broken `main` stays out of production. The workflow records `autopublish=locked`; the deployer agent re-enables it (`nf autopublish <site> on`, i.e. `unlockDeploy`/"start auto publishing") only after the fix PR's merge deploy passes smoke on its deploy-permalink URL (`https://<deploy_id>--<site>.netlify.app`). Verify this lock/unlock behaviour in the Phase 3 drill and adjust.

Backup watchdog: `nf-watchdog.timer` on the VM (every 2 min, runs the same logic as bash with the root token) so a GitHub Actions outage doesn't leave production unwatched. Also a **synthetic prod smoke** on Actions cron every 15 min against both live URLs; 2 consecutive failures → same rollback (if the last deploy is < 60 min old) or an incident issue + notification to you.

Why rollback is safe: migrations are expand-only/backward-compatible (§6a), so the previous code version always works with the current schema.

---

## 6. Worktree-per-agent isolation
- One clone `~/legal-chatbot` (never edited). Each task: `herdr worktree create --cwd ~/legal-chatbot --branch agent/<task>-<slug> --base origin/main --path ~/wt/<task> --label <task> --no-focus`. Worktrees share `.git`; pnpm uses the shared store.
- Per worktree: its own `.env.local` (generated by the role launcher with a **Neon branch URL**, §6a), port offset (`3000+n`, dashboard `3001+n`), own `shared/dist` (run `pnpm --filter @legal-chatbot/shared build` first).
- Reviewers and testers use read-only checkouts of the PR head (`git worktree add --detach`), owned by their own uid.
- Cleanup: `herdr worktree remove --workspace <id>` after merge; nightly prune; Neon branches TTL-deleted (below).

## 6a. Database strategy with no staging DB, and how migrations reach production

### Environments (from cheapest to most realistic)
| Tier | What | Who/where | Data |
|---|---|---|---|
| T0 unit | existing in-memory SQLite mirror + dummy URL (`vitest.setup.ts`) | every agent, every commit | synthetic |
| T1 integration/e2e | **per-worktree Neon branch** of a PII-free `baseline` branch in a **separate Neon project `lexbot-ci`** | coder/tester via wrapper `neon-branch create|delete <task>` (token held by wrapper; agents only see the resulting branch connection string in their own `.env.local`) | seeded (`db:seed`, `bootstrap-prod.ts`), no real leads |
| T1′ offline alternative | local Postgres container + `local-neon-http-proxy`, because `neon-http` cannot talk to a plain Postgres | needs a small env-driven `neonConfig.fetchEndpoint` change in `src/db/index.ts` | synthetic |
| T2 migration rehearsal | **ephemeral Neon branch of production**, copy-on-write, created and destroyed by a GitHub Action | Actions only (secret in environment `migration-rehearsal`); agents never see data or the URL, only pass/fail, durations, row counts | real data stays inside Neon/Actions; **confirm you accept this for legal-lead PII** (decision D3) |
| T3 production | applied during the production Netlify build (below) | Netlify build | real |

`baseline` is built once: new empty Neon project → run all migrations → seed → protect. Rebuilt in CI whenever a migration merges. Branch limits: ≤ 8 concurrent T1 branches, TTL 24 h (nightly reaper), auto-suspend compute. SQLite is not an option for e2e (app is Postgres/neon-http specific). Local e2e **must never** read the root `.env` / current `.env.local` (see §0.2): the launcher refuses to start if `DATABASE_URL` host ≠ a `lexbot-ci` endpoint.

### Migration safety rules (enforced by the `migration-gate` required check)
1. **Expand/contract only; every migration must be backward-compatible with the code currently in production.** Allowed automatically: `CREATE TABLE`, `ADD COLUMN` (nullable or with a constant default), `CREATE INDEX` (non-blocking form where supported), adding constraints as `NOT VALID` then validating later, idempotent data backfills bounded by `WHERE`.
2. **Destructive = anything else**: `DROP` (table/column/constraint/index in use), `RENAME`, `ALTER COLUMN TYPE`, `SET NOT NULL` without a proven backfill, `TRUNCATE`, un-bounded `DELETE/UPDATE`, and any production **restore/PITR**. Classified by `scripts/migration-lint.mjs` (SQL parse of new files in `packages/api/drizzle/`, plus the data-migration TS). Unknown statement ⇒ treated as destructive.
3. **Destructive ⇒ hard stop for you.** The PR gets label `destructive-migration`, auto-merge is blocked, and `migration-gate` stays red until **you** comment `/approve-destructive <short-sha>` (the Action verifies author == repo owner and sha == current head; a new push invalidates it). A "contract" (drop) migration is also refused unless the column/table is unreferenced in `schema.ts` on `main` and was unreferenced for ≥ 24 h of production time.
4. **Migration PRs are migration-only** (paths allow-list: `packages/api/drizzle/**`, `src/db/schema.ts`, `src/db/test-schema.ts`, db tests). Code that *uses* the new column lands in a later PR.
5. T2 rehearsal on every migration PR: branch prod → apply the PR's migrations → run the **base-branch** (`main`, i.e. *currently deployed*) integration subset against the migrated schema (proves old code still works = backward-compat) → run the PR's tests → delete branch. Record duration to flag long locks.
6. Data migrations must be idempotent (like `runMultiBranchSopDataMigration`) and bounded.
7. Serialize merges that touch `drizzle/**` (GitHub merge queue, concurrency group) — drizzle's `migrate` takes no cross-process lock.

### How a migration reaches production (no race with auto-publish)
Netlify builds the new code and migrates in the **same production build, before publish**; the old code keeps serving during the build, which is safe because of rule 1.
```toml
# packages/api/netlify.toml  (protected path, §16 D9)
[context.production]
  command = "cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @legal-chatbot/shared build && cd packages/api && node scripts/migrate-guard.mjs && pnpm db:migrate && pnpm build"
# deploy-preview / branch-deploy contexts keep the existing command and NEVER migrate
```
`migrate-guard.mjs` (defence in depth): re-runs the lint against pending migrations; refuses if any is destructive and not marked approved (approval is a signed file `drizzle/approved/<tag>.json` that only the gate Action may create from your comment); inserts a row into a `migration_audit` table (`ts`, `sha`, files, status) which doubles as the **restore point** — rollback target for Neon point-in-time restore (`neonctl branches create --parent main@<ts>`, history window depends on the Neon plan; raise it before relying on it). Build fails ⇒ nothing publishes ⇒ production unchanged. `src/db/migrate.ts` uses `neon-http`; verify migrations apply atomically there and switch the migrator to the `neon-serverless` Pool (WebSocket, real transactions) if they don't.

Rollback matrix: code → `restoreSiteDeploy` (safe by rule 1). Schema → **never rolled back automatically**. Data restore/PITR → destructive ⇒ you.

---

## 7. Branch / PR flow (fully automated merge, no human approval)
1. Coder works on `agent/<task>-<slug>` from `origin/main`; conventional commits (`feat(scope): …` as in history); runs local gates `pnpm typecheck && pnpm lint && pnpm test`; pushes; opens PR with the handoff body.
2. **Required status checks on `main`** (GitHub ruleset; no direct push, no force-push, linear history, branch must be up to date, **0 human approvals required**, no bypass actors except you):
   | Check | Produced by |
   |---|---|
   | `ci/verify` (install, shared build, typecheck, lint, vitest, gitleaks, build of api + widget) | Actions |
   | `migration-gate` (lint + rules of §6a + T2 rehearsal when `drizzle/**` changed) | Actions |
   | `agent/review` = success only on `approve` for the **current head SHA** | **GitHub App `lexbot-reviewer`** (ruleset pins the check's source app) |
   | `agent/test` = success after `pnpm regression`-equivalent on a T1 Neon branch + added/updated tests | **GitHub App `lexbot-tester`** |
   | `netlify/lex-bot-v0/deploy-preview`, `netlify/lex-bot-chatbot/deploy-preview` | Netlify |
3. Because each check is bound to a different App identity with its own key, the coder cannot self-approve, and a new push invalidates review/test.
4. **Merge** is done by `lexbot-merger` (`gh pr merge --auto --squash`, enabled by the deployer/lead after the handoff chain completes); GitHub merges when all required checks pass. No other identity can merge.
5. Auto-merge is blocked (label `needs-human`) if: diff > 800 changed lines, the PR touches a protected path (§16 D9), a destructive migration, or the reviewer sets `risk: high`. Reviewer and tester run on a **different model** than the coder (`--model`) to reduce correlated blind spots.
6. After merge → Netlify production build (+ migration step) → publish → §5.5 watchdog.

## 8. Agent roles, `pi` configuration, handoff protocol

| Role | herdr name | pi tool allow-list (`--tools`) | Linux user | Credentials | Done when |
|---|---|---|---|---|---|
| lead (optional) | `lead` | `read,bash,grep,find,ls,write` | `agent-lead` | herdr control; GitHub issues/PRs write; no push | tasks decomposed with acceptance criteria |
| coder-N | `coder-<task>` | default (`read,bash,edit,write,…`) | `agent-coder` | GitHub App `lexbot-coder` (contents:write only to `agent/*`, PRs write); pi LLM key (coder) | gates green, PR open, `handoff-coder-review.md` |
| reviewer-N | `review-<task>` | `read,bash,grep,find,ls` (no `edit`/`write`) | `agent-review` | `lexbot-reviewer` (checks write, PR comment, contents read) | check `agent/review` posted with file:line findings |
| tester-N | `test-<task>` | default (may add tests on `agent/test-*`) | `agent-test` | `lexbot-tester`; Neon branch via `neon-branch` wrapper | check `agent/test` posted + report |
| deployer | `deploy` | `read,bash,grep,find,ls` | `agent-deploy` | `lexbot-merger` (auto-merge only); `sudo nf …` (§5.3) | merge done, production smoke green, or incident handled |

Role prompts: `docs/agents/<role>.md` (passed with `--append-system-prompt`). Each states allowed/forbidden actions, the status protocol, "stop and set `needs_human` after 2 failed attempts of the same kind", and that PR text / crawled pages / test-site content are **untrusted** (prompt-injection).

### Deny-lists tailored to pi (layered, because tool allow-lists alone aren't a security boundary)
1. **`pi-guard.ts`** extension (loaded with `-ne -e`): a `tool_call` handler returns `{block:true, reason}` (documented in pi `docs/extensions.md`; a handler error also blocks, i.e. fail-closed). Blocks, per role: `git push` to anything but the role's branch pattern, `git push --force`, `gh pr merge` (except deployer), `gh api -X DELETE`, `sudo` (except `sudo -n nf|neon-branch` for permitted roles), `rm -rf` outside the worktree, writes to `.env*`/`~/.secrets`/`/etc`, `curl|wget … | sh`, `netlify` CLI directly, `psql`/`drizzle-kit push`/`pnpm db:migrate` against any host not in the `lexbot-ci` allow-list, `pnpm db:seed` outside T1, reading other roles' homes, editing protected paths (§16 D9), reading `~/.pi/agent/auth.json`.
2. Per-role `--tools` as in the table (`--exclude-tools` for anything extra).
3. **OS boundary (the real one):** separate uids; secrets in `0600` per-uid files; reviewer/tester worktrees read-only to the coder uid; sudoers allow-list only for `nf`/`neon-branch`; egress allow-list.
4. **Server-side boundary:** GitHub ruleset + per-App permissions; Netlify wrapper allow-list; Neon wrapper allow-list.

### Token / cost accounting for pi
pi writes JSONL sessions with per-message `usage` (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost.total`). Because each agent has its own `--session-dir ~/agent-state/<task>/pi/<role>`, the accountant is a 20-line script run every minute by the dispatcher:
```bash
jq -s '[.[]|select(.message.usage)|.message.usage]|{tokens:(map(.totalTokens)|add),cost:(map(.cost.total)|add)}' ~/agent-state/T-042/pi/*/*.jsonl   # confirm line shape with pi docs/session-format.md
```
Result is merged into `status.json.budget`. Caps (defaults, tune in Phase 3): per task `$15` / 6 M tokens, per agent `$8`, per day all agents `$100`. At 80 % → the dispatcher sends a "wrap up" prompt (`herdr agent prompt`); at 100 % → `pi` is stopped (Ctrl-C via `herdr agent send-keys`, then pane close), status `needs_human`. Provider-side hard monthly caps per key are the backstop. Thinking level defaults to `medium` for coder, `high` for reviewer; `xhigh` only by explicit brief.

### Status files and handoff packets (`~/agent-state/`)
```
tasks/T-042.md                 brief + acceptance criteria (you or lead)
T-042/status.json              single source of truth (atomic mv writes)
T-042/handoff-<from>-<to>.md   goal, files changed, how verified, risks, migrations?, env vars?, exact SHA
T-042/pi/<role>/*.jsonl        transcripts (token accounting, audit)
deploys/<sha>.*                §5 artefacts
audit.log                      append-only wrapper log (who/role/command)
PAUSE                          global kill file (dispatcher + launchers refuse to start)
```
```json
{"task":"T-042","stage":"review","state":"waiting|working|blocked|done|needs_human","branch":"agent/T-042-x","pr":123,"sha":"abc","owner":"review-t042",
 "rounds":{"review":1},"budget":{"tokens":0,"cost":0,"cap_cost":15},"history":[{"t":"…","stage":"code","by":"coder-t042","result":"ready_for_review"}]}
```
Because GitHub checks are the authoritative gates, status.json is the *coordination* layer; a stage is only "done" when the matching GitHub check exists.

### Handoff mechanics (`scripts/agent/handoff.sh`, run by lead/dispatcher, or by you)
```bash
H="herdr --machine vpc"
$H agent wait coder-t042 --until done --timeout 7200000
# reviewer: new workspace, read-only checkout of PR head, pi started as above with docs/agents/reviewer.md
$H agent prompt review-t042 "Review PR #123 at SHA abc123. Inputs: ~/agent-state/T-042/handoff-coder-review.md. Post check agent/review." --wait --until idle --until blocked
# `blocked` (permission dialog) is never auto-approved: it surfaces to you, see §10
```
Loop: `code → review (≤3 rounds, changes→coder) → test → CI/gate green → auto-merge → production build → watchdog → done`. Failures re-enter the loop as new tasks (`agent-task` issues).

## 9. Secrets (least privilege, separate per role)
| Secret | Holder | Notes |
|---|---|---|
| GitHub: `lexbot-coder`, `-reviewer`, `-tester`, `-merger` Apps | one installation token per role in `~/.secrets/<role>.env` (0600, per uid), short-lived (1 h) minted by a root helper | ruleset pins check sources to the reviewer/tester Apps |
| Netlify PAT (service user) | root file `/etc/lexbot/netlify.token` + Actions env secret `production-watchdog` | used only by `nf` and the watchdog; no agent can read it |
| Neon API key (`lexbot-ci` project) | root-owned `neon-branch` wrapper | agents get only a branch URL |
| Neon API key (prod, for T2 rehearsal) | Actions environment `migration-rehearsal` only | **never on the VPC** |
| Prod `DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY`, prod `GEMINI_API_KEY` | **Netlify env only** | agents use dummy/test values (`RESEND_API_KEY=re_test`, low-quota test Gemini key) |
| pi LLM keys | one key per role/provider project, hard monthly cap | stored in each uid's own pi `auth.json` |
Rules: gitleaks in pre-commit + CI; `.env.example` committed; no secrets in prompts/status files. **Rotation is a hard stop (§11)**; the leaked PAT in §0 and any key that touched the laptop remote should be rotated by you first.

## 10. Orchestrator workflow (you: steer only)
1. **Brief** in `tasks/T-xxx.md` (goal, acceptance criteria, risk) or tell `lead`; no approval needed after that.
2. **Dispatch** `scripts/agent/new-task.sh T-xxx` (worktree + Neon branch + coder); WIP cap 3–4.
3. **Watch** one dashboard pane: `watch -n10 'jq -rc "[.task,.stage,.state,.owner,.pr,.budget.cost]|@tsv" ~/agent-state/*/status.json'`; herdr sidebar badges (`blocked`, `done`); `herdr notification` for desktop alerts.
4. **Steer** by `herdr agent prompt <name> "…"`, editing the brief and re-dispatching, or `herdr agent attach`.
5. **You are only pulled in for**: `destructive-migration` approvals, secret-rotation requests, `needs_human` after exhausted retries, rollback that itself failed, cost-cap hits, and pi `blocked` prompts nobody can answer.
6. **Daily**: read `~/agent-state/digest-YYYY-MM-DD.md` (merges, rollbacks, spend, open incidents); end of day `scripts/agent/shutdown.sh`.

## 11. Guardrails (automated replacement for the human gate)
- **No-merge-without-gates:** ruleset-enforced required checks (§7); reviewer/tester are separate identities on different models; protected-path and size limits route risky PRs to `needs-human`.
- **No bad release stays live:** post-deploy smoke at +0/+3/+10 min, synthetic cron every 15 min, auto `restoreSiteDeploy` rollback, backup VM watchdog (§5.5).
- **Migration safety:** expand/contract, rehearsal on a prod-copy branch, build-time guard, audit table (§6a).
- **Hard stops (only you):** (1) destructive DB migration / prod data restore — `/approve-destructive <sha>` from your account; (2) secret rotation or any Netlify/GitHub/Neon/LLM credential change — wrappers expose no such operation, guard blocks `netlify env:*`, and agents file a `needs_human` request with the exact rotation checklist.
- **Cost/rate caps:** per task/agent/day dollar caps (§8), provider hard caps, ≤ 4 concurrent agents, ≤ 3 review rounds, ≤ 2 identical failed retries, ≤ 8 Neon branches, Netlify `ignore` rules to skip irrelevant builds (`git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- . ../shared`), max 6 production deploys/day (the deployer pauses auto-merge beyond that) and a merge freeze after 2 rollbacks in 24 h.
- **Kill switches (escalating):** (1) stop one agent (`herdr agent send-keys` Ctrl-C / `herdr pane close`); (2) `scripts/agent/panic.sh`: `touch ~/agent-state/PAUSE`, stop all pi agents, `nf autopublish both off`, disable auto-merge on open PRs (`gh pr merge --disable-auto`), delete `~/.secrets/*.env`; (3) `herdr machine disable vpc`; (4) cloud console: stop VM / cut egress; (5) revoke tokens at GitHub, Netlify, Neon, LLM providers (checklist in `docs/agents/RUNBOOK.md`). A GitHub repo variable `AGENTS_PAUSED=true` also makes all workflows that auto-merge or roll forward no-op (works even if the VM is gone).
- **Network:** egress allow-list, no inbound, Neon IP allow-list where the plan supports it.

## 12. Observability
- **Agent plane:** herdr states; `status.json`; `audit.log` (wrapper-written); pi JSONL transcripts (replay/forensics, `pi --export`); `herdr pane read`; daily digest.
- **Pipeline plane:** `gh pr checks`, Actions history, `nf wait` artefacts, `migration_audit` table.
- **Runtime plane:** smoke results, synthetic cron, `netlify logs:function` for the api site, `/api/health` (with commit sha) as the canonical liveness + version probe.
- **System plane:** cloud CPU/RAM/disk (>80 %) alarms, idle-VM auto-stop, budget alerts (cloud, LLM, Netlify build minutes, Neon).
- **Notifications to you:** only the §10.5 list, via `herdr notification` plus one push channel (e.g. ntfy/Slack webhook) from Actions.

## 13. Failure and rollback handling
| Failure | Detection | Response (autonomous unless noted) |
|---|---|---|
| Preview build fails | Netlify status / `nf wait` exit 1 | Deployer posts failure packet (state, error_message, last 80 log lines, SHA) → coder reproduces locally, fixes (≤3 loops) → `needs_human` |
| CI / review / test fails | checks | Back to coder with failing names; reviewer re-reviews delta only |
| Production build fails | `state=error` on `main` | Nothing published; incident issue + `agent-task`; merge freeze on `main` until fixed (auto-merge disabled by watchdog) |
| Production deploy live but smoke fails | §5.5 | `restoreSiteDeploy` to `LAST_GOOD`, re-smoke, incident issue, auto-publish stays locked until fix verified, then re-enabled |
| Rollback fails or smoke still red | §5.5 step 4 | Page you; `panic.sh` pauses merges |
| Migration fails in build | build `error` | Nothing published; DB unchanged or partially applied → `migration_audit` shows status; coder writes corrective *forward* migration (expand-only) |
| Migration is destructive | `migration-gate` | **You** approve or reject |
| Bad data / need restore | incident | **You** (PITR branch from `migration_audit.ts`) |
| Agent loops / runaway cost | token accountant, `blocked` >15 min, repeated identical commands | kill agent, `needs_human` |
| VM lost | `herdr machine status` fails | state is in git + nightly `~/agent-state` snapshot to a bucket; Actions watchdog continues; rebuild via `bootstrap-vpc.sh` |

## 14. Fixes needed in existing `vpc-setup/`
- Site names: **done** (`legal-chatbot-demo` → `lex-bot-chatbot`; also in root `README.md`).
- `deploy-push.sh` pushes from the deployer — remove; coder pushes, merger merges. `deploy-status.sh`/`deploy-compare.sh` use `grep` for JSON → rewrite with `jq`, move into root-owned `nf`.
- Replace the single "ayush/teammate shift" model and single-workspace layout with §4/§6 (worktree per agent, one uid per role).
- `README.md` uses a placeholder clone URL; pin the verified herdr install command (§4).
- `DEPLOY-AGENT-RUNBOOK.md` currently tells the deployer to deploy/push; rewrite to the §5 watchdog + rollback runbook.

## 15. Phased rollout

**Phase 0 — Hygiene (day 1).** §0 items (revoke PAT, confirm whether the Neon DB is prod, `.env.example`). Create GitHub Apps (coder/reviewer/tester/merger), Netlify service user + PAT, Neon `lexbot-ci` project with `baseline`, LLM keys with caps. Ruleset on `main` (initially: PR required, no force-push, `ci/verify`).
**Phase 1 — Repo readiness (days 1–3).** `.github/workflows/{ci,migration-gate,post-deploy,synthetic}.yml`; `CODEOWNERS`; `scripts/migration-lint.mjs`, `scripts/migrate-guard.mjs`, `[context.production]` command in `packages/api/netlify.toml` (do **not** enable the migrate step until the Phase 3 drill); `/api/health` returning commit sha; smoke account + `is_smoke` no-side-effect path; `scripts/smoke/live.sh`; schema/test-schema parity test; env-driven Neon fetch endpoint (T1′); `docs/agents/*.md`; `scripts/agent/{new-task,handoff,tokens,panic,shutdown}.sh`; `pi-guard.ts`; Netlify `ignore` rules.
**Phase 2 — VPC up (days 2–4).** Provision VM, Tailscale, users/sudoers, `nf` and `neon-branch` wrappers, herdr + systemd, `herdr machine add`, shared pnpm store; confirm the Netlify log endpoint and `restoreSiteDeploy`/lock behaviour with `nf`; `pnpm regression` green on a T1 Neon branch.
**Phase 3 — Single-lane pilot (days 4–6).** One docs/widget-copy task through coder→reviewer→tester→auto-merge→production with **auto-merge limited to widget + docs paths**; drills (below). Then one expand-only migration through T2 rehearsal + build-time apply.
**Phase 4 — Widen autonomy (week 2).** Enable auto-merge for api paths, 3 parallel tasks, per-role uids enforced, VM watchdog timer, daily digest, optional webhooks (§5.5 option D).
**Phase 5 — Harden (week 3+).** Cost dashboards, nightly VM/state snapshots, token rotation cadence (done by you), second VM, evaluate GitHub merge queue everywhere, consider rootless containers per role.

### First-week checklist
- [ ] Revoke leaked PAT; `origin` → SSH; remove `origin2`
- [ ] **Determine whether the `ep-solitary-waterfall-aqb5cwtt` DB is production; if so stop running e2e against it**
- [ ] Netlify sites confirmed: `lex-bot-v0` (api+dashboard), `lex-bot-chatbot` (widget); IDs recorded in the `nf` wrapper; **auto-publish stays ON**
- [ ] Neon `lexbot-ci` project + `baseline` branch (migrated + seeded); `neon-branch` wrapper works
- [ ] Decision D3 answered (prod-copy rehearsal branch with PII inside Actions only: yes/no)
- [ ] GitHub Apps created; ruleset on `main` with required checks pinned to App sources; no human approval required
- [ ] `ci.yml` green on a throwaway PR; gitleaks active
- [ ] `/api/health` + smoke account + `scripts/smoke/live.sh` verified against live URLs (read-only calls)
- [ ] `post-deploy.yml` verified; **rollback drill**: deploy a deliberately broken health response on a throwaway commit, watch auto-restore, re-verify smoke, confirm lock/unlock behaviour
- [ ] `migration-gate` drills: (a) additive migration passes + rehearsal runs; (b) a `DROP COLUMN` PR is blocked until you comment `/approve-destructive`
- [ ] VM up (Tailscale-only, no inbound), per-role uids, sudoers allow-list, egress allow-list
- [ ] herdr installed; `herdr machine add agent@agents-1 --label vpc` ok; `herdr --machine vpc workspace list` returns JSON
- [ ] `pi-guard.ts` blocks a forbidden command in each role (negative tests)
- [ ] Token accountant produces cost per task; cap kill tested
- [ ] `nf wait` returns state + log for a real preview deploy and for an intentional build break
- [ ] One end-to-end task (coder→reviewer→tester→auto-merge→smoke) with zero human actions beyond the brief
- [ ] Kill-switch drill: `panic.sh`, `AGENTS_PAUSED=true`, `herdr machine disable vpc`
- [ ] Budget alerts (cloud, LLM, Netlify minutes, Neon) confirmed

## 16. Decisions

| # | Decision (yours unless marked) | Consequence in this plan |
|---|---|---|
| D1 | Sites: `lex-bot-v0` = API + dashboard; `lex-bot-chatbot` = dummy website with widget attached. `legal-chatbot-demo` was a stale name. | §1, §5; `vpc-setup/*` and `README.md` corrected; `nf` wrapper allow-lists exactly these two sites |
| D2 | All roles use `pi` only | `herdr agent start <name> --kind pi --pane <ID> -- <pi flags>`; pi-specific guard extension, `--tools` per role, `--session-dir` token accounting (§4, §8) |
| D3 | No staging/dev DB exists → tiers T0–T3: SQLite mirror for unit tests, per-worktree Neon branches of a PII-free baseline in a separate `lexbot-ci` project for e2e, prod-copy Neon branch for migration rehearsal in Actions only, build-time migration for production. **Open: confirm you accept prod-copy rehearsal (legal-lead PII stays inside Neon/Actions, never exposed to agents).** If not, drop T2 and rely on baseline-with-synthetic-volume + rules 1–6. | §0.2, §6, §6a |
| D4 | Netlify **auto-publish stays ON**; manual publish gate removed | Safety shifts to required checks (§7) + post-deploy smoke + auto-rollback (§5.5); rollback leaves auto-publish locked until the fix is verified |
| D5 | Maximum autonomy; you only orchestrate | Human approval requirement replaced by CI + reviewer + tester + migration gate checks; reviewer/tester on a different model |
| D6 | Hard stop #1: destructive DB migrations (and prod data restore) need your explicit sign-off | `/approve-destructive <sha>` mechanism; unknown SQL = destructive |
| D7 | Hard stop #2: secret rotation needs you | No wrapper, token scope or guard rule lets any agent rotate/change credentials or Netlify env vars |
| D8 | Rate/cost caps and kill switch | §8 (per task/agent/day dollars, pi usage JSONL accountant), §11 kill switches incl. `AGENTS_PAUSED` |
| **D9 (proposed addition — your call)** | **Guardrail self-protection:** agents may not modify the files that implement their own guardrails: `.github/**`, `CODEOWNERS`, `scripts/migration-lint.mjs`, `scripts/migrate-guard.mjs`, `netlify.toml` files, `docs/agents/**`, `scripts/agent/**`, `pi-guard.ts`. PRs touching them get `needs-human` and need your review. | This is a third human touchpoint beyond the two you specified; without it an agent (or an injected prompt) could disable the gates and the "automated safeguards" would be advisory. Say "drop D9" if you accept that risk; the rest of the plan works either way |

Remaining open items (verify during Phase 2, none block the plan): exact herdr server start flags; Netlify build-log endpoint; whether `restoreSiteDeploy` locks auto-publish exactly as assumed; Neon plan PITR window; whether `neon-http` migrations are atomic.
