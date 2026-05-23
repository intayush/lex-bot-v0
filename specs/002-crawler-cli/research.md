# Phase 0 Research: Crawler CLI

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document resolves all Technical Context decisions for the
Crawler CLI against `product-spec-legal-chatbot.md` (§3.1–§3.12,
§5.5/5.7/5.8/5.10, §9.4 Playwright rationale, §9.9 Additional
Libraries, §12.6 Phase 1 deliverable) and the Lex Bot Constitution
v1.0.0.

There were no `NEEDS CLARIFICATION` markers in the Technical Context;
the items below are best-practices investigations and dependency
patterns required by the gap-fill plan.

## R1. Playwright Renderer + CSR Auto-Detection

**Decision**: Add `lib/playwright-renderer.ts` that lazily launches a
headless Chromium instance (single browser, single context, multiple
pages) for the duration of a crawl run, then closes it before the
process exits. Add `lib/csr-detector.ts` implementing the §3.5
auto-detection heuristic: fetch HTML via `fetch()` first; inspect
the body; if "mostly empty" or contains JS bootstrap markers (e.g.,
`<div id="root"></div>` with no children, `<div id="app"></div>` with
no children, body has < N visible text characters), re-fetch via
Playwright. The fetcher orchestrator picks the result.

**Rationale**:
- §3.5 explicitly mandates this auto-detection algorithm in three
  steps; FR-019 binds it.
- §9.4 names Playwright over Puppeteer for "Auto-wait, less
  flakiness" and multi-engine support. Already in
  `packages/crawler/package.json`.
- A single browser launched per run amortizes the ~1–2 second startup
  across all CSR pages in the crawl. Per-page browser launches would
  multiply the cost.
- Lazy launch means static-only crawls (e.g., the `test-site/`
  fixture) never start a browser at all — preserving fast unit-test
  runs.

**Alternatives considered**:
- Puppeteer: explicitly rejected by §9.4.
- Always render via Playwright: rejected. Most law-firm sites are
  static or SSR'd; rendering everything quintuples crawl time.
- Use the JSDOM render path: rejected. JSDOM does not execute
  `<script>` tags reliably; the spec requires "JavaScript-heavy
  pages" support.

**Implementation notes**:
- The renderer waits for `domcontentloaded` plus a short
  `waitForLoadState('networkidle', { timeout: 5000 })` to allow
  initial XHR-fetched content to land.
- The renderer's `page.content()` returns the rendered DOM as HTML;
  this string is then fed into the existing `extractor.ts` pipeline
  unchanged.
- Browser binaries are NOT bundled into the npm package; the
  `playwright` package's `postinstall` downloads them on first
  install. Document this in `quickstart.md`.
- Auto-detection heuristic is tunable; a deterministic "if body
  text < 200 visible characters AND any `id="root|app|main"` div
  with no children" rule covers the §3.5 example without false
  positives on small but legitimate static pages. Fine-tune using
  the `test-site/` fixture and a small known-CSR sample.

**Constitution carve-out**: Constitution IV forbids native binaries
in **production packages** (Netlify deploys). The Crawler is an
**npm-published CLI** (per §9.7 row 3) that runs on a developer's
machine or in CI — not on Netlify. Playwright is therefore allowed
here. This carve-out is documented in `plan.md` Constitution Check.

## R2. robots.txt Compliance & sitemap.xml Discovery

**Decision**: Add `lib/robots.ts` and `lib/sitemap.ts`. Before any
page fetching begins, the orchestrator fetches `<rootOrigin>/robots.txt`
and parses its `Disallow:`, `Allow:`, and `Sitemap:` directives. The
fetcher consults the parsed disallow list for every candidate URL.
Sitemap URLs (from `robots.txt`'s `Sitemap:` directive plus the
default `<rootOrigin>/sitemap.xml` fallback) are fetched and parsed;
all `<loc>` entries are added to the BFS queue with deduplication
against `visited`.

**Rationale**:
- §3.6 binds `robots.txt` compliance and `sitemap.xml` use.
- FR-022, FR-023, FR-024, FR-025 all derive from these two
  passages.
- Robots compliance is also a courtesy expected of any web crawler;
  ignoring it is grounds for IP blocks on the source site.
- Sitemaps catch pages not linked in nav (e.g., individual blog posts
  buried under date-based archives) — concrete benefit for
  attorney-bio and practice-area discovery.

**Alternatives considered**:
- `robots-parser` npm library: pulls in a small dep but the parser
  logic for the four directives we need is ~50 lines; doing it
  in-house keeps the dep surface minimal.
- `xml2js` for sitemap parsing: also viable; for sitemaps
  `cheerio`'s XML mode (`{ xmlMode: true }`) handles simple
  `<urlset><url><loc>` shapes without an extra dep. We already
  depend on `cheerio` (§9.9).

**Implementation notes**:
- `robots.txt` fetch failures (404, network error) are non-fatal
  — the crawl proceeds with no disallow list (standard convention).
- A `robots.txt` reachable but empty applies no restrictions.
- The user-agent string the Crawler sends is `legal-chatbot-crawl/<version>`
  so site operators can identify our traffic.
- Sitemap-index files (a sitemap that points to other sitemaps)
  are followed one level deep.
- Both modules are deterministic: the parsed disallow list and the
  flattened sitemap URL list have stable order.

## R3. .crawlerrc.json Configuration Loader

**Decision**: Add `lib/config.ts` that reads `.crawlerrc.json` from
the current working directory (or the `--config` path) and validates
its shape against a Zod schema. The shape is:

```jsonc
{
  "exclude": ["/admin/*", "/login"],
  "selectors": {
    "content": "article.main-content",
    "title": "h1.page-title"
  },
  "maxDepth": 3
}
```

All three fields optional. Unknown fields trigger a warning but not
an error (forward-compat).

**Rationale**:
- §3.4 binds the three responsibilities of the config file.
- FR-014–FR-016 enumerate them.
- Zod-validated parsing satisfies Constitution Principle II.

**Alternatives considered**:
- `cosmiconfig` for cascading config discovery: overkill. The spec
  defines exactly one location (CWD) and one filename
  (`.crawlerrc.json`), with `--config` as the override. A
  hand-rolled loader is sufficient.
- YAML/TOML: rejected. The `.json` extension in §3.3 binds JSON.

**Implementation notes**:
- The `--exclude` CLI flag and the config-file `exclude` field are
  unioned (CLI flag adds to config file's list).
- Custom selectors override `extractor.ts`'s default selectors when
  set; otherwise defaults apply.
- `maxDepth` caps the BFS depth from the root URL. When unset, depth
  is unbounded but `--max-pages` still bounds total pages.

## R4. Near-Duplicate Detection & Consolidation

**Decision**: Add `lib/dedup.ts` that, after content extraction
(post-`extractor.ts`, pre-`markdown.ts`), groups pages whose extracted
content shares a high similarity score. For MVP, "high similarity" is
defined as identical SHA-256 of the extracted plain-text body — i.e.,
exact-match dedup only. Near-duplicate-but-not-exact (e.g.,
print-version pages with one extra line) is handled by the §5.7
splitter and the manifest-keyword overlap; deeper similarity (cosine
on token shingles) is post-MVP.

For exact-match groups, the canonical URL is the one with the
shortest path (heuristic for "main" vs. "print" or "?utm_*"
variants). The other URLs are recorded in the canonical markdown's
frontmatter as `alternate_urls: ["...", "..."]` per §3.9
("Consolidates duplicates into a single markdown file with a note
referencing alternate URLs").

**Rationale**:
- §3.9 binds dedup. FR-029, FR-030, FR-031.
- Exact-match dedup catches the most common cases (paginated
  listings serving identical content; `?utm_*` query-string variants;
  print-only versions that link to the same article body).
- Doing more than exact-match (e.g., MinHash, vector embeddings)
  exceeds MVP scope and has no §-anchor. Recording it as
  Assumption-deferred.

**Alternatives considered**:
- MinHash / SimHash: viable for near-duplicate detection but adds a
  dep and tunable thresholds; not needed for MVP.
- Skip dedup entirely: rejected. §3.9 binds it.

**Implementation notes**:
- Dedup runs **after** content extraction so that nav/footer
  variations between pages don't defeat it.
- The `alternate_urls` frontmatter field is **new** but fits within
  the §3.11 frontmatter schema's spirit (extensibility); it does
  not change any of the six required fields. A note is added to the
  manifest contract.
- Dedup is deterministic: groups are sorted by URL, canonical
  selection is deterministic.

## R5. Incremental Crawling

**Decision**: Add `lib/incremental.ts` that, before fetching pages,
reads the existing `_manifest.json` (if any) at `<outputDir>/_manifest.json`.
After the new fetch+extract pipeline completes, compute the new
`content_hash` per page and:

1. For pages where the hash is unchanged → leave existing markdown
   file in place.
2. For pages where the hash has changed → overwrite the markdown
   file.
3. For pages new in the current crawl but absent from the old
   manifest → create the markdown file.
4. For pages in the old manifest but not in the current crawl →
   delete the markdown file.
5. Regenerate `_manifest.json` to reflect the current state.

**Rationale**:
- §3.12 binds the algorithm in five numbered steps.
- FR-046–FR-051 enumerate them.
- §5.9 ("`_manifest.json` is regenerated as the single source of
  truth") provides the closing rule.

**Alternatives considered**:
- Always overwrite (current behavior): rejected; defeats §3.12's
  "keeps crawl times short for routine updates and avoids
  unnecessary file churn."
- Use mtime-based diffing: rejected. Content hash is the spec's
  binding mechanism.

**Implementation notes**:
- The incremental read is non-fatal on missing manifest (first crawl
  case).
- Deletion is performed only on files inside `<outputDir>/pages/` —
  the module never deletes outside this directory (security
  boundary).
- The `_manifest.json` `generated_at` field uses the new run's
  timestamp (or the deterministic literal under `--deterministic`).

## R6. Page Splitting at ~2000 Words

**Decision**: Add `lib/splitter.ts` that, after content extraction
(post-`extractor.ts`), measures the extracted text word count. If
the count exceeds 2000 words, split the page along its top-level
heading boundaries (h1, h2 in document order) into multiple logical
pages. Each split inherits the original URL but gets a different
filename suffix derived from the heading slug (e.g., a long FAQ page
becomes `faq--general.md`, `faq--personal-injury.md`).

**Rationale**:
- §5.7 binds the cap and the splitting strategy.
- FR-035 + FR-036.
- §5.7's example (a long FAQ page becoming `faq--general.md`,
  `faq--personal-injury.md`) is the binding output pattern.

**Alternatives considered**:
- Token-based splitting at fixed boundaries: rejected. Splits
  mid-section, defeating §5.7's "logical sections by heading"
  requirement.
- Splitting only on h1: rejected. Some pages have one h1 and many
  h2s; h2 boundaries are also valid splits.

**Implementation notes**:
- The slug for the suffix is derived from the heading text via the
  same kebab-case rule used by `utils/filename.ts`.
- Each split file's frontmatter `source_url` is the original URL
  (lossless retrieval).
- Each split's `content_hash` is computed on its own body.
- The splitter runs **after** dedup but **before** markdown
  conversion, so the splits use the same HTML→markdown pipeline as
  un-split pages.

## R7. Concurrency Control with p-limit

**Decision**: Wrap the page-fetch step in `lib/fetcher.ts` with
`p-limit(N)` where `N` defaults to 4 concurrent fetches. Override
via a `--concurrency` flag (not in the spec — captured as an
Assumption in `spec.md`).

**Rationale**:
- §9.9 names `p-limit` for "Concurrency control for parallel page
  fetches (crawler)." Already in `package.json`.
- Concurrency dramatically reduces wall-clock time for medium sites
  (~100 pages × ~500ms per page = 50s sequential; with 4 concurrent
  ~12.5s).
- Default of 4 is conservative — most law-firm sites are small
  enough to not be rate-limited at this concurrency.

**Alternatives considered**:
- Higher default (e.g., 10): risks tripping rate limits on small
  shared hosting tiers used by small firms. 4 is a safer default.
- No concurrency (sequential): rejected; existing implementation is
  already sequential and would benefit from this change.

**Implementation notes**:
- Concurrency only applies to the static-fetch path. Playwright
  rendering is sequential by default to avoid overwhelming the
  browser context (could be revisited post-MVP).
- `robots.txt` `Crawl-Delay:` directive, if present, should override
  concurrency (concurrency = 1, sleep = `Crawl-Delay` seconds
  between fetches). Spec is silent on this; standard convention.

## R8. CLI --config Flag Wiring

**Decision**: Extend `cli.ts`'s `parseArgs` options with a
`config` (string, default `.crawlerrc.json`) flag matching §3.3's
options table. The crawler orchestrator reads the config-file path,
loads + validates via `lib/config.ts`, merges with CLI flags
(CLI takes precedence for `exclude`, `maxDepth` is config-only).

**Rationale**:
- §3.3 binds `--config` with default `.crawlerrc.json`.
- FR-012.
- Currently absent from `cli.ts`.

**Alternatives considered**: none meaningful.

**Implementation notes**:
- Missing `.crawlerrc.json` is non-fatal (use defaults).
- Explicit `--config /some/path.json` that doesn't exist is fatal
  (user explicitly asked for a file that isn't there).

## R9. Determinism Audit

**Decision**: Audit every place a non-deterministic value enters the
output (timestamps, hashes, file ordering, JSON property ordering)
and gate each behind the `--deterministic` flag. Specifically:

1. Manifest `generated_at`: already gated (`'2026-01-01T00:00:00.000Z'`
   under deterministic mode).
2. Frontmatter `crawled_at`: must use the same gate.
3. Page processing order: must be sorted by URL (lexicographic) so
   manifest `files` array is reproducible.
4. Manifest `files` array: sorted by `path`.
5. JSON serialization: `JSON.stringify(obj, null, 2)` is
   deterministic for plain objects.

**Rationale**:
- §3.3 `--deterministic` flag.
- §12.6 done-when: "Re-running produces identical output (deterministic)".
- FR-052 + SC-004.

**Alternatives considered**: none. Determinism is a binding
requirement.

**Implementation notes**:
- A small helper `lib/clock.ts` exposes `now(deterministic: boolean)`
  returning either current ISO string or the fixed literal. All
  timestamp emissions go through it.
- Page-fetch ordering is currently insertion-order from BFS; switch
  to sort-after-fetch under deterministic mode (or always — sorting
  the manifest is cheap and removes a class of test flake).

## R10. Frontmatter & Manifest Schema Consumer Coordination

**Decision**: Treat the frontmatter schema (§3.11) and the manifest
schema (§5.5) as the **integration contract** with `003-context-search`.
Both schemas are already defined as Zod schemas in
`packages/shared/src/schemas/frontmatter.ts` and
`packages/shared/src/schemas/manifest.ts`. The Crawler imports these
schemas and validates every emission before write — guaranteeing
that downstream consumers receive only valid data.

The new dedup field `alternate_urls` (per R4) is an OPTIONAL
addition to the frontmatter schema. The schema modification is a
**coordinated change**: the Zod schema in `packages/shared` adds an
optional field; both the Crawler (writer) and Context Search
(future reader) accept the optional field; downstream parsers
ignore it if not used. No breaking change.

**Rationale**:
- Constitution Principle II: shared types live in
  `packages/shared`; producers and consumers import the same Zod
  schema.
- Constitution Principle VII: schema changes between phase
  deliverables must be coordinated.
- Validating before write prevents drift between the runtime
  contract and the on-disk contract.

**Alternatives considered**:
- Cosmetic-only frontmatter (no schema validation): rejected.
  Constitution II.
- Crawler-private schemas: rejected. Constitution II.

**Implementation notes**:
- If the existing `packages/shared/src/schemas/frontmatter.ts` does
  not have `alternate_urls`, the Phase 1 work adds it.
- The validation step runs at write time; failures throw with a
  message naming the offending field. This catches Crawler bugs
  before they propagate to Phase 2.

## R11. Test Strategy & Fixtures

**Decision**: Use the existing `packages/crawler/test-site/`
fixture as the binding integration test corpus. Each new lib module
gets a unit test (Vitest) before implementation. End-to-end
"crawl test-site → diff against snapshot" tests live under
`packages/crawler/test/` (or `src/lib/*.test.ts` co-located).

**Rationale**:
- Constitution Principle III mandates tests-before-implementation.
- §12.4 names `test-site/` as a binding fixture.
- Snapshot diffing under `--deterministic` mode is the spec's
  validation method (§12.6 done-when).

**Implementation notes**:
- The end-to-end test runs the full crawler against `test-site/`,
  writes to a temp dir, reads back the output, and asserts:
  - Each markdown file has valid frontmatter (Zod parse passes).
  - Manifest is valid (Zod parse passes).
  - File set matches expected list.
  - Re-running produces byte-identical output.
- Robots-compliance and sitemap tests can use HTTP fixtures via
  `vitest`'s built-in mocking or by adding stub HTML files to
  `test-site/`.

## Constitution Cross-Reference Summary

Every Crawler research decision has been validated against the
Lex Bot Constitution v1.0.0:

| Constitution element | Crawler decision | Aligned |
|---|---|---|
| I (MVP-First) | Every decision cites §3, §5, §9, or §12.6 | ✅ |
| II (Type Safety) | Frontmatter & manifest Zod schemas in `packages/shared`; config-file Zod parsing | ✅ |
| III (TDD layered) | Existing extractor/markdown/utils tests; new modules test-first | ✅ |
| IV (Serverless / Stateless) | Carve-out for Playwright (CLI-only, not Netlify-deployed) documented in plan.md and R1 | ✅ |
| V (Privilege / Privacy) | robots.txt + --exclude prevent admin/private pages from leaking into context store | ✅ |
| VI (Observable Agent) | Crawler emits to Foundation logger; redaction-clean (no API keys, no session secrets in scope) | ✅ |
| VII (Phased Delivery) | Frontmatter + manifest schema changes (R10) treated as coordinated cross-phase changes | ✅ |
| Required Stack | All decisions stay inside §9.9 / Constitution Required Stack | ✅ |
| Architectural Limits | --max-pages default 100; ~2000-word file cap enforced by R6 | ✅ |

## Open Questions — None

All research decisions resolve cleanly against the source spec and
the constitution. No `NEEDS CLARIFICATION` markers remain. Ready to
proceed to Phase 1.
