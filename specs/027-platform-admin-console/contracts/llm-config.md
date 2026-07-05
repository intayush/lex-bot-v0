# Contract: Per-tenant LLM configuration

## GET /api/admin/tenants/[id]/llm-config
- 200: `LlmConfigView | null`
```
LlmConfigView = {
  provider: "google" | "anthropic" | "openai",
  model: string,
  hasKey: boolean,        // true if a per-tenant key is stored
  isActive: boolean,
  updatedAt: string
}
```
- `null` → tenant uses platform default (`google` / `gemini-2.5-flash`).
- **NEVER** returns `api_key_encrypted` or any plaintext key (FR-016, SC-005).

## PUT /api/admin/tenants/[id]/llm-config
Request:
```
{
  provider: "google" | "anthropic" | "openai",
  model: string,              // must be in the (provider,model) allow-list
  apiKey?: string,            // optional; if present, encrypted at rest
  clearKey?: boolean,         // if true, remove stored per-tenant key (→ platform key)
  isActive?: boolean          // default true
}
```
- 200: `LlmConfigView` (with `hasKey` reflecting the new state).
- 400: Zod error — including `(provider, model)` not in allow-list.
- Behavior: upsert `account_llm_config` (unique per account). If `apiKey`
  present → `encrypt()` and store; if `clearKey` → set `api_key_encrypted=NULL`.
  Invalidate the provider-resolver cache for this account. Audit:
  `llm_config.update` (metadata: provider + model only, never the key).

## Resolution contract (runtime, not an endpoint)
`resolveModelForAccount(accountId)`:
- No active config → `google('gemini-2.5-flash')` (platform key).
- Active config, no per-tenant key → provider+model with platform env key.
- Active config + per-tenant key → provider+model with decrypted tenant key.
- All agent bounds (maxSteps 5, token budget, rate limits) unchanged (FR-017).
