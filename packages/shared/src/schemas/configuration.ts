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

export const configurationSchema = z.object({
  version: z.number().int(),
  saved_at: z.string(),
  persona: personaSchema,
  practice_areas: practiceAreasSchema,
  qualifying_questions: z.array(qualifyingQuestionSchema),
  boundaries: boundariesSchema,
  escalation: escalationSchema,
  contact: contactSchema,
  custom_instructions: z.string().default(''),
});

export type Tone = z.infer<typeof toneSchema>;
export type Persona = z.infer<typeof personaSchema>;
export type PracticeAreas = z.infer<typeof practiceAreasSchema>;
export type QualifyingQuestion = z.infer<typeof qualifyingQuestionSchema>;
export type Boundaries = z.infer<typeof boundariesSchema>;
export type Escalation = z.infer<typeof escalationSchema>;
export type OfficeHours = z.infer<typeof officeHoursSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type Configuration = z.infer<typeof configurationSchema>;
