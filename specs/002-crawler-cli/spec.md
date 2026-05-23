# Feature Specification: Crawler CLI

**Feature Branch**: `002-crawler-cli`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "Extract the functional requirements for Crawler CLI from 'product-spec-legal-chatbot.md'. Generate the isolated feature specification file. Do not invent new requirements; stick strictly to what is outlined in the document."

**Source of Truth**: All requirements in this document are extracted verbatim or paraphrased without addition from `product-spec-legal-chatbot.md` (v0.2, 2026-05-16). The primary sources are §3.1–§3.12 (the Crawler component), with cross-references to §5.5 (manifest schema), §5.7 (file size constraints), §5.8 (naming conventions), §5.9 (merge strategy), §5.10 (read-only at runtime), §9.4 (Playwright rationale), §9.9 (libraries), and §12.6 (phase deliverable). Each functional requirement cites its source section. No requirements have been invented.

## Overview

The Crawler CLI is a command-line tool that crawls a law firm's website and produces structured markdown files which serve as the chatbot's knowledge base (§3.1). It runs locally on a developer's machine or as a CI pipeline step, not as a hosted service (§3.2). It is the only mechanism by which page content enters the context store; the API server never writes to it (§5.10).

This is the first build phase per §12.5. It produces working, demonstrable output before any other component is built, and its output is the input contract for Phase 2 (Context Search Agent).

## User Scenarios & Testing *(mandatory)*

The Crawler CLI has two primary users:

1. **A lawyer (or their developer)** running the crawler against their live website to refresh the chatbot's knowledge base.
2. **A Lex Bot engineer** running the crawler against the local test site or against a real firm's site to generate fixtures and verify the pipeline.

### User Story 1 — Lawyer Generates Initial Context From Their Website (Priority: P1)

A lawyer (or their developer) installs and runs the crawler against their public website's root URL. The crawler discovers reachable pages within the same domain, renders each page (using a headless browser when needed), strips navigation and chrome, converts the meaningful content into markdown with YAML frontmatter, and writes the result to a local output directory along with a `_manifest.json` that indexes every page.

**Why this priority**: §3.1 names the Crawler the "primary mechanism for giving the chatbot relevant, firm-specific context." Without it, the agent has nothing firm-specific to ground responses in. §12.5 places it as Phase 1 — every later phase depends on its output format.

**Independent Test**: Run the crawler against a known multi-page website (the seeded test site or a real firm site) and verify that the output directory contains a `pages/` subdirectory with markdown files, that each file carries valid YAML frontmatter, and that `_manifest.json` lists every page produced.

**Acceptance Scenarios**:

1. **Given** a public website root URL, **When** the lawyer runs the crawler with `--url <root>` and `--output ./chatbot-context/`, **Then** the crawler produces markdown files under `./chatbot-context/pages/` and a `_manifest.json` at `./chatbot-context/_manifest.json` (§3.10).
2. **Given** a website that mixes static and JS-rendered pages, **When** the crawler runs, **Then** static pages are processed via simple HTTP fetch and JS-rendered pages are re-fetched via the headless browser (§3.5).
3. **Given** a website with internal and external links, **When** the crawler runs, **Then** only pages within the same domain as the root URL are crawled and external links, third-party resources, and subdomains are ignored (§3.6).
4. **Given** a website with a `robots.txt`, **When** the crawler runs, **Then** the directives in `robots.txt` are respected (§3.6).
5. **Given** a website with a `sitemap.xml`, **When** the crawler runs, **Then** the sitemap is used as an additional source for page discovery (§3.6, §3.7).
6. **Given** a page with navigation, footer, sidebar, ads, cookie banners, scripts, and styles, **When** content is extracted, **Then** only the meaningful page content (headings, paragraphs, lists, tables, structured data) is retained in the markdown (§3.8).
7. **Given** a successful crawl, **When** any output markdown file is opened, **Then** it begins with YAML frontmatter containing `title`, `source_url`, `crawled_at`, `word_count`, `section_type`, and `content_hash` (§3.11).

---

### User Story 2 — Engineer Runs the Crawler Against Local HTML Fixtures (Priority: P1)

A Lex Bot engineer developing or testing the crawler points it at a local directory of HTML files instead of a live URL. The crawler treats the local directory as the input and produces the same markdown + manifest output as it would for a live site.

**Why this priority**: §3.3 explicitly defines the `--input` flag as an alternative to `--url` "for dev/testing." §12.6 lists the local-input invocation as a deliverable: `npx legal-chatbot-crawl --input ./test-site/ --output ./chatbot-context/`. Without this, fast deterministic unit testing of the crawler against fixed fixtures is impossible.

**Independent Test**: Run the crawler with `--input ./test-site/ --output ./out/`, then verify that `./out/pages/` contains one markdown file per HTML file in the fixture and that the manifest is generated.

**Acceptance Scenarios**:

1. **Given** a local directory containing HTML files, **When** the crawler runs with `--input` instead of `--url`, **Then** the local files are processed and produce the same output structure as a live crawl (§3.3 input/options table, §12.6 deliverable).

---

### User Story 3 — Lawyer Refreshes Existing Context Without Unnecessary Churn (Priority: P1)

A lawyer who has previously crawled their site re-runs the crawler. The crawler reads the existing `_manifest.json`, computes content hashes for the latest version of each page, and only overwrites markdown files whose content has changed; new pages are added, removed pages are deleted, and the manifest is regenerated.

**Why this priority**: §3.12 specifies incremental crawling explicitly: "This keeps crawl times short for routine updates and avoids unnecessary file churn." Without incremental behavior, every refresh would invalidate every cached file downstream and create noise in version control.

**Independent Test**: Crawl a site, modify one page, re-crawl, and observe that only the modified markdown file's mtime/content has changed and that `_manifest.json` reflects the updated `content_hash` for that file.

**Acceptance Scenarios**:

1. **Given** a previous crawl exists at the output path, **When** the crawler re-runs, **Then** it reads the existing `_manifest.json` and computes content hashes for the latest pages (§3.12 step 1–2).
2. **Given** a page whose content has not changed since the last crawl, **When** the crawler re-runs, **Then** the corresponding markdown file is not overwritten (§3.12 step 3).
3. **Given** a page that no longer exists on the website, **When** the crawler re-runs, **Then** the corresponding markdown file is removed from the output (§3.12 step 4).
4. **Given** a brand-new page on the website, **When** the crawler re-runs, **Then** a new markdown file is added (§3.12 step 4).
5. **Given** any incremental run, **When** the crawler completes, **Then** `_manifest.json` is regenerated to reflect the current state (§3.12 step 5, §5.9).

---

### User Story 4 — Engineer Produces Reproducible Output for Tests (Priority: P2)

An engineer running the crawler in a CI test or fixture-generation step uses the `--deterministic` flag. The crawler emits fixed timestamps so that re-running on identical input produces byte-identical output, enabling diff-based testing.

**Why this priority**: §3.3 lists `--deterministic` with description "Use fixed timestamps for reproducible output." §12.6 "Done when" includes "Re-running produces identical output (deterministic)" as a phase exit criterion. Without it, snapshot-style testing is impossible because `crawled_at` would change on every run.

**Independent Test**: Run the crawler twice with `--deterministic` against the same input and verify that every file in the output (including `_manifest.json`) is byte-identical between runs.

**Acceptance Scenarios**:

1. **Given** identical input, **When** the crawler runs twice with `--deterministic`, **Then** every output file is byte-identical between the two runs (§3.3, §12.6 done-when).

---

### User Story 5 — Lawyer Customizes Crawl via Config File (Priority: P2)

A lawyer or their developer creates a `.crawlerrc.json` configuration file that specifies URL exclusion patterns (e.g., `/admin/*`, `/login`), custom selectors for content extraction, and a maximum crawl depth. The crawler reads this file at startup and applies the rules.

**Why this priority**: §3.3 lists `--config` (default `.crawlerrc.json`) and §3.4 enumerates the three config-file responsibilities (URL exclusion patterns, custom selectors, max crawl depth). This is required by the spec but is supplementary to the basic crawl flow.

**Independent Test**: Place a `.crawlerrc.json` in the working directory excluding a known URL pattern, run the crawler, and verify that pages matching the excluded pattern do not appear in the output.

**Acceptance Scenarios**:

1. **Given** a `.crawlerrc.json` listing URL exclusion patterns, **When** the crawler runs, **Then** URLs matching those patterns are not crawled (§3.4).
2. **Given** a `--exclude` flag with a glob pattern, **When** the crawler runs, **Then** URLs matching that glob are skipped (§3.3 options table).
3. **Given** a `.crawlerrc.json` with custom selectors, **When** the crawler extracts content, **Then** the custom selectors are used (§3.4).
4. **Given** a `.crawlerrc.json` with max crawl depth, **When** the crawler runs, **Then** the crawl does not exceed that depth (§3.4).

---

### Edge Cases

- **Unreachable root URL**: §3 does not specify behavior for a fully unreachable root. The crawler's failure mode for connection failures is not enumerated by the spec; this falls back to standard CLI conventions (non-zero exit + stderr) and is captured in Assumptions.
- **Page-count budget reached**: §3.7 says "Respects `max-pages` limit to prevent runaway crawls on large sites" and §3.3 sets the default to 100. When the limit is reached, remaining pages are not crawled.
- **Duplicate / near-duplicate pages**: §3.9 requires the crawler to compute content hashes, detect duplicates, and consolidate them into a single markdown file with a note referencing the alternate URLs.
- **Page exceeds 2000-word cap**: §5.7 requires that pages exceeding ~2000 words be split into logical sections by heading (e.g., a long FAQ becomes `faq--general.md`, `faq--personal-injury.md`). The Crawler is the only writer for `pages/` (§5.10), so it owns this splitting.
- **Page with mostly empty body / JS bootstrap markers**: §3.5 auto-detection rule says: if HTML body is mostly empty or contains JS bootstrap markers like `<div id="root"></div>` with no children, re-fetch via Playwright; otherwise proceed with static HTML.
- **Path with slashes in URL**: §3.10 requires path separators (`/`) in URL paths to be converted to double dashes (`--`) when forming the markdown filename.
- **`--url` and `--input` both omitted**: §3.3 marks `--url` as "Required (unless `--input`)." Therefore at least one of the two must be supplied; absence of both is a usage error.

## Requirements *(mandatory)*

Each requirement cites the spec section it derives from. No requirement appears here that is not present in `product-spec-legal-chatbot.md`.

### Functional Requirements

#### FR Group A — Distribution & Execution Model (§3.1, §3.2, §12.6)

- **FR-001**: The Crawler MUST be a command-line tool. Source: §3.1 ("A CLI tool that crawls a lawyer's website").
- **FR-002**: The Crawler MUST be invokable via `npx` with the package name `legal-chatbot-crawl`. Source: §3.3 (`npx legal-chatbot-crawl …`) and §12.6 deliverable.
- **FR-003**: The Crawler MUST be runnable locally on the lawyer's machine, the developer's machine, or as a CI pipeline step. Source: §3.2.
- **FR-004**: The Crawler MUST NOT require any hosted service to function and MUST NOT carry ongoing infrastructure cost for crawling. Source: §3.2 ("Not a hosted service — no ongoing infrastructure cost for crawling").
- **FR-005**: The Crawler MUST be re-runnable on demand and schedulable via cron or CI. Source: §3.2.

#### FR Group B — CLI Interface (§3.3)

- **FR-006**: The Crawler MUST accept a `--url` flag whose value is the root URL to crawl on a live website. Required unless `--input` is provided. Source: §3.3 options table.
- **FR-007**: The Crawler MUST accept a `--input` flag whose value is a local directory of HTML files, used as an alternative to `--url` for dev/testing. Source: §3.3 options table.
- **FR-008**: The Crawler MUST accept a `--output` flag whose value is the output directory for markdown files; default `./chatbot-context/`. Source: §3.3 options table.
- **FR-009**: The Crawler MUST accept a `--exclude` flag whose value is one or more glob patterns for URLs to skip; default none. Source: §3.3 options table.
- **FR-010**: The Crawler MUST accept a `--max-pages` flag whose value is the maximum number of pages to crawl; default 100. Source: §3.3 options table.
- **FR-011**: The Crawler MUST accept a `--deterministic` flag (boolean) which, when set, causes fixed timestamps to be emitted for reproducible output; default `false`. Source: §3.3 options table.
- **FR-012**: The Crawler MUST accept a `--config` flag whose value is the path to an optional configuration file; default `.crawlerrc.json`. Source: §3.3 options table.
- **FR-013**: The Crawler MUST treat omission of both `--url` and `--input` as a usage error. Source: §3.3 (`--url` "Required (unless `--input`)").

#### FR Group C — Configuration File (§3.4)

- **FR-014**: When a configuration file is present, the Crawler MUST honor URL exclusion patterns defined in it (e.g., `/admin/*`, `/login`). Source: §3.4.
- **FR-015**: When a configuration file is present, the Crawler MUST honor custom selectors defined in it for content extraction. Source: §3.4.
- **FR-016**: When a configuration file is present, the Crawler MUST honor a maximum crawl depth defined in it. Source: §3.4.

#### FR Group D — Rendering Strategy (§3.5, §9.4, §12.6)

- **FR-017**: The Crawler MUST support client-side-rendered pages by using a headless browser to render JavaScript-heavy pages before content extraction. Headless rendering targets SPAs, React-rendered pages, and dynamically loaded content. Source: §3.5 ("Client-Side Rendering Support") and §9.4 (Playwright rationale: "Chromium, Firefox, WebKit", "Auto-wait, less flakiness").
- **FR-018**: The Crawler MUST support server-side / static pages by falling back to a simple HTTP fetch + HTML parse when JS execution is not required. Source: §3.5 ("Server-Side Rendering Support") and §12.6 build note ("cheerio for static, Playwright for JS-rendered").
- **FR-019**: The Crawler MUST automatically detect whether a page requires JS rendering by: (1) fetching the page via HTTP first; (2) if the HTML body is mostly empty or contains JS bootstrap markers (e.g., `<div id="root"></div>` with no children), re-fetching using the headless browser; (3) otherwise proceeding with the static HTML. Source: §3.5 ("Auto-Detection") steps 1–3.

#### FR Group E — Scope, Discovery, and Traversal (§3.6, §3.7)

- **FR-020**: The Crawler MUST only crawl pages within the same domain as the root URL. Source: §3.6.
- **FR-021**: The Crawler MUST ignore external links, third-party resources, and subdomains. Source: §3.6.
- **FR-022**: The Crawler MUST respect `robots.txt` directives. Source: §3.6.
- **FR-023**: The Crawler MUST use `sitemap.xml` (when available) as an additional source for page discovery. Source: §3.6, §3.7.
- **FR-024**: The Crawler MUST follow internal links (`<a href>`) to discover all reachable pages. Source: §3.7.
- **FR-025**: The Crawler MUST parse `sitemap.xml` for additional URLs not linked in navigation. Source: §3.7.
- **FR-026**: The Crawler MUST respect the `--max-pages` limit to prevent runaway crawls on large sites. Source: §3.7.

#### FR Group F — Content Extraction (§3.8)

- **FR-027**: The Crawler MUST extract: headings (h1–h6), paragraphs and body text, ordered and unordered lists, tables, and structured data (practice areas, attorney bios, contact info). Source: §3.8 "Extracted" list.
- **FR-028**: The Crawler MUST strip from extracted content: navigation menus and headers, footers, sidebars and ads, cookie banners and modals, and script and style tags. Source: §3.8 "Stripped" list.

#### FR Group G — Deduplication (§3.9)

- **FR-029**: The Crawler MUST compute a content hash for each page. Source: §3.9.
- **FR-030**: The Crawler MUST detect duplicate and near-duplicate pages such as paginated listings and print versions. Source: §3.9.
- **FR-031**: The Crawler MUST consolidate detected duplicates into a single markdown file that contains a note referencing the alternate URLs. Source: §3.9.

#### FR Group H — Output Structure & Naming (§3.10, §5.7, §5.8)

- **FR-032**: The Crawler MUST place its `_manifest.json` at the root of the output directory. Source: §3.10.
- **FR-033**: The Crawler MUST place all per-page markdown files inside a `pages/` subdirectory of the output directory. Source: §3.10.
- **FR-034**: The Crawler MUST derive markdown filenames from the URL path, converting path separators (`/`) to double dashes (`--`). Source: §3.10.
- **FR-035**: The Crawler MUST cap individual markdown files at approximately 2000 words. Source: §5.7.
- **FR-036**: The Crawler MUST split pages exceeding the 2000-word cap into logical sections by heading (e.g., a long FAQ page becomes `faq--general.md`, `faq--personal-injury.md`, etc.). Source: §5.7.
- **FR-037**: The Crawler MUST follow the predictable filename patterns enumerated in §5.8 so the agent can infer relevance from filenames alone: `practice-areas--*.md` for practice area descriptions, `attorneys--*.md` for attorney bios, `faq*.md` for FAQs, `blog--*.md` for blog posts, `contact.md` for contact info, `about.md` for the firm overview. Source: §5.8 naming-convention table.

#### FR Group I — Frontmatter Schema (§3.11)

- **FR-038**: Every markdown file produced by the Crawler MUST begin with YAML frontmatter containing the fields: `title`, `source_url`, `crawled_at`, `word_count`, `section_type`, `content_hash`. Source: §3.11 frontmatter example and §12.6 done-when (which lists the same fields except `content_hash`, but §3.11 includes `content_hash`).
- **FR-039**: The `section_type` field MUST take one of the following values: `practice-area`, `attorney-bio`, `faq`, `blog-post`, `contact`, `about`, `general`. Source: §3.11.
- **FR-040**: The Crawler MUST infer `section_type` from URL patterns and page content heuristics. Source: §3.11.
- **FR-041**: The `crawled_at` value MUST be in ISO-8601 format ("2026-05-09T14:30:00Z" pattern shown in §3.11 example). Source: §3.11 example.

#### FR Group J — Manifest Generation (§5.5)

- **FR-042**: The Crawler MUST generate `_manifest.json` at the output directory root containing the fields: `version`, `generated_at`, `base_url`, and `files` (an array). Source: §5.5 example JSON.
- **FR-043**: Each entry in `_manifest.json`'s `files` array MUST contain: `path`, `title`, `section_type`, `word_count`, `content_hash`, `keywords`. Source: §5.5 example JSON.
- **FR-044**: The `path` field for each manifest entry MUST be the relative path of the markdown file under the output directory (e.g., `pages/practice-areas--family-law.md`). Source: §5.5 example.
- **FR-045**: The `keywords` field for each manifest entry MUST be auto-extracted during crawling so the agent can perform fast relevance matching without opening every file. Source: §5.5 closing paragraph ("The `keywords` field is auto-extracted during crawling to enable fast relevance matching without opening every file").

#### FR Group K — Incremental Crawling (§3.12, §5.9)

- **FR-046**: On a subsequent run, the Crawler MUST read the existing `_manifest.json` from the output directory. Source: §3.12 step 1.
- **FR-047**: On a subsequent run, the Crawler MUST fetch pages and compute new content hashes. Source: §3.12 step 2.
- **FR-048**: On a subsequent run, the Crawler MUST overwrite only those markdown files whose content has changed since the previous run. Source: §3.12 step 3.
- **FR-049**: On a subsequent run, the Crawler MUST add new markdown files for newly discovered pages. Source: §3.12 step 4.
- **FR-050**: On a subsequent run, the Crawler MUST remove markdown files corresponding to pages that no longer exist on the website. Source: §3.12 step 4, §5.9.
- **FR-051**: On a subsequent run, the Crawler MUST regenerate `_manifest.json` to reflect the current state. Source: §3.12 step 5, §5.9 ("`_manifest.json` is regenerated as the single source of truth").

#### FR Group L — Determinism & Reproducibility (§3.3, §12.6)

- **FR-052**: When `--deterministic` is set, the Crawler MUST emit fixed timestamps so re-running on identical input produces byte-identical output. Source: §3.3 (`--deterministic` description) and §12.6 done-when ("Re-running produces identical output (deterministic)").

#### FR Group M — Read-Only Boundary with Other Components (§5.10)

- **FR-053**: The Crawler is the only component permitted to add, update, or remove `pages/` files and `_manifest.json` in the context store. The chatbot and API server MUST never write to the context store, and the Dashboard publish action is the only other writer (and it owns `_guardrails.md` and `config/`, not `pages/` or `_manifest.json`). Source: §5.10.

### Key Entities

The Crawler produces, but does not invent, two kinds of artifacts. Each is a file format with a fixed schema defined by the source spec.

- **Crawled Page Markdown File**: A single markdown file representing one logical unit of website content. Resides under `pages/`. Begins with YAML frontmatter (§3.11) and contains the body text after the frontmatter delimiter. Filename derived from the URL path with `/` replaced by `--`. Capped at ~2000 words; over-cap pages are split by heading. Source: §3.10, §3.11, §5.7, §5.8.
- **Context Store Manifest**: A single JSON file (`_manifest.json`) at the root of the output directory. Contains a `version`, a `generated_at` timestamp, a `base_url`, and a `files` array where each entry has `path`, `title`, `section_type`, `word_count`, `content_hash`, and auto-extracted `keywords`. Source: §5.5.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running the Crawler against the seeded test React app produces markdown files inside `./chatbot-context/pages/` and a `_manifest.json` at `./chatbot-context/_manifest.json`. Source: §12.6 done-when.
- **SC-002**: 100% of markdown files produced by the Crawler begin with valid YAML frontmatter containing `title`, `source_url`, `crawled_at`, `word_count`, `section_type`, and `content_hash`. Source: §3.11, §12.6 done-when.
- **SC-003**: The generated `_manifest.json` lists every page produced by the run, with the correct file count and a `keywords` value for each entry. Source: §12.6 done-when.
- **SC-004**: Two consecutive runs of the Crawler with `--deterministic` against identical input produce byte-identical output for every file in the output directory, including `_manifest.json`. Source: §12.6 done-when, §3.3.
- **SC-005**: Running the Crawler against a website containing both static-HTML and JS-rendered pages produces extracted content for both kinds of pages, with no manual intervention to switch rendering modes. Source: §3.5.
- **SC-006**: Running the Crawler against a website that links to external sites produces no markdown files for external URLs, third-party resources, or subdomains. Source: §3.6.
- **SC-007**: Running the Crawler against a site whose `robots.txt` disallows a path produces no markdown files for that path. Source: §3.6.
- **SC-008**: A second run of the Crawler against an unchanged site does not modify any file in the output directory other than possibly `_manifest.json` if its `generated_at` timestamp updates (i.e., page markdown files are not rewritten). Source: §3.12, §5.9.
- **SC-009**: A second run of the Crawler after a single page on the source site changes overwrites exactly that one markdown file (plus the manifest). Source: §3.12.
- **SC-010**: A second run of the Crawler after a page is removed from the source site results in the corresponding markdown file being deleted from `pages/`. Source: §3.12, §5.9.
- **SC-011**: A second run of the Crawler after a brand-new page is added to the source site results in a new markdown file being created in `pages/`. Source: §3.12.
- **SC-012**: A page longer than ~2000 words on the source site is split into multiple markdown files by heading (e.g., `faq--general.md`, `faq--personal-injury.md`). Source: §5.7.
- **SC-013**: A practice-area page on the source site produces a markdown file whose name matches the `practice-areas--*.md` pattern. Source: §5.8.
- **SC-014**: An attorney-bio page on the source site produces a markdown file whose name matches the `attorneys--*.md` pattern. Source: §5.8.
- **SC-015**: A run that hits the `--max-pages` limit (default 100) terminates without crawling additional pages. Source: §3.3, §3.7.
- **SC-016**: A page detected as a duplicate or near-duplicate of another page does not produce a separate markdown file; instead the consolidated markdown contains a note referencing the alternate URL(s). Source: §3.9.

## Assumptions

These are reasonable defaults adopted where the spec does not explicitly prescribe a detail. Each is consistent with — and never contradicts — the spec.

- **Standard CLI exit conventions**: §3 does not enumerate exit codes for failure modes (unreachable URL, malformed config file, etc.). Standard CLI conventions (zero on success, non-zero on failure, structured error messages on stderr) are assumed. The product spec does not require a specific error format.
- **Concurrency strategy**: §9.9 lists `p-limit` for "Concurrency control for parallel page fetches (crawler)." The Crawler is therefore expected to fetch pages in parallel under a configurable concurrency limit. The spec does not state an explicit default concurrency value; an implementer-chosen sensible default is acceptable.
- **Hash function family**: §3.9 requires "content hash" but does not specify the algorithm. Any cryptographic-strength hash with sufficiently low collision probability (e.g., SHA-256) is acceptable. The frontmatter example shows a truncated hex string ("a3f2b8c1...") that is consistent with this.
- **Keyword extraction technique**: §5.5 says keywords are "auto-extracted during crawling" but does not specify the technique. Any deterministic extraction (e.g., TF-IDF, RAKE, frequency-based with stopword filtering) is acceptable, provided the same input produces the same keyword set under `--deterministic`.
- **Sitemap discovery path**: §3.6/§3.7 say sitemaps are used "if available." Standard practice is to look for `/sitemap.xml` at the site root and to honor `Sitemap:` references in `robots.txt`. The spec does not enumerate alternative discovery paths.
- **Configuration file format**: §3.3 names the default config path as `.crawlerrc.json`. The `.json` extension implies JSON encoding. Other formats are not implied or required by the spec.
- **Local input directory layout**: §3.3 describes `--input` as "a local directory of HTML files." The spec does not specify how nested HTML files map to virtual URLs for filename generation; an implementer-chosen mapping (e.g., relative path) is acceptable as long as the resulting filenames satisfy §3.10 (path-separator-to-double-dash conversion) and the §5.8 naming patterns where applicable.

## Out of Scope (for this feature)

The following items are explicitly **not** part of the Crawler CLI feature, even though they are mentioned in adjacent spec sections.

- The `_guardrails.md` file and the `config/` files in the context store. §5.10 explicitly assigns these to the Dashboard publish action, not the Crawler.
- The `legal-chatbot-sync` CLI for syncing dashboard configuration to the context store. §4.7 places this on a separate CLI, not the Crawler.
- The agent's runtime use of the manifest (relevance scoring, two-pass retrieval, etc.). §7.6 places this in the Context Search Agent — a later phase.
- The API server's caching of the manifest and recently fetched markdown files. §5.2 places this on the API server.
- Authentication, hosting, or transport of the context store. §5.2 places these on the lawyer's infrastructure.
- Crawler scheduling automation (cron, CI workflows). §3.2 mentions these as deployment patterns; their wiring is a deployment concern (Phase 8 of the roadmap), not part of the Crawler tool itself.

## Dependencies

- **External**: For `--url` mode, public network access to the target website. The Crawler runs locally (§3.2) — no external SaaS dependency.
- **Internal**: The Foundation feature (`001-foundation`) MUST be in place: monorepo structure, TypeScript toolchain, shared types/Zod (used by the configuration schema and frontmatter validation), and CI pipeline. Source: §9.6 (Crawler is `packages/crawler` in the workspace), §12.5 (Phase 1 follows the foundational setup).
- **Downstream consumer**: Phase 2 (Context Search Agent) depends on the manifest schema in §5.5 and the frontmatter schema in §3.11. Any change to those schemas in a future amendment must be coordinated with that phase.

## Notes on Non-Invention

This specification deliberately omits any requirement not present in `product-spec-legal-chatbot.md`. In particular:

- No specific HTML-to-markdown library is named here as a requirement; the spec mentions `unified` / `rehype` / `remark` (§9.9) and `cheerio` (§9.9, §12.6) as the supporting libraries. Library selection is an implementation matter.
- No explicit user-agent string, request rate, or politeness delay is required by the spec. `robots.txt` compliance (§3.6) and `--max-pages` (§3.3) are the only stated rate-limiting controls.
- No CLI help/version flag conventions are specified beyond the standard Node CLI ecosystem norms.
- No specific exit code mapping (e.g., 1 for usage error, 2 for network failure) is specified.
- No JSON-output mode for machine-readable progress reporting is specified.
- No internationalization or non-English content handling is specified.
- No image, PDF, or non-HTML asset handling is specified — the Crawler operates on HTML pages only (§3.5, §3.8).

If any of these are wanted, they belong in a separate feature, not in Crawler CLI.
