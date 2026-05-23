# Contract: Crawler CLI Interface

**Owner**: Crawler CLI feature (`002-crawler-cli`)
**Source of Truth**: §3.3, §12.6.

The Crawler CLI is invoked as `npx legal-chatbot-crawl <flags>` (or
locally as `legal-chatbot-crawl` after npm install). This contract
defines its argument surface, exit behavior, and stdout/stderr
conventions.

## Invocation

```bash
npx legal-chatbot-crawl --url <url> --output <dir>
npx legal-chatbot-crawl --input <dir> --output <dir>
npx legal-chatbot-crawl --url <url> --output <dir> --config .crawlerrc.json
```

## Flags (per §3.3)

| Flag | Type | Default | Required | Source |
|---|---|---|---|---|
| `--url`, `-u` | string (URL) | — | Required unless `--input` | §3.3 |
| `--input`, `-i` | string (path) | — | Required unless `--url` | §3.3 |
| `--output`, `-o` | string (path) | `./chatbot-context/` | no | §3.3 |
| `--exclude` | string (glob, repeatable) | — | no | §3.3 |
| `--max-pages` | integer | `100` | no | §3.3 |
| `--deterministic` | boolean | `false` | no | §3.3 |
| `--config` | string (path) | `.crawlerrc.json` | no | §3.3 |

## Validation rules

- Both `--url` and `--input` absent → usage error, exit 1.
- `--url` present and not a valid URL → usage error, exit 1.
- `--input` present but path does not exist → usage error, exit 1.
- `--max-pages` not a positive integer → usage error, exit 1.
- `--config <path>` explicitly set but file does not exist → exit 1.
  (Default `.crawlerrc.json` missing is non-fatal — use defaults.)

## Standard output

Progress and summary go to **stdout**:

```
Fetching pages...
  Fetching: https://firm.com/
  Fetching: https://firm.com/about
  ...
Found 12 page(s). Processing...

Crawl complete.
  Pages crawled: 12
  Output: ./chatbot-context/
  Manifest: ./chatbot-context/_manifest.json
```

In structured-log mode (when consuming the Foundation logger), each
event is JSON-line per the log-event contract in `001-foundation`.

## Standard error

User-facing failures go to **stderr** with a clear message:

```
Crawl failed: <human-readable reason>
```

Process exit code is non-zero on any unrecovered error.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | Success: crawl completed; manifest written |
| 1 | Usage error (missing required flag, bad value, missing file) |
| 1 | Crawl runtime error (config-file parse failure, fatal fetch error, fs write failure) |

The spec does not enumerate fine-grained codes (Assumption in
spec.md); 0/1 split is the binding contract.

## Determinism guarantee (when `--deterministic`)

Two consecutive runs with identical input MUST produce
byte-identical output across:

- Every markdown file under `pages/`.
- `_manifest.json`.

This is verified by R9 (audit + clock helper) and tested via Vitest
snapshot comparison.

## Backward-compatibility commitment

The flag set in §3.3 is the binding public surface. Adding new
optional flags is permitted; removing or renaming existing flags
requires a major version bump and a Constitution amendment
(per Constitution VII coordinated cross-phase changes).

