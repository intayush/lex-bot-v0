# Contract: Tenants (fleet + registration + lifecycle)

## GET /api/admin/tenants  (fleet overview)
- 200: `{ tenants: TenantSummary[] }`
```
TenantSummary = {
  accountId, firmName, email,
  status: "active" | "suspended",
  onboardingStatus: "draft" | "published" | "live",
  leadCount30d: number,
  estimatedSpend30d: number,      // derived from usage_events
  lastActivityAt: string | null
}
```
Excludes soft-deleted (`deleted_at IS NULL`). One grouped query per metric — no
per-tenant N+1.

## POST /api/admin/tenants  (register)
Request: `{ email: string, firmName: string }`
- 201: `{ accountId, apiKey: string }` — **apiKey plaintext returned exactly
  once**; never retrievable again.
- 409: `{ error: "A tenant with this email already exists" }` (FR-007)
- 400: Zod error.

Behavior: `provisionTenant()` creates `accounts` (status=active,
onboarding_status=draft) + `apiKeys` (generated key, bcrypt-hashed). Audit:
`tenant.create`.

## GET /api/admin/tenants/[id]  (detail)
- 200: `{ tenant: TenantSummary, llmConfig: LlmConfigView | null }`
- 404 if not found or soft-deleted.

## DELETE /api/admin/tenants/[id]  (soft-delete)
- 200: `{ success: true }` — writes `archived_data` snapshot of leads/PII, sets
  `deleted_at`. No hard delete (FR-027). Audit: `tenant.delete`.

## PATCH /api/admin/tenants/[id]/status  (suspend / reactivate)
Request: `{ status: "active" | "suspended" }`
- 200: `{ success: true }`
  - suspend → set `status`, revoke API keys (chatbot stops serving).
  - reactivate → set `status`, re-enable/issue key.
- Audit: `tenant.suspend` / `tenant.reactivate`.

## POST /api/admin/tenants/[id]/rotate-key
- 200: `{ apiKey: string }` — new plaintext shown once; previous key
  `revoked_at` set (old key stops working). Audit: `tenant.rotate_key`.
