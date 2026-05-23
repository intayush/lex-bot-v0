# Contract: Context Store Manifest

**Owner**: Crawler CLI (`002-crawler-cli`) — writer
**Reader**: Context Search Agent (`003-context-search`) — primary reader
**Source of Truth**: §5.5.

## File location

`<outputDir>/_manifest.json` (root of the context store, sibling to
`pages/`).

## Shape

```json
{
  "version": 1,
  "generated_at": "2026-05-09T14:30:00Z",
  "base_url": "https://example-lawfirm.com/chatbot-context/",
  "files": [
    {
      "path": "pages/practice-areas--family-law.md",
      "title": "Family Law Practice",
      "section_type": "practice-area",
      "word_count": 847,
      "content_hash": "a3f2b8c1...",
      "keywords": ["divorce", "custody", "child support", "adoption"]
    }
  ]
}
```

## Top-level fields

| Field | Type | Notes |
|---|---|---|
| `version` | integer | Schema version; MVP = `1` |
| `generated_at` | string (ISO 8601 UTC) | Run timestamp; deterministic literal under `--deterministic` |
| `base_url` | string (URL) | Where the context store is served over HTTPS in production (the lawyer's site) |
| `files` | object[] | One entry per markdown file under `pages/`, sorted by `path` under `--deterministic` |

## Per-file entry fields

| Field | Type | Notes |
|---|---|---|
| `path` | string | Relative path from `<outputDir>` (e.g., `pages/about.md`) |
| `title` | string | Mirror of frontmatter `title` |
| `section_type` | enum | Mirror of frontmatter `section_type` |
| `word_count` | integer | Mirror of frontmatter `word_count` |
| `content_hash` | string (hex) | Mirror of frontmatter `content_hash` |
| `keywords` | string[] | Auto-extracted by `utils/keywords.ts`; used by the agent's relevance scoring (§7.6) |

## Validation

Validated via Zod schema at
`packages/shared/src/schemas/manifest.ts` on:
- Write (Crawler) — validation failure aborts the crawl.
- Read (Phase 2) — validation failure throws to the agent runtime.

## Determinism

Under `--deterministic`:

- `generated_at` is the literal `"2026-01-01T00:00:00.000Z"` (or
  whichever fixed value the implementation chooses; documented in
  R9).
- `files` array is sorted by `path` lexicographically.
- JSON serialization uses two-space indentation
  (`JSON.stringify(obj, null, 2)`), trailing newline.

This guarantees byte-identical output across runs with identical
input — a §12.6 done-when criterion.

## Schema versioning

The manifest schema is at version `1`. The `version` field reserved
for future schema migrations. Phase 2 reads the version and
warns/aborts if it sees an unrecognized version.

