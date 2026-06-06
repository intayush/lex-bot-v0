/**
 * Parameter schemas for the chat-route's LLM tools. Extracted to a
 * sibling module so unit tests can import the schemas directly
 * (Next.js route.ts files reject non-route exports per their
 * generated type constraint, so this lives here instead).
 */
import { z } from 'zod';

/**
 * Parameter schema for the `captureLead` LLM tool.
 *
 * The `classification` enum was migrated from legacy 3-value
 * (urgent / normal / unqualified) to the 4-value spec-015 vocabulary
 * (HOT / WARM / COLD / SPAM). The LLM emits this value for sub_types
 * WITHOUT scoring config; for sub_types with scoring config the
 * value is ignored and the rule-based scorer's classification wins.
 *
 * Per spec 015 contracts/lead-classification-enum.md §Producers
 * item 2.
 */
export const captureLeadToolParams = z.object({
  name: z
    .string()
    .nullish()
    .describe('Visitor name or null/omit if not provided'),
  contactEmail: z
    .string()
    .nullish()
    .describe('Email address or null/omit'),
  contactPhone: z
    .string()
    .nullish()
    .describe('Phone number or null/omit'),
  caseType: z
    .string()
    .nullish()
    .describe('Type of legal matter (e.g. Personal Injury, Family Law)'),
  incidentDate: z
    .string()
    .nullish()
    .describe('When the issue arose, ISO date format if possible'),
  briefDescription: z
    .string()
    .describe('One-sentence summary of their legal matter'),
  classification: z
    .enum(['HOT', 'WARM', 'COLD', 'SPAM'])
    .describe(
      'Lead classification. HOT = imminent legal urgency (recent arrest/charges, statute of limitations <30 days, active danger, immediate help needed). WARM = legitimate matter, motivated prospect, no immediate time pressure. COLD = legitimate matter, low motivation signals or unclear urgency. SPAM = outside firm practice areas, no actionable legal issue, no contact info, or test/junk submission.',
    ),
  classificationRationale: z
    .string()
    .describe('Brief explanation for why this classification was chosen'),
  urgencyFactors: z
    .array(z.string())
    .describe('List of urgency indicators found, empty array if none'),
});
