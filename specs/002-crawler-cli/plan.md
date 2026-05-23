# Implementation Plan: Crawler CLI

**Branch**: `002-crawler-cli` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-crawler-cli/spec.md`

## Summary

The Crawler CLI is a standalone Node.js command-line tool that crawls a
law firm's website (or a local HTML directory) and emits structured
markdown files plus a `_manifest.json` that downstream features
consume. Per §3.1, it is "the primary mechanism for giving the chatbot
relevant, firm-specific context"; per §12.5 it is **Phase 1** —
the first deliverable phase after Foundation, and Phase 2's Context
Search Agent depends on its output schema.

Significant scaffolding already exists in `packages/crawler/`:
`cli.ts`, a working `lib/crawler.ts` orchestrator, `lib/fetcher.ts`
with same-origin link discovery, `lib/extractor.ts` with a
chrome-stripping selector list, `lib/markdown.ts` HTML→markdown
conversion via `unified`/`rehype-remark`/`remark-stringify`,
`lib/manifest.ts` writer, and `utils/` for filename, hash, keywords,
and section-type inference. Cheerio is wired in, `p-limit` is in
`package.json`, Playwright is in `package.json`. A `test-site/`
directory with fictional firm HTML is in place for unit tests.

This plan targets the **gaps** between the spec's 53 FRs and the
existing implementation:

- **R1** — Playwright-based CSR rendering with auto-detection (FR-017, FR-019).
- **R2** — `robots.txt` compliance and `sitemap.xml` discovery (FR-022, FR-023, FR-025).
- **R3** — `.crawlerrc.json` configuration loader with URL exclusions, custom selectors, max depth (FR-014–FR-016).
- **R4** — Near-duplicate detection and consolidation (FR-029–FR-031).
- **R5** — Incremental crawling (read existing manifest; only overwrite changed; remove stale; manifest regeneration) (FR-046–FR-051).
- **R6** — Page-size splitting at ~2000 words by heading boundaries (FR-035, FR-036).
- **R7** — `p-limit` concurrency control for parallel page fetches.
- **R8** — `--config` CLI flag (FR-012, currently missing from `cli.ts`).
- **R9** — Determinism guarantee (already partially implemented; verify all timestamps and hash inputs).

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (Foundation
constraint). Output is ESM (`"type": "module"`).

**Primary Dependencies** (Crawler-owned; all already present in
`packages/crawler/package.json` per §9.9):

- `playwright` — headless browser for CSR pages (§3.5, §9.4).
- `cheerio` — HTML parsing for static pages (§3.5, §9.9).
- `unified` + `rehype-parse` + `rehype-remark` + `remark-gfm` +
  `remark-stringify` — HTML→markdown pipeline (§9.9).
- `p-limit` — concurrency control (§9.9).
- `zod` — config-file and frontmatter schema validation (Constitution
  Principle II).
- `@legal-chatbot/shared` — Zod schemas for the manifest and
  frontmatter shapes (Constitution Principle II).

**Storage**: Local filesystem only. The Crawler is the **only writer**
of `pages/` and `_manifest.json` in the context store (§5.10). It
reads an existing `_manifest.json` on incremental runs (§3.12 step 1).
No database access. No network access except outbound HTTPS to the
target site and (for Playwright) browser-driven fetch of secondary
resources.

**Testing**: Vitest. Existing tests cover `extractor`, `markdown`,
`filename`, `hash`, `keywords`, `section-type`. Gap-filling tests will
cover: config loader, robots/sitemap parsing, dedup consolidation,
incremental detection, page splitting, concurrency. The `test-site/`
fixture is the binding test corpus per §12.4.

**Target Platform**: Node 20+ on developer machines or CI runners. Per
§3.2, the Crawler is "Not a hosted service"; it runs locally on the
lawyer's or developer's machine, or as a CI step. No serverless
constraint applies (this CLI is not deployed to Netlify Functions; the
npm-published binary runs wherever Node runs).

**Project Type**: TypeScript CLI library, distributed via npm
(§9.7 row 3) with `bin: "legal-chatbot-crawl"` (already set in
`packages/crawler/package.json`).

**Performance Goals**:
- Default crawl budget = 100 pages (`--max-pages` per §3.3).
- Incremental re-runs MUST be fast: only changed-content pages
  rewritten (§3.12 closing line: "keeps crawl times short for routine
  updates and avoids unnecessary file churn"). Specific time goal
  not set by the spec.
- Concurrency is `p-limit`-controlled (§9.9). Default value not
  prescribed by the spec; safe default of 4 concurrent fetches is
  acceptable (Assumption in spec).

**Constraints**:
- TS strict (Constitution II).
- No native binaries except `playwright` (which downloads its own
  browsers but is **dev/CLI-only** — never shipped to Netlify
  Functions). Constitution IV's no-native-binary rule applies to
  production runtime packages; the CLI is a separate release artifact.
- Output MUST be deterministic when `--deterministic` is set
  (§3.3 + §12.6 done-when).
- Crawler MUST honor `robots.txt` (§3.6).
- Crawler MUST never write outside `outputDir` (security boundary).
- Frontmatter and manifest schemas are part of the Phase 2 contract;
  any schema change here breaks Context Search Agent.

**Scale/Scope**: ~100 pages typical (default `--max-pages`); the
Shrager seed content has "~100 pages total" per §12.4. The Crawler
must handle small static sites (5–20 pages) up to medium law-firm
sites (~100 pages) without manual tuning.

## Constitution Check

The Crawler is evaluated against Lex Bot Constitution v1.0.0:

| # | Principle | Crawler applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Every Crawler FR cites a §3.x or §5.x or §12.6 source. No scope creep beyond §3 and the §5 cross-references already in the spec. | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | Frontmatter and manifest schemas live in `packages/shared/src/schemas/` (already exist: `frontmatter.ts`, `manifest.ts`). The `.crawlerrc.json` config file is parsed via Zod. CLI args parsed via Node's `parseArgs` then validated via Zod. | ✅ PASS |
| III | Test-First, Layered Testing | Each new gap-filler module gets a Vitest unit test before implementation. The `test-site/` fixture exercises end-to-end runs deterministically. | ✅ PASS |
| IV | Serverless / Stateless Architecture | The Crawler is a CLI, not a deployed service — it does not run on Netlify Functions. Constitution IV's no-fs-at-runtime rule does not apply. The "no native binaries" rule applies to production runtime packages; Playwright is acceptable here because it ships **with the CLI**, not with the API. | ✅ PASS — explicit carve-out documented in research.md R1 |
| V | Privilege & Privacy | The Crawler writes only publicly available website content to the context store (§5.2 security note). It MUST NOT include any non-public data even if it appears on the site (e.g., admin pages reachable via accidental link discovery — `robots.txt` and `--exclude` are the controls). | ✅ PASS |
| VI | Bounded, Observable Agent | Not directly applicable — Crawler is not the agent. However, Crawler emissions to the structured logger (Foundation) MUST be redacted-clean and queryable. | ✅ PASS |
| VII | Phased Incremental Delivery | Crawler is Phase 1 (§12.5). Its output schema (`_manifest.json` + frontmatter) is the input contract for Phase 2 (Context Search Agent). Schema changes here MUST be coordinated with `003-context-search`. | ✅ PASS |

**Architectural Limits relevant to Crawler**:
- `--max-pages` default = 100 (§3.3, Constitution Architectural Limits).
- Individual markdown files capped at ~2000 words; oversized pages MUST be split by heading (§5.7, Constitution Architectural Limits).

**Result**: All gates PASS. No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/002-crawler-cli/
├── plan.md              # This file
├── research.md          # Phase 0 — research notes
├── data-model.md        # Phase 1 — output artifact schemas (markdown file + manifest + config file)
├── quickstart.md        # Phase 1 — operator walkthrough
├── contracts/           # Phase 1 — CLI contract, frontmatter contract, manifest contract, config-file contract
│   ├── cli-contract.md
│   ├── frontmatter-contract.md
│   ├── manifest-contract.md
│   └── crawlerrc-contract.md
└── tasks.md             # Phase 2 — created by /speckit.tasks (NOT here)
```

### Source Code (`packages/crawler/`)

Existing files (✅ keep; ⚠ extend; ❌ new):

```text
packages/crawler/
├── package.json                    # ✅ exists; Playwright + cheerio + p-limit + unified/rehype/remark all listed
├── tsconfig.json                   # ✅ exists
├── vitest.config.ts                # ✅ exists
├── test-site/                      # ✅ exists — fictional Demo Law Firm fixture
├── src/
│   ├── cli.ts                      # ⚠ EXTEND — add --config flag (FR-012)
│   ├── index.ts                    # ⚠ EXTEND — re-export new modules
│   ├── lib/
│   │   ├── crawler.ts              # ⚠ EXTEND — wire in robots, sitemap, config, dedup, incremental, splitting, concurrency
│   │   ├── fetcher.ts              # ⚠ EXTEND — robots.txt + sitemap.xml + Playwright fallback + p-limit (R1, R2, R7)
│   │   ├── extractor.ts            # ✅ keep (selector list already comprehensive)
│   │   ├── markdown.ts             # ✅ keep (unified pipeline)
│   │   ├── manifest.ts             # ⚠ EXTEND — read-existing on incremental (R5); preserve order (R9)
│   │   ├── config.ts               # ❌ NEW — .crawlerrc.json loader with Zod (R3)
│   │   ├── robots.ts               # ❌ NEW — robots.txt parsing + compliance (R2)
│   │   ├── sitemap.ts              # ❌ NEW — sitemap.xml parsing (R2)
│   │   ├── playwright-renderer.ts  # ❌ NEW — Playwright page render with CSR auto-detect (R1)
│   │   ├── csr-detector.ts         # ❌ NEW — heuristic for "needs JS rendering" (R1)
│   │   ├── dedup.ts                # ❌ NEW — near-duplicate detection + consolidation (R4)
│   │   ├── incremental.ts          # ❌ NEW — diff existing manifest vs. new pages (R5)
│   │   └── splitter.ts             # ❌ NEW — split >2000-word pages by heading (R6)
│   └── utils/
│       ├── filename.ts             # ✅ keep
│       ├── hash.ts                 # ✅ keep
│       ├── keywords.ts             # ✅ keep
│       └── section-type.ts         # ✅ keep
```

**Structure Decision**: Continue with the existing `packages/crawler/` layout. All new functionality lands in new files under `src/lib/` (one module per concern, paralleling existing organization). The `cli.ts` is extended with two new flags (`--config`, optional Playwright on/off) but its overall shape is preserved. `crawler.ts` becomes the orchestrator that wires the new modules together; the existing pipeline stays.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. All seven Constitution principles pass. The one notable carve-out — Playwright as a CLI runtime dependency — is explicit in research.md R1 and is not a Constitution IV violation because Constitution IV's no-native-binary rule scopes to "production packages" (i.e., Netlify-deployed packages). The CLI is npm-distributed and runs on the lawyer's or engineer's machine, not on Netlify Functions.


## Phase 1 Outputs Summary

| Artifact | Path | Status |
|---|---|---|
| Plan | `specs/002-crawler-cli/plan.md` | ✅ written |
| Research | `specs/002-crawler-cli/research.md` | ✅ written (11 research items) |
| Data model | `specs/002-crawler-cli/data-model.md` | ✅ written (5 entities) |
| Contracts | `specs/002-crawler-cli/contracts/` | ✅ written (4 contracts: cli, frontmatter, manifest, crawlerrc) |
| Quickstart | `specs/002-crawler-cli/quickstart.md` | ✅ written |
| AGENTS.md | repo root | ✅ updated |

## Constitution Re-Check (Post-Design)

After completing Phase 0 and Phase 1, the Constitution Check is
re-evaluated against the concrete design.

| # | Principle | Concrete artifact verification | Status |
|---|---|---|---|
| I | MVP-First Discipline | Every research item, contract, and data-model entity cites a §-anchor in the source spec | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | Frontmatter, manifest, and `.crawlerrc.json` schemas all defined as Zod in `packages/shared/src/schemas/`; both writer (Crawler) and reader (Phase 2) validate | ✅ PASS |
| III | Test-First, Layered Testing | R11 documents the test strategy: each new lib module gets a Vitest test before implementation; the `test-site/` fixture is the binding integration corpus | ✅ PASS |
| IV | Serverless / Stateless Architecture | Carve-out for Playwright as a CLI-only runtime dep is explicit in plan.md and R1; Crawler is npm-distributed not Netlify-deployed | ✅ PASS |
| V | Privilege & Privacy | `robots.txt` + `--exclude` + `.crawlerrc.json` `exclude` field give layered controls to keep non-public pages out of the context store | ✅ PASS |
| VI | Bounded, Observable Agent | Crawler emissions go through Foundation logger (redaction-clean); not directly the agent | ✅ PASS |
| VII | Phased Incremental Delivery | Schema additions to frontmatter (`alternate_urls`) treated as non-breaking optional fields; coordinated cross-phase change documented in R10 | ✅ PASS |

**Architectural Limits**:
- `--max-pages` default 100 enforced by FR-010 / cli-contract.
- ~2000-word file cap enforced by R6 / FR-035–FR-036.

**Result**: All gates PASS post-design. No Complexity Tracking entries
required.

## Hand-Off to `/speckit.tasks`

`tasks.md` will be derived from:

- 5 user stories in `spec.md` (P1, P1, P1, P2, P2).
- 53 FRs in 13 groups.
- 11 research items in `research.md` (R1–R11).
- 4 contracts in `contracts/`.

The task graph is moderately parallelizable: the new `lib/` modules
(`config.ts`, `robots.ts`, `sitemap.ts`, `playwright-renderer.ts`,
`csr-detector.ts`, `dedup.ts`, `incremental.ts`, `splitter.ts`) are
mostly independent and can be developed in parallel after their
contracts and tests are in place. The orchestrator (`crawler.ts`)
integration is the convergence point.
