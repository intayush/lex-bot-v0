# Contract: ToS Acceptance

**Owner**: Hardening (`008-hardening`)
**Source of Truth**: §11.4.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/accept-tos` | POST | Record acceptance |
| `/api/auth/tos-status` | GET | Check current account's acceptance state |

## Middleware

Add a Next.js middleware that, on every dashboard route
request:

1. Reads the lawyer's iron-session.
2. Reads the current ToS version from
   `packages/shared/src/templates/terms-of-service.md`
   front-matter (constant at build time).
3. SELECT `tos_acceptances` WHERE `account_id = ? AND
   tos_version = ?`.
4. If no row exists → redirect to `/dashboard/accept-tos`.
5. Else → continue.

The `/dashboard/accept-tos` page renders the ToS template
(with placeholders substituted) and an "I accept" button
that POSTs to `/api/auth/accept-tos`.

## POST /api/auth/accept-tos

Body:

```ts
{
  tos_version: z.string()
}
```

Behavior:
1. Authenticated via iron-session.
2. Validate `tos_version` matches the current version (no
   accepting historical versions).
3. INSERT into `tos_acceptances` with `account_id`,
   `tos_version`, `accepted_at = now()`, optionally
   `ip_address` from `x-forwarded-for` header,
   `user_agent` from `user-agent` header.
4. Return `{ success: true, redirect: '/dashboard/leads' }`.

## GET /api/auth/tos-status

Returns:

```ts
{
  current_version: string;
  accepted: boolean;
  accepted_at: string | null;
}
```

Used by middleware-light surfaces to check status without
incurring a full redirect.

## Idempotency

A second POST with the same `tos_version` for the same account
INSERTs a new row (audit-trail; multiple acceptance events are
allowed). The middleware only checks existence, so duplicates
don't break behavior but are visible in the audit table.

## Logging

- `tos_accepted` event via Foundation logger:
  `{ account_id, tos_version }`.

## Tests

- New account login → redirected to ToS page.
- Accept ToS → row inserted; redirect to dashboard.
- Existing acceptance → no redirect.
- Version bump → re-prompted on next login.
- Old acceptance rows preserved (audit trail).

