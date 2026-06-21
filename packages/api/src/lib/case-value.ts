import type { CaseValueConfig } from '@legal-chatbot/shared';

type ClassificationLabel = 'HOT' | 'WARM' | 'COLD' | 'SPAM';

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
 * Resolve the value range badge for a lead.
 *
 * Resolution order:
 * 1. If `leadScore` is not null → match against score bands (precise).
 * 2. Else if `classification` is HOT/WARM/COLD and classification_bands exist → use fallback.
 * 3. Otherwise → null (no badge).
 *
 * Returns null when `enabled` is false, config is null, or no band matches.
 * SPAM leads must be excluded by the caller (pass enabled=false for SPAM).
 */
export function resolveCaseValueBadge(
  leadScore: number | null,
  config: CaseValueConfig | null,
  enabled: boolean,
  classification?: ClassificationLabel | null,
): string | null {
  if (!enabled) return null;
  if (!config) return null;

  // Score-based resolution (precise path)
  if (leadScore !== null && config.bands.length > 0) {
    const sorted = [...config.bands].sort((a, b) => a.position - b.position);
    for (const band of sorted) {
      if (leadScore >= band.score_min && leadScore <= band.score_max) {
        return formatCaseValueBadge(band.value_min_usd, band.value_max_usd);
      }
    }
    // Score exists but no band matches — do not fall through to classification
    return null;
  }

  // Classification-based fallback (unscored lead)
  if (leadScore === null && classification && classification !== 'SPAM') {
    const fallback = config.classification_bands?.find(
      (b) => b.classification === classification,
    );
    if (fallback) {
      return formatCaseValueBadge(fallback.value_min_usd, fallback.value_max_usd);
    }
  }

  return null;
}
