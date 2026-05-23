/**
 * Pure validation helpers for the dashboard SOP-save Route Handler
 * (`POST /api/dashboard/sop` action='save').
 *
 * The Route Handler's responsibilities:
 *   1. Authenticate (iron-session).
 *   2. Zod-parse the body via `sopActionSchema`.
 *   3. Run these structural checks (slug uniqueness, position contiguity,
 *      chip_source coherence, threshold within bounds).
 *   4. Insert a new sop_configurations row with version=MAX+1 and is_published=false.
 *   5. Insert sop_steps rows.
 *
 * This module contains step 3 only. Pure functions, no IO.
 *
 * Source of truth: contracts/sop-config-routes-contract.md
 */

import type { ChipSource } from '@legal-chatbot/shared';

/**
 * Step shape after Zod-parsing the SOP-save body. Mirrors the
 * `sopActionSchema.steps[]` shape from `contracts/sop-config-routes-contract.md`
 * minus DB-managed fields (id, sop_configuration_id, is_default,
 * skip_condition_json — those are set by the Route Handler).
 */
export type SopStepDraft = {
  slug: string;
  position: number;
  question_text: string;
  chip_source: ChipSource;
  inline_chips_json: string | null;
  accepts_free_text: boolean;
  is_required: boolean;
  counts_toward_threshold: boolean;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate the structural rules a Zod schema cannot express:
 *
 * - Step list is non-empty.
 * - All slugs unique within the configuration.
 * - Positions form a contiguous `1..N` range with no gaps and no duplicates.
 * - When `chip_source === 'inline'`, `inline_chips_json` is a non-null
 *   parseable JSON array of `{ label, slug }` objects.
 * - Each step is answerable: either `accepts_free_text=true` OR
 *   `chip_source !== null` (otherwise the visitor has no input mechanism).
 */
export function validateSopStepStructure(steps: readonly SopStepDraft[]): ValidationResult {
  if (steps.length === 0) {
    return { ok: false, error: 'SOP must have at least one step.' };
  }

  // Slug uniqueness.
  const slugSeen = new Set<string>();
  for (const step of steps) {
    if (slugSeen.has(step.slug)) {
      return { ok: false, error: `Duplicate slug "${step.slug}" — step slugs must be unique within an SOP.` };
    }
    slugSeen.add(step.slug);
  }

  // Position contiguity 1..N.
  const positions = steps.map((s) => s.position).sort((a, b) => a - b);
  for (let i = 0; i < positions.length; i += 1) {
    const expected = i + 1;
    if (positions[i] !== expected) {
      return {
        ok: false,
        error: `Step positions must form a contiguous 1..${steps.length} range. Got ${JSON.stringify(positions)}.`,
      };
    }
  }

  // Chip-source coherence.
  for (const step of steps) {
    if (step.chip_source === 'inline') {
      if (!step.inline_chips_json) {
        return {
          ok: false,
          error: `Step "${step.slug}" has chip_source='inline' but inline_chips_json is null.`,
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(step.inline_chips_json);
      } catch {
        return {
          ok: false,
          error: `Step "${step.slug}" has chip_source='inline' but inline_chips_json is not valid JSON.`,
        };
      }
      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          error: `Step "${step.slug}" inline_chips_json must be a JSON array.`,
        };
      }
      for (const item of parsed) {
        if (
          item === null
          || typeof item !== 'object'
          || typeof (item as { label?: unknown }).label !== 'string'
          || typeof (item as { slug?: unknown }).slug !== 'string'
        ) {
          return {
            ok: false,
            error: `Step "${step.slug}" inline_chips_json must be an array of { label, slug } objects.`,
          };
        }
      }
    }

    // Answerability.
    if (!step.accepts_free_text && step.chip_source === null) {
      return {
        ok: false,
        error: `Step "${step.slug}" is unanswerable: accepts_free_text=false and chip_source=null. Either accept free text or pick a chip_source.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Validate the qualified-lead threshold against the step list.
 *
 * Threshold MUST be:
 *   - A positive integer (≥ 1).
 *   - ≤ count of steps with `counts_toward_threshold=true`.
 *
 * Otherwise the SOP could never qualify a lead.
 */
export function validateThreshold(
  threshold: number,
  steps: readonly SopStepDraft[],
): ValidationResult {
  if (!Number.isInteger(threshold) || threshold < 1) {
    return { ok: false, error: 'qualified_lead_threshold must be a positive integer.' };
  }
  const eligible = steps.filter((s) => s.counts_toward_threshold).length;
  if (threshold > eligible) {
    return {
      ok: false,
      error: `qualified_lead_threshold (${threshold}) exceeds the number of steps with counts_toward_threshold=true (${eligible}).`,
    };
  }
  return { ok: true };
}
