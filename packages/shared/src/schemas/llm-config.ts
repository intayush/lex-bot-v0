import { z } from 'zod';

/**
 * 027-platform-admin-console — per-tenant LLM provider/model configuration.
 *
 * Providers and the platform default are governance facts fixed by
 * constitution v2.0.0 (Required Stack + Principle VI). The (provider, model)
 * allow-list is the single source of truth for what may be selected.
 */

export const llmProviderSchema = z.enum(['google', 'anthropic', 'openai']);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

/** Platform default provider/model, used whenever a tenant has no config. */
export const PLATFORM_DEFAULT_PROVIDER: LlmProvider = 'google';
export const PLATFORM_DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Allow-list of selectable models per provider. Kept intentionally small and
 * explicit — an unknown/invalid model is rejected at the boundary. Extend here
 * (not scattered) when adding a supported model.
 */
export const LLM_MODELS_BY_PROVIDER: Record<LlmProvider, readonly string[]> = {
  google: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  anthropic: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
} as const;

/** True when a (provider, model) pair is in the allow-list. */
export function isAllowedModel(provider: LlmProvider, model: string): boolean {
  return LLM_MODELS_BY_PROVIDER[provider]?.includes(model) ?? false;
}

/**
 * Request body for setting a tenant's LLM config.
 * `apiKey` (optional) is encrypted at rest by the API; never echoed back.
 * `clearKey` removes any stored per-tenant key (→ platform key).
 */
export const llmConfigInputSchema = z
  .object({
    provider: llmProviderSchema,
    model: z.string().min(1),
    apiKey: z.string().min(1).optional(),
    clearKey: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => isAllowedModel(v.provider, v.model), {
    message: 'Unsupported (provider, model) combination',
    path: ['model'],
  });
export type LlmConfigInput = z.infer<typeof llmConfigInputSchema>;

/**
 * Safe read-back view of a tenant's LLM config. NEVER includes key material —
 * only whether a per-tenant key is stored (Constitution V/VIII, FR-016).
 */
export const llmConfigViewSchema = z.object({
  provider: llmProviderSchema,
  model: z.string(),
  hasKey: z.boolean(),
  isActive: z.boolean(),
  updatedAt: z.string(),
});
export type LlmConfigView = z.infer<typeof llmConfigViewSchema>;
