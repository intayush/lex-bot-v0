# Data Model: Crawler CLI

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

The Crawler is a file-emitting CLI. It introduces no database
entities. Its "data model" is the **on-disk artifact schema** it
produces and the **input artifact schema** it accepts. These
schemas are the integration contract between Phase 1 (this feature)
and Phase 2 (`003-context-search`).

## Output Artifacts

The Crawler writes to `<outputDir>` (default `./chatbot-context/`):

```text
<outputDir>/
├── _manifest.json           # ONE per crawl run
└── pages/
    ├── <slug>.md            # ONE per logical page (post-dedup, post-split)
    └── ...
```

## Entity 1: Crawled Page Markdown File

A single markdown file representing one logical unit of website
content. Source-spec definition: §3.10 (location/naming) + §3.11
(frontmatter schema) + §5.7 (size cap).

### Filename rule

- Path under `<outputDir>/pages/`.
- Slug derived from the URL path with `/` replaced by `--`
  (§3.10). Example: `https://firm.com/practice-areas/family-law` →
  `practice-areas--family-law.md`.
- For pages split by R6 (>2000 words), the slug gains a section
  suffix: `<original-slug>--<heading-slug>.md`.
- For dedup-consolidated pages (R4), only the canonical URL's slug
  is written; alternates are recorded in frontmatter.

### Body shape

```markdown
---
<frontmatter YAML>
---

# Heading

Markdown body produced by the unified→rehype-parse→rehype-remark→
remark-stringify pipeline.
```

### Frontmatter fields (Zod-validated)

| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| `title` | string | yes | §3.11 | From `<title>` or first `<h1>`, or "Untitled" fallback |
| `source_url` | string (URL) | yes | §3.11 | Canonical URL of the page |
| `crawled_at` | string (ISO 8601) | yes | §3.11 | Run timestamp; deterministic literal under `--deterministic` |
| `word_count` | integer | yes | §3.11 | Word count of the markdown body (post-conversion) |
| `section_type` | enum | yes | §3.11 | One of: `practice-area`, `attorney-bio`, `faq`, `blog-post`, `contact`, `about`, `general` |
| `content_hash` | string (hex) | yes | §3.11 | SHA-256 of the markdown body (truncated for display in §3.11 example) |
| `alternate_urls` | string[] | optional | R4 (dedup) | URLs that consolidated into this canonical (only when dedup'd) |

The Zod schema lives at
`packages/shared/src/schemas/frontmatter.ts`. The `alternate_urls`
field is an OPTIONAL extension added by this feature (R10).

### Size constraint

Body word count ≤ ~2000 (§5.7). The splitter (R6) enforces this
pre-emission.

### Lifecycle

- Created on first crawl that includes the page.
- Overwritten on incremental re-crawl when `content_hash` changes
  (R5).
- Deleted on incremental re-crawl when the page disappears from the
  source site (R5).
- The Crawler is the **only writer** of files in `<outputDir>/pages/`
  per §5.10.

## Entity 2: Context Store Manifest

A single JSON index file at `<outputDir>/_manifest.json`. Source-spec
definition: §5.5.

### Top-level shape

| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| `version` | integer | yes | §5.5 | Schema version; MVP = `1` |
| `generated_at` | string (ISO 8601) | yes | §5.5 | Deterministic literal under `--deterministic` |
| `base_url` | string (URL) | yes | §5.5 | The HTTPS base URL where this context store will be served (e.g., `https://example-lawfirm.com/chatbot-context/`) |
| `files` | object[] | yes | §5.5 | One entry per markdown file under `pages/` |

### Per-file entry shape

| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| `path` | string | yes | §5.5 | Relative path under `<outputDir>` (e.g., `pages/practice-areas--family-law.md`) |
| `title` | string | yes | §5.5 | Mirror of frontmatter `title` |
| `section_type` | enum | yes | §5.5 + §3.11 | Mirror of frontmatter `section_type` |
| `word_count` | integer | yes | §5.5 | Mirror of frontmatter `word_count` |
| `content_hash` | string (hex) | yes | §5.5 | Mirror of frontmatter `content_hash` |
| `keywords` | string[] | yes | §5.5 | Auto-extracted by `utils/keywords.ts` for fast relevance matching |

The Zod schema lives at
`packages/shared/src/schemas/manifest.ts`.

### Ordering

Under `--deterministic`, `files` array is sorted by `path`
(lexicographic) so re-runs produce byte-identical output (R9). In
non-deterministic mode, ordering is insertion-order (BFS discovery).

### Lifecycle

- Created on first crawl.
- Regenerated on every subsequent crawl per §5.9 ("`_manifest.json`
  is regenerated as the single source of truth").
- The Crawler is the **only writer** per §5.10. Phase 2 (Context
  Search Agent) is the only reader.

## Entity 3: .crawlerrc.json Configuration File (input)

Optional configuration consumed by the Crawler. Source-spec
definition: §3.4. Implementation: R3.

### Shape (Zod-validated)

```jsonc
{
  "exclude": ["/admin/*", "/login"],     // optional; URL glob patterns
  "selectors": {                          // optional; CSS selectors
    "content": "article.main-content",
    "title": "h1.page-title"
  },
  "maxDepth": 3                           // optional; integer ≥ 1
}
```

### Validation rules

- `exclude` items are strings; glob-pattern syntax (per §3.3
  `--exclude` flag).
- `selectors.content` and `selectors.title` are CSS selector strings;
  malformed selectors are caught at parse time by `cheerio` when
  applied.
- `maxDepth` is a positive integer.
- Unknown top-level keys produce a warning (via Foundation logger)
  but do not abort the crawl (forward compat).

### Resolution order

1. `--config <path>` (CLI flag, R8) — if explicit, file MUST exist.
2. `.crawlerrc.json` in `process.cwd()` — if missing, no config (use defaults).

### Merging with CLI flags

| Field | Merge strategy |
|---|---|
| `exclude` | UNION of CLI `--exclude` repeats and config-file `exclude` array |
| `selectors` | Config-file only (no CLI flag for selectors) |
| `maxDepth` | Config-file only (no CLI flag for depth; `--max-pages` is a separate cap) |

## Entity 4: robots.txt (input, runtime)

Read by the Crawler before fetching begins. Not persisted to disk.
Source-spec definition: §3.6.

### Parsed shape

```ts
type RobotsRules = {
  disallow: string[];           // path prefixes/globs to skip
  allow: string[];              // path prefixes/globs to allow (if explicit)
  sitemaps: string[];           // URLs from `Sitemap:` directives
  crawlDelay?: number;          // seconds, if `Crawl-Delay:` is set
};
```

### Resolution

- Fetched from `<rootOrigin>/robots.txt` once per crawl run.
- Fetch failure (404, network error) → `disallow` empty, `sitemaps`
  empty (no restrictions; standard convention).

### Lifecycle

In-memory only; recomputed on every crawl run.

## Entity 5: sitemap.xml (input, runtime)

Read by the Crawler if reachable. Not persisted to disk. Source-spec
definition: §3.6, §3.7.

### Parsed shape

```ts
type Sitemap = {
  urls: string[];               // <loc> entries from <urlset>
  childSitemaps: string[];      // <loc> entries from <sitemapindex>
};
```

### Resolution

- Fetched from each URL in `RobotsRules.sitemaps` plus the default
  `<rootOrigin>/sitemap.xml`.
- Sitemap-index files are followed one level deep (their child
  sitemaps are fetched but their grandchildren are not — bound on
  recursion).

### Lifecycle

In-memory only.

## Validation Pipeline (write-side)

Every artifact is validated before write. Constitution Principle II
demands cross-boundary Zod validation; the Crawler treats the
filesystem-write boundary as a cross-boundary.

```text
HTML in
    └─→ extractContent (cheerio + selectors)
          └─→ dedup (R4)
                └─→ splitter (R6 — if >2000 words)
                      └─→ toMarkdown (unified)
                            └─→ validate frontmatter (Zod)
                                  └─→ write file
                                        └─→ accumulate manifest entry

after all pages:
    validate manifest (Zod) → write _manifest.json
```

A validation failure throws before any file write — preventing
malformed output from reaching the context store.

## State Transitions

The Crawler is **stateless across runs** in memory. Persistent state
lives entirely in the `<outputDir>` filesystem, in two forms:

- The set of markdown files under `pages/`.
- The `_manifest.json` index.

The incremental crawl (R5) reads the existing manifest as the prior
state, computes the new state, and writes both states to disk
atomically (manifest written last so an interrupted crawl leaves
the prior manifest intact).

```text
Run 1:  ∅                    ──crawl──▶  pages/{a,b,c}.md + _manifest.json[a,b,c]
Run 2:  pages/{a,b,c}.md     ──crawl──▶  pages/{a,b,d}.md + _manifest.json[a,b,d]
                                          (b unchanged, c removed, d added)
```

## Schema Coordination With Phase 2

Phase 2 (`003-context-search`) reads `_manifest.json` and
per-file markdown frontmatter via the same Zod schemas in
`packages/shared/src/schemas/`. Any schema change here is a
cross-phase coordinated change. The optional `alternate_urls`
frontmatter field added by R4 is forward-compatible: Phase 2 can
ignore it without breaking, and only adopt it later if the
relevance-scoring algorithm benefits from cross-URL deduplication.

