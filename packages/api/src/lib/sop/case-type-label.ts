/**
 * Pure helper for the 014-fix-sop-case-subtypes feature.
 *
 * Resolves a captured case-type slug to its current human-readable label
 * by looking it up in the firm's `case_types` catalog. Used by the chat
 * route's `buildSOPStateHeader` (T020) and by `composeSopBlock`'s
 * question-text interpolation (T019) so the visitor never sees the raw
 * `{case_type}` placeholder.
 *
 * No I/O. Returns `null` when the slug is `null` or no matching case
 * type exists (e.g., the case type was deleted between conversation
 * turns).
 */
import type { CaseType } from '@legal-chatbot/shared';

export function resolveCaseTypeLabel(
  slug: string | null,
  caseTypes: CaseType[],
): string | null {
  if (slug === null) return null;
  const match = caseTypes.find((ct) => ct.slug === slug);
  return match?.label ?? null;
}
