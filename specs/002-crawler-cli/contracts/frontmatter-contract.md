# Contract: Page Markdown Frontmatter

**Owner**: Crawler CLI (`002-crawler-cli`) — writer
**Reader**: Context Search Agent (`003-context-search`) — reader
**Source of Truth**: §3.11.

## Format

YAML frontmatter delimited by `---` lines at the very top of every
markdown file under `<outputDir>/pages/`.

```yaml
---
title: "Family Law Practice"
source_url: "https://example-lawfirm.com/practice-areas/family-law"
crawled_at: "2026-05-09T14:30:00Z"
word_count: 847
section_type: "practice-area"
content_hash: "a3f2b8c1..."
alternate_urls: []
---
```

## Required fields

| Field | Type | Notes |
|---|---|---|
| `title` | string | From `<title>` or first `<h1>`; "Untitled" if neither present |
| `source_url` | string (URL) | Canonical URL (post-dedup) |
| `crawled_at` | string (ISO 8601 UTC) | Run timestamp; deterministic literal under `--deterministic` |
| `word_count` | integer | Markdown body word count |
| `section_type` | enum | `practice-area` \| `attorney-bio` \| `faq` \| `blog-post` \| `contact` \| `about` \| `general` |
| `content_hash` | string (hex) | SHA-256 of the markdown body, lowercase hex |

## Optional fields

| Field | Type | When present |
|---|---|---|
| `alternate_urls` | string[] | Only when this canonical page consolidated dedupes (R4); empty array or omitted otherwise |

## Validation

The Crawler MUST validate frontmatter against the Zod schema at
`packages/shared/src/schemas/frontmatter.ts` before writing the
file. Validation failure is fatal (no file written; crawl aborts
with exit 1).

The Context Search Agent MUST also validate on read (Constitution
Principle II — both producer and consumer validate).

## Schema versioning

The frontmatter schema is at version `1`. Adding new optional
fields (like `alternate_urls`) is a non-breaking change. Renaming
or removing fields, or making optional fields required, is a
breaking change requiring a Constitution amendment per Phase
coordination (Constitution VII).

## Examples

### Standard page (no dedup)

```yaml
---
title: "John Smith - Senior Partner"
source_url: "https://example-lawfirm.com/attorneys/john-smith"
crawled_at: "2026-05-09T14:30:00Z"
word_count: 412
section_type: "attorney-bio"
content_hash: "b7e4d2a9c1f8e3..."
---
```

### Consolidated page (dedup'd)

```yaml
---
title: "Personal Injury Practice"
source_url: "https://example-lawfirm.com/practice-areas/personal-injury"
crawled_at: "2026-05-09T14:30:00Z"
word_count: 952
section_type: "practice-area"
content_hash: "c9e3a4f1b7..."
alternate_urls:
  - "https://example-lawfirm.com/practice-areas/personal-injury?utm_source=footer"
  - "https://example-lawfirm.com/practice-areas/personal-injury/print"
---
```

### Split page (>2000 words; one of the splits)

```yaml
---
title: "FAQ — Personal Injury"
source_url: "https://example-lawfirm.com/faq"
crawled_at: "2026-05-09T14:30:00Z"
word_count: 1850
section_type: "faq"
content_hash: "f8c2e1d9a4..."
---
```

