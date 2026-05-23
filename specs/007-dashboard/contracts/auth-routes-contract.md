# Contract: Authentication Routes

**Owner**: Dashboard (`007-dashboard`)
**Source of Truth**: §8.2, §12.11.

## Routes

| Route | Status | Owner |
|---|---|---|
| `POST /api/auth/login` | ✅ exists | Dashboard |
| `POST /api/auth/logout` | ✅ exists | Dashboard |
| `POST /api/auth/signup` | ❌ NEW (R2) | Dashboard |
| `POST /api/auth/reset-password/request` | ❌ NEW (R2) | Dashboard |
| `POST /api/auth/reset-password/confirm` | ❌ NEW (R2) | Dashboard |

All routes are Next.js Route Handlers. Server Actions FORBIDDEN
(Constitution IV).

## POST /api/auth/login (existing)

Body: `{ email: string, password: string }`. Validates via Zod;
looks up by email; bcryptjs comparison. On success, sets
iron-session cookie (HTTP-only, Secure in production) and
returns `{ success: true, redirect: '/dashboard/leads' }`.

## POST /api/auth/logout (existing)

Clears iron-session cookie. Returns `{ success: true }`.

## POST /api/auth/signup (NEW, R2)

Body:

```ts
{
  email: z.string().email(),
  password: z.string().min(8),  // industry-standard minimum
  firmName: z.string().optional(),
}
```

Behavior:
1. Validate body via Zod.
2. Check for existing account with same email → 409 if exists.
3. Hash password with bcryptjs.
4. INSERT into `accounts`.
5. Set iron-session cookie (auto-login after signup).
6. Return `{ success: true, redirect: '/dashboard/leads' }`.

## POST /api/auth/reset-password/request (NEW, R2)

Body: `{ email: z.string().email() }`.

Behavior:
1. Look up account by email. If not found, return `{ success: true }`
   anyway (don't leak account existence).
2. Generate a one-time token: `nanoid(48)`.
3. INSERT into `password_resets` with bcryptjs-hashed token,
   `expires_at = now() + 1h`.
4. Send reset email containing `https://<host>/reset-password?token=<plaintext>`.
5. Return `{ success: true }`.

Email provider abstraction in `packages/api/src/lib/email.ts`:
prefers `SENDGRID_API_KEY` or `RESEND_API_KEY` env, falls back
to console output in dev.

## POST /api/auth/reset-password/confirm (NEW, R2)

Body:

```ts
{
  token: z.string(),
  newPassword: z.string().min(8),
}
```

Behavior:
1. Look up password_resets row by hashed token; verify NOT used,
   NOT expired.
2. UPDATE `accounts.password_hash` with new bcryptjs hash.
3. Set `password_resets.used_at = now()` (one-time use).
4. Return `{ success: true }`.

On any failure (token not found / expired / used) → 400 with
generic "Invalid or expired token" message.

## Tests

- Login: valid credentials → 200; invalid → 401.
- Signup: existing email → 409; valid → 200.
- Reset request: existing email triggers email; non-existing
  returns 200 anyway (no enumeration).
- Reset confirm: valid token → password updated; expired token
  → 400; reused token → 400.

