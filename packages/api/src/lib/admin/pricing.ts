/**
 * 027-platform-admin-console — estimated spend from recorded token counts.
 * Thin wrapper over the shared LLM_PRICING map. Estimate only, never billing.
 */
import { LLM_PRICING, DEFAULT_MODEL_PRICE, type LlmProvider } from '@legal-chatbot/shared';

export function estimateSpend(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const providerPrices = LLM_PRICING[provider as LlmProvider];
  const price = providerPrices?.[model] ?? DEFAULT_MODEL_PRICE;
  const input = (promptTokens / 1_000_000) * price.inputPerMillion;
  const output = (completionTokens / 1_000_000) * price.outputPerMillion;
  return input + output;
}
