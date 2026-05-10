import { z } from 'zod';

export const leadClassificationSchema = z.enum(['urgent', 'normal', 'unqualified']);

export const leadStatusSchema = z.enum(['new', 'contacted', 'dismissed']);

export const leadSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  session_id: z.string(),
  name: z.string().nullable(),
  contact_email: z.string().email().nullable(),
  contact_phone: z.string().nullable(),
  case_type: z.string().nullable(),
  incident_date: z.string().nullable(),
  brief_description: z.string().nullable(),
  classification: leadClassificationSchema,
  classification_rationale: z.string().nullable(),
  urgency_factors_json: z.string().nullable(),
  status: leadStatusSchema,
  created_at: z.string(),
});

export type LeadClassification = z.infer<typeof leadClassificationSchema>;
export type LeadStatus = z.infer<typeof leadStatusSchema>;
export type Lead = z.infer<typeof leadSchema>;
