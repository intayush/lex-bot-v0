# Quickstart: Crawler CLI

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This quickstart shows the operator (lawyer or developer) experience
after the Crawler CLI feature is fully implemented. It validates the
§12.6 done-when checklist and the Phase 1 deliverable.

## Prerequisites

- Node.js 20+ (LTS).
- For CSR-rendered sites: Playwright's bundled Chromium binary
  (downloaded automatically by `playwright`'s postinstall on first
  install). Approximately 150 MB.

No other dependencies required. The Crawler runs locally (§3.2).

## Install

Either via the published npm package (after Phase 8 deploys it):

```bash
npx legal-chatbot-crawl --help
```

Or from the monorepo (during development):

```bash
pnpm --filter @legal-chatbot/crawler build
node packages/crawler/dist/cli.js --help
```

## Crawl a live website

```bash
npx legal-chatbot-crawl \
  --url https://example-lawfirm.com \
  --output ./chatbot-context/
```

Expected outcomes:
- `./chatbot-context/pages/` directory created.
- One markdown file per crawled page, named per §3.10
  (`/practice-areas/family-law` → `practice-areas--family-law.md`).
- `./chatbot-context/_manifest.json` created with `version: 1`,
  `base_url`, and a `files` array.
- Each markdown file has valid YAML frontmatter (FR-038, §3.11).
- Each manifest entry has `keywords` extracted (FR-045, §5.5).
- External links and subdomains are NOT crawled (FR-020, FR-021).
- Pages disallowed by `robots.txt` are NOT crawled (FR-022).
- Pages discovered only via `sitemap.xml` ARE included (FR-023).

## Crawl local HTML files (dev/testing)

```bash
npx legal-chatbot-crawl \
  --input ./packages/crawler/test-site/ \
  --output ./out/
```

Expected outcomes match `--url` mode but read from local HTML
files rather than HTTP fetches (§3.3 `--input` flag).

## Crawl deterministically (snapshot tests, fixtures)

```bash
npx legal-chatbot-crawl \
  --input ./packages/crawler/test-site/ \
  --output ./out/ \
  --deterministic
```

Run twice in succession; expect byte-identical output:

```bash
diff -r ./out-run-1/ ./out-run-2/
# (no output → identical)
```

## Customize via .crawlerrc.json

Create `./.crawlerrc.json`:

```json
{
  "exclude": ["/admin/*", "/wp-admin/*", "/login"],
  "selectors": {
    "content": "main.article-body"
  },
  "maxDepth": 4
}
```

Then run:

```bash
npx legal-chatbot-crawl --url https://example-lawfirm.com --output ./chatbot-context/
```

Expected outcomes:
- URLs matching exclude patterns are skipped (FR-014).
- Content extracted via the custom selector (FR-015).
- BFS depth from root capped at 4 (FR-016).

## Re-crawl (incremental)

After the initial crawl, re-running:

```bash
npx legal-chatbot-crawl --url https://example-lawfirm.com --output ./chatbot-context/
```

Expected outcomes (R5 / FR-046–FR-051):
- Existing `_manifest.json` read.
- Pages whose `content_hash` is unchanged → markdown file untouched.
- Pages with changed content → markdown file overwritten.
- Pages no longer on the source site → markdown file deleted.
- New pages added.
- `_manifest.json` regenerated to reflect the current state.

## Apply additional URL exclusions ad-hoc

```bash
npx legal-chatbot-crawl \
  --url https://example-lawfirm.com \
  --output ./chatbot-context/ \
  --exclude "/legacy-blog/*" \
  --exclude "/career/*"
```

Repeated `--exclude` flags accumulate (FR-009).

## Cap the page count

```bash
npx legal-chatbot-crawl \
  --url https://very-large-firm.com \
  --output ./chatbot-context/ \
  --max-pages 50
```

Crawler stops after 50 pages even if the site has more (FR-026).

## Done-When (Spec FR Satisfaction Map)

| §12.6 done-when | Verification step |
|---|---|
| Markdown files in `./chatbot-context/pages/` | First crawl section above |
| Each file has valid YAML frontmatter | Inspect any output file: opens with `---`, contains `title`, `source_url`, `crawled_at`, `word_count`, `section_type`, `content_hash` |
| `_manifest.json` generated with correct file count and keywords | Inspect `_manifest.json`: `files.length` matches `ls pages/ \| wc -l`; every entry has non-empty `keywords` |
| Re-running produces identical output (deterministic) | The `diff -r` test above produces no output |
| Unit tests pass (HTML→markdown, content extraction, frontmatter generation) | `pnpm --filter @legal-chatbot/crawler test` |

## Troubleshooting

- **`Crawl failed: Either url or inputDir is required`**: pass either
  `--url` or `--input` (FR-013, §3.3).
- **`Crawl failed: Config file not found at <path>`**: explicit
  `--config <path>` requires the file to exist; remove the flag to
  fall back to `.crawlerrc.json` (or absent → defaults).
- **Crawl hangs on a CSR-heavy page**: Playwright's
  `waitForLoadState('networkidle')` has a 5-second timeout; if a page
  exceeds it, the rendered DOM at that point is used. Persistent
  hangs indicate a page that never reaches networkidle — file an
  issue with the URL.
- **Output non-deterministic across runs**: confirm `--deterministic`
  is set; report any remaining non-determinism as a bug against R9.
- **Pages I expected to crawl are missing**: check `robots.txt` for
  `Disallow:` rules, then `--exclude` flags, then the
  `.crawlerrc.json` `exclude` array.

## Out of Scope for This Quickstart

- Running the chat agent against the produced context — Phase 3
  (`004-chat-api-agent`).
- Deploying the context store to production — Phase 8
  (`009-deployment-release`).
- The Sync CLI (`legal-chatbot-sync`) for pushing dashboard
  configuration to the context store — separate feature in Phase 6.

