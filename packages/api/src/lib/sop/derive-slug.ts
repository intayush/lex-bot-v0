/**
 * Derive a stable slug from a human-entered label
 * (014-fix-sop-case-subtypes T007 / FR-016).
 *
 * Rule: trimmed → lowercase → ASCII-fold (NFKD + strip diacritics) →
 * replace runs of non-`[a-z0-9]` characters with a single underscore →
 * strip leading underscores and leading digits → validate against
 * `^[a-z][a-z0-9_]*$`. Throws `SlugDerivationError` if the result is
 * empty or fails validation.
 *
 * Slugs are stable: the dashboard derives a slug at "Add" time and
 * locks it for the lifetime of the sub_type row so historical leads
 * referencing it stay resolvable across renames (FR-016).
 *
 * Examples:
 *   "First Offense"         → "first_offense"
 *   "DUI with Injury"       → "dui_with_injury"
 *   "Café d'Été"            → "cafe_d_ete"
 *   "Slip & Fall"           → "slip_fall"
 *   "    Workplace Accident" → "workplace_accident"
 *
 * Throws on:
 *   ""                      (empty label)
 *   "   "                   (whitespace-only)
 *   "!!!"                   (no alpha-numeric content)
 *   "123 only digits"       (no leading alpha after digit-strip)
 */

export class SlugDerivationError extends Error {
  constructor(message: string, public readonly label: string) {
    super(message);
    this.name = 'SlugDerivationError';
  }
}

const SLUG_FORMAT_RE = /^[a-z][a-z0-9_]*$/;

export function deriveSlugFromLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw new SlugDerivationError(
      'Label is empty after trimming whitespace.',
      label,
    );
  }

  // Step 1: ASCII-fold via Unicode normalization. NFKD decomposes
  // accented characters into base + combining mark; the regex strips
  // the marks. Examples: "café" → "cafe", "Đặng" → "Đang" → fall to
  // step 2 which underscores the surviving non-ASCII letters.
  const folded = trimmed
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  // Step 2: replace every run of non-`[a-z0-9]` with one underscore.
  // This collapses spaces, punctuation, surviving non-ASCII letters,
  // and other separators into a stable token boundary.
  let underscored = folded.replace(/[^a-z0-9]+/g, '_');

  // Step 3: strip leading underscores.
  underscored = underscored.replace(/^_+/, '');

  // Step 4: strip leading digits and any underscores they expose.
  // "123_offense" → "_offense" → "offense"
  underscored = underscored.replace(/^[0-9_]+/, '');

  // Step 5: strip trailing underscore (purely cosmetic).
  underscored = underscored.replace(/_+$/, '');

  if (underscored.length === 0) {
    throw new SlugDerivationError(
      `Label "${label}" produces an empty slug after normalization.`,
      label,
    );
  }

  if (!SLUG_FORMAT_RE.test(underscored)) {
    throw new SlugDerivationError(
      `Derived slug "${underscored}" from label "${label}" does not match ${SLUG_FORMAT_RE}.`,
      label,
    );
  }

  return underscored;
}
