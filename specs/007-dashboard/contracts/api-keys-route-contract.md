# Contract: `/api/dashboard/api-keys`

**Owner**: Dashboard (`007-dashboard`)
**Source of Truth**: §2.4, §8.8.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/dashboard/api-keys` | GET | List the account's API keys (masked) |
| `/api/dashboard/api-keys` | POST | Generate a new key |
| `/api/dashboard/api-keys/{id}` | DELETE | Revoke a key |
| `/api/dashboard/api-keys/{id}/rotate` | POST | Rotate a key with 24h grace |

## GET /api/dashboard/api-keys

Response:

```ts
{
  keys: Array<{
    id: string;
    label: string | null;
    masked: string;            // "lc_live_••••••••3xyZ"
    context_store_url: string;
    created_at: string;
    revoked_at: string | null;
    rotation_grace_until: string | null;
  }>;
}
```

The `masked` representation shows only the last 4 characters of
the original plaintext key (which we don't have post-hash). MVP
approach: store a `masked` column at insert time, OR derive the
masked form from a generated `key_prefix` column. Decision:
add a `key_prefix text` column (last 4 chars of plaintext) at
insert time so the masked display is reproducible.

(Schema impact: another column on `api_keys`, captured as a
small R12 sub-task.)

## POST /api/dashboard/api-keys

Body:

```ts
{ label?: z.string().optional(), context_store_url: z.string().url() }
```

Behavior:
1. Authenticated.
2. Generate plaintext: `lc_live_${nanoid(32)}`.
3. Hash via bcryptjs.
4. INSERT into `api_keys` with `account_id = session.accountId`,
   `key_hash`, `label`, `context_store_url`, `key_prefix =
   plaintext.slice(-4)`, `created_at = now()`.
5. Return:

```ts
{
  id: string;
  plaintext_key: string;     // shown ONCE
  masked: string;
  context_store_url: string;
  created_at: string;
}
```

The plaintext is sent in the response body ONLY ON THIS CALL
per §2.4 step 2. The dashboard UI displays it once with a copy
button and a clear "this key will not be shown again" warning.

## DELETE /api/dashboard/api-keys/{id}

Behavior:
1. Authenticated.
2. Verify the key belongs to the account → 404 if not.
3. UPDATE `revoked_at = now()`.
4. Return `{ success: true }`.

## POST /api/dashboard/api-keys/{id}/rotate

Behavior (in a transaction):
1. Authenticated.
2. Verify the OLD key belongs to the account.
3. Generate a new plaintext + hash + key_prefix.
4. INSERT new `api_keys` row (active).
5. UPDATE the OLD row's `rotation_grace_until = now() + 24h`.
6. Return:

```ts
{
  new_key: {
    id: string;
    plaintext_key: string;   // shown once
    masked: string;
    context_store_url: string;
  };
  old_key_grace_until: string;  // ISO timestamp
}
```

The auth layer (`packages/api/src/lib/auth.ts`) accepts the OLD
key during the grace period (a key is valid if `revoked_at IS
NULL OR rotation_grace_until > now()`).

## Constitution Compliance

- Constitution II: Zod-validated bodies; bcryptjs hashes never
  exposed in responses.
- Constitution IV: Route Handlers; no native binaries.
- Constitution V: plaintext key shown once and never logged
  (Foundation logger redaction list catches `apiKey` /
  `plaintext_key` / `key_hash` substrings).

