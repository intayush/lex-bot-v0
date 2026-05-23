# Contract: Crawler Status Routes

**Owner**: Dashboard (`007-dashboard`)
**Source of Truth**: §8.9.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/dashboard/crawler-status` | GET | Aggregate status fields |
| `/api/dashboard/test-context` | POST | Run a sample search |

## GET /api/dashboard/crawler-status

Behavior:
1. Authenticated.
2. Look up the active API key for the account → its
   `context_store_url`.
3. Fetch `<context_store_url>_manifest.json` with a 5-second
   timeout.
4. Parse + validate via Phase 2's `manifestSchema`.
5. Compute health: green if fetch + parse succeeded; red
   otherwise.

Response:

```ts
{
  context_store_url: string;
  health: 'green' | 'red';
  health_detail?: string;          // error reason on red
  last_crawl: string | null;       // manifest.generated_at
  pages_crawled: number | null;    // manifest.files.length
  rerun_command: string;           // "npx legal-chatbot-crawl --url ... --output ./chatbot-context/"
}
```

The `rerun_command` is a copyable string the lawyer runs on
their machine.

## POST /api/dashboard/test-context

Body:

```ts
{ query: z.string().min(1) }
```

Behavior:
1. Authenticated.
2. Look up the active API key for the account → its
   `context_store_url`.
3. Call `cache.invalidate(context_store_url)` (Phase 2 contract)
   so the lawyer sees the freshest manifest.
4. Call `searchContext(context_store_url, query)`.
5. Return:

```ts
{
  results: Array<{
    path: string;
    title: string;
    section_type: string;
    score: number;
    content_preview: string;       // first 500 chars
  }>;
  total_assembled_tokens: number;
}
```

## Constitution Compliance

- Constitution II: Zod body validation; manifest parsed via
  shared Zod schema.
- Constitution IV: Route Handler; no fs writes; reads from
  HTTPS only.
- Constitution V: account-scoped (only this account's API key
  is used; no cross-account leak).
- Constitution VII: Test context retrieval reuses Phase 2's
  cache invalidation contract.

