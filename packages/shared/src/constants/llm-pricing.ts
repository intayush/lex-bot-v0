import type { LlmProvider } from '../schemas/llm-config.js';

/**
 * 027-platform-admin-console — indicative per-token prices (USD) for estimating
 * tenant spend from recorded token counts. Prices are approximate and used ONLY
 * for the admin console's estimated-spend display, never for billing. Stored as
 * dollars per 1,000,000 tokens. Update here when provider pricing changes —
 * spend is computed at read-time so no backfill is needed.
 */
export interface ModelPrice {
  /** USD per 1M input (prompt) tokens. */
  inputPerMillion: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMillion: number;
}

export const LLM_PRICING: Record<LlmProvider, Record<string, ModelPrice>> = {
  google: {
    'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
    'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10 },
  },
  anthropic: {
    'claude-sonnet-5': { inputPerMillion: 3, outputPerMillion: 15 },
    'claude-opus-4-8': { inputPerMillion: 15, outputPerMillion: 75 },
    'claude-haiku-4-5-20251001': { inputPerMillion: 1, outputPerMillion: 5 },
  },
  openai: {
    'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
    'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
};

/** Fallback price used when a provider/model pair is unknown to the map. */
export const DEFAULT_MODEL_PRICE: ModelPrice = { inputPerMillion: 1, outputPerMillion: 5 };
