# Contract: Environment Variables

**Owner**: Foundation feature (`001-foundation`)
**Source of Truth**: §9.7 (production env vars), §12.3 (dev env vars), Constitution "Required Environment Variables".

This contract enumerates every environment variable the Foundation
loads, the package(s) that consume each, and the validation rules. It
is the binding interface between operators (engineers configuring
deployments) and the application code.

## API package (`packages/api`) — production

| Variable | Required | Validation | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | Non-empty; matches `^postgres(ql)?://` | Neon connection string |
| `GOOGLE_GENERATIVE_AI_API_KEY` | yes | Non-empty | Gemini API authentication |
| `SESSION_SECRET` | yes | Length ≥ 32 | iron-session encryption key |

**Behavior on missing/invalid**: the env loader throws a `ZodError`
with a clear message naming the variable. Module import fails;
function does not start. **No silent fallback**.

## Widget package (`packages/widget`) — production

| Variable | Required | Validation | Purpose |
|---|---|---|---|
| `VITE_API_URL` | yes (build-time) | Non-empty; valid URL | Where the widget POSTs chat messages |

Read via `import.meta.env`. Vite inlines the value at build time.

## Dev / Local

| Variable | Required | Validation | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | Same as production | Dev Neon branch |
| `GOOGLE_GENERATIVE_AI_API_KEY` | yes | Same as production | Dev Gemini key |
| `SESSION_SECRET` | yes | Same as production | Dev session secret |
| `CONTEXT_STORE_URL` | no | Valid URL when set | Override seeded `context_store_url` |
| `NODE_ENV` | no | `development` / `production` / `test` | Selects DB driver in `packages/api/src/db/index.ts` factory |

## Module API

```ts
// packages/shared/src/env/api-env.ts
import { z } from 'zod';

const apiEnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
});

export const apiEnv = apiEnvSchema.parse(process.env);
export type ApiEnv = z.infer<typeof apiEnvSchema>;
```

```ts
// packages/shared/src/env/widget-env.ts
import { z } from 'zod';

const widgetEnvSchema = z.object({
  VITE_API_URL: z.string().url(),
});

// In Vite, import.meta.env is the source.
export const widgetEnv = widgetEnvSchema.parse(import.meta.env);
export type WidgetEnv = z.infer<typeof widgetEnvSchema>;
```

```ts
// packages/shared/src/env/dev-env.ts
import { z } from 'zod';

const devEnvSchema = z.object({
  CONTEXT_STORE_URL: z.string().url().optional(),
});

export const devEnv = devEnvSchema.parse(process.env);
```

## Tests

Tests in `packages/shared/src/env/api-env.test.ts` MUST verify:

- Throws when `DATABASE_URL` is missing.
- Throws when `GOOGLE_GENERATIVE_AI_API_KEY` is missing.
- Throws when `SESSION_SECRET` is missing.
- Throws when `SESSION_SECRET` is shorter than 32 characters.
- Throws when `DATABASE_URL` does not start with `postgres://` or `postgresql://`.
- Returns a typed object when all values are valid.

## Migration

The current `packages/api/src/lib/dashboard-session.ts:11` uses
`process.env.SESSION_SECRET ?? ''`. Under this contract that line
becomes:

```ts
import { apiEnv } from '@legal-chatbot/shared';
// …
password: apiEnv.SESSION_SECRET,
```

The fallback `?? ''` is removed. Startup with a missing or short
`SESSION_SECRET` now fails during module load instead of silently
running with an empty session secret.
