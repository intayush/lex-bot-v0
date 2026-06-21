/**
 * Pure CSV utility for branch configuration import/export (020-branch-csv-import).
 * No I/O, no DB, no HTTP — fully unit-testable.
 */
import { nanoid } from 'nanoid';
import type { BranchQuestion, CaseValueBand } from '@legal-chatbot/shared';
import { caseValueBandSchema } from '@legal-chatbot/shared';

export interface CsvError {
  /** 1-indexed row number (header = row 1, first data row = row 2). */
  row: number;
  column: string;
  message: string;
}

const REQUIRED_COLUMNS = [
  'question_position',
  'question_text',
  'free_text_allowed',
  'multi_select',
  'chip_label',
  'chip_slug',
  'score_weight',
] as const;

type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

export interface CaseValueParseResult {
  /** null when the [CASE_VALUE] section is absent (not an error). */
  caseValueEnabled: boolean | null;
  bands: CaseValueBand[];
}

type ParseResult =
  | { ok: true; questions: BranchQuestion[]; caseValueConfig: CaseValueParseResult | null }
  | { ok: false; errors: CsvError[] };

// ---------------------------------------------------------------------------
// parseAndValidateCsv
// ---------------------------------------------------------------------------

export function parseAndValidateCsv(rawCsv: string): ParseResult {
  const errors: CsvError[] = [];

  // Strip UTF-8 BOM if present.
  const csv = rawCsv.startsWith('\xEF\xBB\xBF') ? rawCsv.slice(3) : rawCsv;

  // Normalize line endings and split into all lines.
  const allLines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Split the file into the question section and the optional [CASE_VALUE] section.
  const caseValueSectionStart = allLines.findIndex((l) => l.trim() === '[CASE_VALUE]');
  const lines = caseValueSectionStart === -1 ? allLines : allLines.slice(0, caseValueSectionStart);
  const caseValueLines = caseValueSectionStart === -1 ? null : allLines.slice(caseValueSectionStart + 1);

  if (lines.length === 0) {
    return { ok: false, errors: [{ row: 1, column: 'file', message: 'The file is empty.' }] };
  }

  // Parse header row.
  const headerLine = lines[0]!;
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());

  // Validate all required columns are present.
  const missingColumns = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missingColumns.length > 0) {
    return {
      ok: false,
      errors: missingColumns.map((col) => ({
        row: 1,
        column: col,
        message: `Missing required column: ${col}`,
      })),
    };
  }

  const colIndex = (col: RequiredColumn) => headers.indexOf(col);

  // Parse data rows.
  const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);

  if (dataLines.length === 0) {
    return {
      ok: false,
      errors: [{ row: 1, column: 'file', message: 'The file contains no question rows.' }],
    };
  }

  // Group rows by question_position.
  interface RawChip {
    label: string;
    slug: string;
    scoreWeight: number;
    rowNum: number;
  }
  interface RawQuestion {
    position: number; // 1-indexed from CSV
    text: string;
    freeTextAllowed: boolean;
    multiSelect: boolean;
    chips: RawChip[];
    firstRowNum: number;
  }

  const questionMap = new Map<number, RawQuestion>();

  for (let i = 0; i < dataLines.length; i++) {
    const rowNum = i + 2; // header is row 1, first data row is row 2
    const line = dataLines[i]!;
    const cells = splitCsvRow(line).map((c) => c.trim());

    const get = (col: RequiredColumn) => cells[colIndex(col)] ?? '';

    // --- question_position ---
    const posStr = get('question_position');
    const pos = parseInt(posStr, 10);
    if (!posStr || isNaN(pos) || pos < 1 || String(pos) !== posStr.trim()) {
      errors.push({ row: rowNum, column: 'question_position', message: 'Must be a positive integer.' });
      continue;
    }

    // --- question_text ---
    const questionText = get('question_text');
    if (!questionText) {
      errors.push({ row: rowNum, column: 'question_text', message: 'Question text cannot be empty.' });
    } else if (questionText.length > 500) {
      errors.push({ row: rowNum, column: 'question_text', message: 'Question text must be 500 characters or fewer.' });
    }

    // --- free_text_allowed ---
    const ftaRaw = get('free_text_allowed').toUpperCase();
    let freeTextAllowed = false;
    if (ftaRaw !== 'YES' && ftaRaw !== 'NO') {
      errors.push({ row: rowNum, column: 'free_text_allowed', message: 'Must be YES or NO.' });
    } else {
      freeTextAllowed = ftaRaw === 'YES';
    }

    // --- multi_select ---
    const msRaw = get('multi_select').toUpperCase();
    let multiSelect = false;
    if (msRaw !== 'YES' && msRaw !== 'NO') {
      errors.push({ row: rowNum, column: 'multi_select', message: 'Must be YES or NO.' });
    } else {
      multiSelect = msRaw === 'YES';
    }

    // --- chip_label ---
    const chipLabel = get('chip_label');
    if (!chipLabel) {
      errors.push({ row: rowNum, column: 'chip_label', message: 'Chip label cannot be empty.' });
    } else if (chipLabel.length > 100) {
      errors.push({ row: rowNum, column: 'chip_label', message: 'Chip label must be 100 characters or fewer.' });
    }

    // --- chip_slug ---
    const chipSlug = get('chip_slug');
    const SLUG_REGEX = /^[a-z0-9_]+$/;
    if (!chipSlug || !SLUG_REGEX.test(chipSlug)) {
      errors.push({ row: rowNum, column: 'chip_slug', message: 'Slug must contain only lowercase letters, digits, and underscores.' });
    }

    // --- score_weight ---
    const swStr = get('score_weight');
    const sw = parseInt(swStr, 10);
    if (!swStr || isNaN(sw) || String(sw) !== swStr.trim()) {
      errors.push({ row: rowNum, column: 'score_weight', message: 'Must be an integer.' });
    } else if (sw < -50 || sw > 50) {
      errors.push({ row: rowNum, column: 'score_weight', message: 'Must be an integer between -50 and 50.' });
    }

    // If any field errors on this row, still accumulate but don't build structure.
    const rowHasErrors = errors.some((e) => e.row === rowNum);
    if (rowHasErrors) continue;

    // Accumulate into question map.
    if (!questionMap.has(pos)) {
      questionMap.set(pos, {
        position: pos,
        text: questionText,
        freeTextAllowed,
        multiSelect,
        chips: [],
        firstRowNum: rowNum,
      });
    } else {
      const existing = questionMap.get(pos)!;
      // Check that question_text, free_text_allowed, multi_select are consistent within the question block.
      if (existing.text !== questionText) {
        errors.push({ row: rowNum, column: 'question_text', message: `question_text must be identical for all rows with question_position=${pos}.` });
      }
      if (existing.freeTextAllowed !== freeTextAllowed) {
        errors.push({ row: rowNum, column: 'free_text_allowed', message: `free_text_allowed must be identical for all rows with question_position=${pos}.` });
      }
      if (existing.multiSelect !== multiSelect) {
        errors.push({ row: rowNum, column: 'multi_select', message: `multi_select must be identical for all rows with question_position=${pos}.` });
      }
    }

    // Check duplicate slug within this question.
    const q = questionMap.get(pos)!;
    if (q.chips.some((c) => c.slug === chipSlug)) {
      errors.push({ row: rowNum, column: 'chip_slug', message: `Slug "${chipSlug}" is already used in question ${pos}. Slugs must be unique within a question.` });
      continue;
    }

    q.chips.push({ label: chipLabel, slug: chipSlug, scoreWeight: sw, rowNum });
  }

  // Post-parse: validate question-level constraints.
  for (const [, q] of questionMap) {
    if (!q.freeTextAllowed && q.chips.length === 0) {
      errors.push({
        row: q.firstRowNum,
        column: 'chip_label',
        message: `Question at position ${q.position} has no chips and free_text_allowed=NO. Either add chips or set free_text_allowed=YES.`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Build BranchQuestion[] sorted by position, converting to 0-indexed.
  const questions: BranchQuestion[] = Array.from(questionMap.values())
    .sort((a, b) => a.position - b.position)
    .map((q) => ({
      id: nanoid(),
      position: q.position - 1, // 1-indexed → 0-indexed
      text: q.text,
      preface: null,
      chips: q.chips.map((c) => ({ label: c.label, slug: c.slug, score_weight: c.scoreWeight })),
      free_text_allowed: q.freeTextAllowed,
      multi_select: q.multiSelect,
    }));

  // Parse optional [CASE_VALUE] section.
  const caseValueConfig = caseValueLines ? parseCaseValueSection(caseValueLines) : null;

  return { ok: true, questions, caseValueConfig };
}

// ---------------------------------------------------------------------------
// parseCaseValueSection
// ---------------------------------------------------------------------------

/**
 * Parse the lines after `[CASE_VALUE]` into a CaseValueParseResult.
 * Expected format:
 *   case_value_enabled,YES   ← optional
 *   score_min,score_max,value_min_usd,value_max_usd   ← header row
 *   76,100,75000,250000   ← band rows
 *   ...
 */
function parseCaseValueSection(lines: string[]): CaseValueParseResult {
  const dataLines = lines.filter((l) => l.trim().length > 0 && !l.trim().startsWith('#'));

  let caseValueEnabled: boolean | null = null;
  let headerIdx = -1;
  let i = 0;

  // Look for optional case_value_enabled row.
  if (i < dataLines.length) {
    const first = dataLines[i]!.trim().toLowerCase();
    if (first.startsWith('case_value_enabled,')) {
      const val = first.split(',')[1]?.trim().toUpperCase();
      caseValueEnabled = val === 'YES' ? true : val === 'NO' ? false : null;
      i++;
    }
  }

  // Look for header row.
  if (i < dataLines.length) {
    const h = dataLines[i]!.trim().toLowerCase();
    if (h.includes('score_min') && h.includes('score_max')) {
      headerIdx = i;
      i++;
    }
  }

  if (headerIdx === -1) {
    // No header found — return with whatever enabled state we found, empty bands.
    return { caseValueEnabled, bands: [] };
  }

  const bands: CaseValueBand[] = [];
  for (; i < dataLines.length; i++) {
    const cells = dataLines[i]!.split(',').map((c) => c.trim());
    if (cells.length < 4) continue;
    const [scoreMinStr, scoreMaxStr, valueMinStr, valueMaxStr] = cells;
    const raw = {
      score_min: parseInt(scoreMinStr ?? '', 10),
      score_max: parseInt(scoreMaxStr ?? '', 10),
      value_min_usd: parseInt(valueMinStr ?? '', 10),
      value_max_usd: parseInt(valueMaxStr ?? '', 10),
      position: bands.length,
    };
    const parsed = caseValueBandSchema.safeParse(raw);
    if (parsed.success) {
      bands.push(parsed.data);
    }
    // Invalid rows are silently skipped — per spec, row-level errors are
    // reported during import validation, not during template generation.
  }

  return { caseValueEnabled, bands };
}

// ---------------------------------------------------------------------------
// generateTemplateCsv
// ---------------------------------------------------------------------------

export function generateTemplateCsv(
  caseTypeSlug: string,
  subTypeSlug: string,
  existingCaseValueConfig?: { enabled: boolean; bands: CaseValueBand[] } | null,
): string {
  // The slugs are accepted as parameters for future use (e.g., dynamic templates).
  void caseTypeSlug;
  void subTypeSlug;

  const rows = [
    REQUIRED_COLUMNS.join(','),
    // Question 1: injury role
    '1,Were you the driver or a passenger?,NO,NO,Driver,driver,10',
    '1,Were you the driver or a passenger?,NO,NO,Passenger,passenger,5',
    '1,Were you the driver or a passenger?,NO,NO,Pedestrian or Cyclist,pedestrian_cyclist,0',
    // Question 2: medical treatment
    '2,Did you receive medical treatment?,NO,NO,Yes — treated at hospital,treated_hospital,20',
    '2,Did you receive medical treatment?,NO,NO,Yes — treated by doctor,treated_doctor,15',
    '2,Did you receive medical treatment?,NO,NO,No treatment yet,no_treatment,-15',
    // Question 3: insurance contact (free text allowed)
    '3,Has an insurance company contacted you?,YES,NO,Yes,insurance_contacted,10',
    '3,Has an insurance company contacted you?,YES,NO,No,insurance_not_contacted,0',
    '3,Has an insurance company contacted you?,YES,NO,Not sure,insurance_not_sure,0',
  ];

  // Append [CASE_VALUE] section.
  rows.push('');
  rows.push('[CASE_VALUE]');
  if (existingCaseValueConfig) {
    rows.push(`case_value_enabled,${existingCaseValueConfig.enabled ? 'YES' : 'NO'}`);
    rows.push('score_min,score_max,value_min_usd,value_max_usd');
    for (const band of existingCaseValueConfig.bands) {
      rows.push(`${band.score_min},${band.score_max},${band.value_min_usd},${band.value_max_usd}`);
    }
  } else {
    rows.push('# case_value_enabled,YES');
    rows.push('# score_min,score_max,value_min_usd,value_max_usd');
    rows.push('# 76,100,75000,250000');
    rows.push('# 51,75,15000,75000');
    rows.push('# 26,50,3000,15000');
  }

  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split a CSV row respecting quoted fields.
 * Simple implementation: splits on commas, strips surrounding double-quotes.
 * Does not handle escaped quotes within fields — sufficient for this use case.
 */
function splitCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
