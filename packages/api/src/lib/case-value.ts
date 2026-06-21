import type { CaseValueConfig } from '@legal-chatbot/shared';

/**
 * Format a USD amount with K/M suffixes for display.
 * ≥1,000,000 → $XM | ≥1,000 → $XK | else → $X
 */
export function formatCaseValueAmount(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return `$${n}`;
}

/**
 * Format a value range badge string from min/max USD amounts.
 * When min === max, returns a single value (point estimate).
 */
export function formatCaseValueBadge(min: number, max: number): string {
  const fMin = formatCaseValueAmount(min);
  const fMax = formatCaseValueAmount(max);
  return min === max ? fMin : `${fMin} – ${fMax}`;
}

/**
 * Resolve the value range badge for a lead given its score and the branch's
 * case value configuration.
 *
 * Returns null when:
 * - `enabled` is false
 * - `config` is null or has no bands
 * - `leadScore` is null (unscored lead)
 * - No band contains the lead score
 *
 * Bands are matched in ascending `position` order (first match wins).
 */
export function resolveCaseValueBadge(
  leadScore: number | null,
  config: CaseValueConfig | null,
  enabled: boolean,
): string | null {
  if (!enabled) return null;
  if (!config || config.bands.length === 0) return null;
  if (leadScore === null) return null;

  const sorted = [...config.bands].sort((a, b) => a.position - b.position);
  for (const band of sorted) {
    if (leadScore >= band.score_min && leadScore <= band.score_max) {
      return formatCaseValueBadge(band.value_min_usd, band.value_max_usd);
    }
  }
  return null;
}
