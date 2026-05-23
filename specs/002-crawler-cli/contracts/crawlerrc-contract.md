# Contract: .crawlerrc.json Configuration File

**Owner**: Crawler CLI (`002-crawler-cli`) — reader
**Source of Truth**: §3.4.

## File location

Resolved in this order:

1. `--config <path>` (CLI flag, R8) — explicit, MUST exist if set.
2. `.crawlerrc.json` in `process.cwd()` — default, MAY be absent.

If neither is found, the Crawler runs with built-in defaults.

## Shape (Zod-validated)

```jsonc
{
  "exclude": ["/admin/*", "/login"],     // optional; URL glob patterns
  "selectors": {                          // optional
    "content": "article.main-content",
    "title": "h1.page-title"
  },
  "maxDepth": 3                           // optional; positive integer
}
```

## Field semantics

### `exclude` (string[], optional)

Glob patterns applied to the URL path. Matched URLs are skipped
during fetching. Patterns use the same syntax as the `--exclude`
CLI flag.

The CLI `--exclude` flag and the file's `exclude` array are
**unioned**: both contribute to the final skip set.

### `selectors.content` (string, optional)

A CSS selector identifying the main content area on every page.
When set, the extractor uses this selector instead of its default
heuristic (which falls back to `<body>`-minus-chrome). Useful for
sites where the chrome-stripping selector list in `extractor.ts`
under-extracts (e.g., sites that wrap content in custom containers).

### `selectors.title` (string, optional)

A CSS selector identifying the page title element. When set,
overrides the default chain (`<title>` → first `<h1>` → "Untitled").

### `maxDepth` (integer, optional)

Caps BFS depth from the root URL. When unset, depth is unbounded;
`--max-pages` still enforces an absolute page-count cap.

## Validation rules

- Top-level keys: `exclude`, `selectors`, `maxDepth`. Unknown
  top-level keys produce a warning but the parse succeeds
  (forward compat).
- `exclude` items must be strings.
- `selectors.content` and `selectors.title` must be strings; they
  are not validated as CSS selectors at parse time (cheerio reports
  errors at apply time).
- `maxDepth` must be an integer ≥ 1.
- A malformed JSON file (parse error) is fatal; exit 1.
- Schema-validation failure (wrong types) is fatal; exit 1.

## Examples

### Minimal (skip admin pages only)

```json
{
  "exclude": ["/admin/*"]
}
```

### Custom content selector for a site with unusual markup

```json
{
  "selectors": {
    "content": "main .article-body"
  },
  "maxDepth": 5
}
```

### Comprehensive

```json
{
  "exclude": ["/admin/*", "/login", "/wp-admin/*"],
  "selectors": {
    "content": "article.main-content",
    "title": "h1.page-title"
  },
  "maxDepth": 4
}
```

## Constitution compliance

- Constitution Principle II: parsed via Zod (R3).
- Constitution Principle V: the `exclude` field gives lawyers a
  concrete tool to keep non-public pages out of the context store
  (working alongside `robots.txt`).

