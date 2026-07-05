/**
 * Central environment access for the Platform Admin Console (027).
 *
 * Constitution IV: "Missing required env vars MUST cause fast startup failure
 * with a clear error message — NEVER silent fallback to a default."
 *
 * This module is imported only by admin-console / LLM-provider code, so
 * validation here does not affect existing firm-facing routes at import time.
 *
 * - Admin-critical vars (ADMIN_SESSION_SECRET, ENCRYPTION_KEY) throw the first
 *   time they are read if absent — they are required for any admin operation.
 * - Provider fallback keys (ANTHROPIC_API_KEY, OPENAI_API_KEY) are validated
 *   lazily by the provider-resolver only when a tenant actually selects that
 *   provider without supplying its own key.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

/** iron-session password for the super-admin session (≥ 32 chars). */
export function getAdminSessionSecret(): string {
  const secret = requireEnv('ADMIN_SESSION_SECRET');
  if (secret.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET must be at least 32 characters');
  }
  return secret;
}

/**
 * 32-byte key material for AES-256-GCM encryption of per-tenant provider keys.
 * Accepts base64 or hex; MUST decode to exactly 32 bytes.
 */
export function getEncryptionKey(): Buffer {
  const raw = requireEnv('ENCRYPTION_KEY');
  // Try hex first (64 hex chars), then base64.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64)');
  }
  return key;
}

/** Platform fallback key for a provider, when a tenant supplies none. */
export function getPlatformProviderKey(provider: 'google' | 'anthropic' | 'openai'): string {
  switch (provider) {
    case 'google':
      return requireEnv('GOOGLE_GENERATIVE_AI_API_KEY');
    case 'anthropic':
      return requireEnv('ANTHROPIC_API_KEY');
    case 'openai':
      return requireEnv('OPENAI_API_KEY');
  }
}
