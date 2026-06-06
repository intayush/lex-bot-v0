/**
 * Score → classification mapping helpers (spec 015).
 *
 * Pure functions, no I/O. Two concerns:
 *
 * 1. `scoreToClassification` — translates a numeric score to its
 *    4-value classification using the appropriate threshold table from
 *    a scoring config. Used by `scoreLead`. Per FR-006, FR-038, FR-039,
 *    FR-040.
 *
 * 2. `legacyClassificationToNew` — translates a pre-015 classification
 *    value (`urgent` / `normal` / `unqualified`) to the new vocabulary.
 *    Used by the legacy-data migration in `0003_*.sql` (where the
 *    rewrite is a SQL UPDATE) and by any post-migration code that
 *    encounters a legacy value defensively. Per FR-031.
 */
import type {
  LeadClassification,
  LeadRequestType,
  ScoringConfig,
} from '@legal-chatbot/shared';

/**
 * Map a numeric score to a classification using the appropriate
 * threshold table from the scoring config. Inclusive bounds; ties on
 * a boundary land in the higher classification (FR-040).
 *
 * Defaults to the Self table when `requestType` is null per FR-006
 * fallback ("Self" is the higher-fidelity table; defaulting to it
 * preserves COLD as a possible value).
 *
 * Buckets are guaranteed contiguous and non-overlapping by
 * `scoringConfigSchema` validation, so the search order doesn't
 * matter functionally — but we go highest-to-lowest for clarity.
 */
export function scoreToClassification(
  score: number,
  requestType: LeadRequestType | null,
  config: ScoringConfig,
): LeadClassification {
  // Family/Friend: 3 buckets (HOT, WARM, SPAM — no COLD).
  if (requestType === 'FRIEND_FAMILY') {
    const t = config.thresholds_family_friend;
    if (score >= t.hot[0] && score <= t.hot[1]) return 'HOT';
    if (score >= t.warm[0] && score <= t.warm[1]) return 'WARM';
    if (score >= t.spam[0] && score <= t.spam[1]) return 'SPAM';
    return 'SPAM'; // Defensive; unreachable when buckets cover [0,100].
  }

  // Self (default when requestType is null per FR-006 fallback): 4 buckets.
  const t = config.thresholds_self;
  if (score >= t.hot[0] && score <= t.hot[1]) return 'HOT';
  if (score >= t.warm[0] && score <= t.warm[1]) return 'WARM';
  if (score >= t.cold[0] && score <= t.cold[1]) return 'COLD';
  if (score >= t.spam[0] && score <= t.spam[1]) return 'SPAM';
  return 'SPAM'; // Defensive.
}

/**
 * Map a legacy 3-value classification to the new 4-value vocabulary
 * per FR-031. The mapping is fixed:
 *   urgent      → HOT
 *   normal      → WARM
 *   unqualified → SPAM
 *
 * The legacy 3-value vocabulary has no analog for COLD (which is a
 * net-new bucket in 015); legacy data therefore never lands in COLD
 * post-migration.
 *
 * Returns `null` for any input that is neither a legacy value nor a
 * new-vocabulary value (defensive). Idempotent on already-migrated
 * values: passes new-vocabulary inputs through unchanged so the
 * helper is safe to call from defensive read paths even after the
 * migration has run.
 */
export function legacyClassificationToNew(
  value: string,
): LeadClassification | null {
  switch (value) {
    case 'urgent':
      return 'HOT';
    case 'normal':
      return 'WARM';
    case 'unqualified':
      return 'SPAM';
    case 'HOT':
    case 'WARM':
    case 'COLD':
    case 'SPAM':
      return value;
    default:
      return null;
  }
}
