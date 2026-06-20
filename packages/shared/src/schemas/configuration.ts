import { z } from 'zod';

export const toneSchema = z.enum(['formal', 'friendly', 'neutral']);

export const personaSchema = z.object({
  firm_name: z.string(),
  chatbot_name: z.string(),
  greeting_message: z.string(),
  tone: toneSchema,
  language: z.string().default('English'),
});

export const practiceAreasSchema = z.object({
  active: z.array(z.string()).min(1),
  custom: z.array(z.string()).default([]),
  out_of_scope_response: z.string(),
});

/**
 * @deprecated Use SOP via 010-sop-workflow. Lawyer-defined intake questions
 * are now expressed as `sop_steps` rows under an `sop_configurations` row;
 * see `packages/shared/src/schemas/sop.ts`. The legacy
 * `qualifying_questions` field on `Configuration` remains readable so the
 * one-shot lazy migration (R11) can convert each entry into a custom SOP
 * step on first dashboard load. Do NOT add new code that reads this shape.
 */
export const qualifyingQuestionSchema = z.object({
  question: z.string(),
  required: z.boolean().default(true),
  order: z.number().int(),
});

export const boundariesSchema = z.object({
  never_say: z.array(z.string()),
});

export const escalationSchema = z.object({
  triggers: z.array(z.string()),
  message: z.string(),
});

export const officeHoursSchema = z.object({
  day: z.string(),
  open: z.string(),
  close: z.string(),
});

export const contactSchema = z.object({
  phone: z.string(),
  email: z.string().email(),
  office_hours: z.array(officeHoursSchema),
  after_hours_message: z.string(),
});

/**
 * Visual theme for the chat widget (bubble + panel + chips + buttons).
 *
 * `primary_bg` is the paintable surface — may be a solid CSS color
 * OR a CSS gradient (any `background-image`-compatible value:
 * `linear-gradient(...)`, `radial-gradient(...)`, etc.). Used by
 * the widget for buttons, chip hover state, the floating bubble,
 * and the user-message bubble background.
 *
 * `primary_color` MUST be a solid color (no gradients). Used for
 * borders, text foreground, and outlines — places where CSS
 * doesn't accept a gradient. When the host sets a gradient
 * `primary_bg`, they must also set a representative solid
 * `primary_color` so border/outline treatments still paint.
 *
 * `id` is a stable identifier for the chosen preset (`'default'`,
 * `'sunset'`, etc.) so the dashboard can highlight the active
 * swatch on reload. Custom themes use `'custom'`.
 *
 * `null` / absent on the configuration falls back to the
 * indigo defaults shipped in `packages/widget/src/styles/panel.css`.
 */
export const themeSchema = z.object({
  id: z.string().min(1).max(64),
  primary_bg: z.string().min(1).max(512),
  primary_color: z.string().min(1).max(64),
});

export const configurationSchema = z.object({
  version: z.number().int(),
  saved_at: z.string(),
  persona: personaSchema,
  /**
   * Out-of-scope deflection message. Promoted from
   * `practice_areas.out_of_scope_response` (019-remove-practice-areas).
   * Old stored rows without this field default to empty string; the
   * read-time migration in `lib/config.ts` backfills it from the
   * nested path for accounts that haven't re-saved yet.
   */
  out_of_scope_response: z.string().default(''),
  /** @deprecated Use SOP Case Types for in-scope area management (019-remove-practice-areas). */
  practice_areas: practiceAreasSchema.optional(),
  /** @deprecated Use SOP via 010-sop-workflow. No longer written by the UI. Kept optional for backwards compatibility with stored config rows. */
  qualifying_questions: z.array(qualifyingQuestionSchema).optional(),
  boundaries: boundariesSchema,
  escalation: escalationSchema,
  contact: contactSchema,
  custom_instructions: z.string().default(''),
  /**
   * Optional widget theme. Absent on legacy rows; new rows persisted
   * via the dashboard's theme picker carry it. Consumed by
   * /api/config and cascaded into the widget via inline CSS
   * variables on `ChatPanel`'s wrapper.
   */
  theme: themeSchema.nullable().optional(),
});

export type Tone = z.infer<typeof toneSchema>;
export type Persona = z.infer<typeof personaSchema>;
export type PracticeAreas = z.infer<typeof practiceAreasSchema>;
export type QualifyingQuestion = z.infer<typeof qualifyingQuestionSchema>;
export type Boundaries = z.infer<typeof boundariesSchema>;
export type Escalation = z.infer<typeof escalationSchema>;
export type OfficeHours = z.infer<typeof officeHoursSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type Configuration = z.infer<typeof configurationSchema>;
