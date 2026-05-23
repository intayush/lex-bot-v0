# Contract: Dev Seed

**Owner**: Foundation feature (`001-foundation`)
**Source of Truth**: §12.3 (Dev Environment Setup), Constitution Local Development.

This contract defines the rows the `pnpm db:seed` command MUST
ensure exist after any successful run. The seed is for development
and CI dev fixtures only. It MUST NOT be invoked against production
(see deploy-side guard in `009-deployment-release` FR-033).

## Idempotency

Running the seed twice in succession MUST produce the same database
state as running it once. Implementation: every insert uses
`ON CONFLICT … DO NOTHING` (or the Drizzle `.onConflictDoNothing()`
helper) keyed by a natural unique column.

## Required Rows

After seed completion the database MUST contain these rows. Values
in **bold** are required to match exactly; other values may be
chosen by the seed.

### Test account

```jsonc
{
  "email": "dev@legalchatbot.com",            // unique key — bold
  "password_hash": "<bcryptjs hash of 'password123'>",
  "firm_name": "Lex Bot Dev Firm",
  "created_at": "<seed run timestamp>"
}
```

The plaintext password `password123` MUST be hashed via bcryptjs
before insert. The plaintext is documented for the dev environment
only.

### Dev API key

```jsonc
{
  "account_id": "<id of the test account above>",
  "key_hash": "<bcryptjs hash of 'dev_test_key'>",   // unique-key tuple — bold
  "label": "dev",
  "context_store_url": "<see CONTEXT_STORE_URL rule below>",
  "created_at": "<seed run timestamp>",
  "revoked_at": null
}
```

The plaintext key `dev_test_key` MUST be hashed via bcryptjs before
insert. Conflict key: `(account_id, label)`.

### Published guardrails configuration

```jsonc
{
  "account_id": "<id of the test account above>",
  "version": 1,                                       // unique-key tuple — bold
  "config_json": "<Shrager Defense Attorneys defaults JSON>",
  "is_published": true,
  "created_at": "<seed run timestamp>"
}
```

The seeded `config_json` MUST be a valid §4.4 form-output JSON
populated with Shrager Defense Attorneys defaults (firm name,
practice areas, qualifying questions, etc.). The shape is validated
by `packages/shared/src/schemas/configuration.ts`. Conflict key:
`(account_id, version)`.

## CONTEXT_STORE_URL Resolution

The seed MUST set the API key's `context_store_url` to:

1. The value of `process.env.CONTEXT_STORE_URL` when set.
2. Otherwise the literal `http://localhost:5173/chatbot-context/`
   (the local dev default per §12.3).

## Constraints

- The seed MUST NOT use `bcrypt` (native). It MUST use `bcryptjs`.
- The seed MUST NOT execute when `NODE_ENV === 'production'` —
  the seed module checks and aborts with a clear error.
- The seed MUST NOT touch any tables not listed above (do not seed
  fake leads, sessions, or notifications — those exist for
  downstream feature tests, not as dev-environment fixtures).

## Tests

Tests in `packages/api/src/db/seed.test.ts` MUST verify:

- After running seed against a fresh in-memory SQLite database, all
  three rows above exist with the bolded keys.
- After running seed twice, row counts in `accounts`, `api_keys`,
  and `configurations` are unchanged from after the first run.
- Running seed with `NODE_ENV=production` throws and writes
  nothing.
- The `context_store_url` matches the resolution rule
  (`CONTEXT_STORE_URL` set vs unset).
- The dev API key authenticates: the bcryptjs comparison of
  `'dev_test_key'` against the stored `key_hash` succeeds.

## Migration Note

The current seed implementation in
`packages/api/src/db/seed.ts` exists. The Foundation work is to
audit its conflict-handling and add the production-NODE_ENV guard
plus the test file above.
