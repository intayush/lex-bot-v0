import { z } from 'zod';
import { llmProviderSchema } from './llm-config.js';

/**
 * 027-platform-admin-console — boundary schemas for the super-admin console.
 */

// --- Auth ---

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

// --- Tenant lifecycle ---

export const tenantStatusSchema = z.enum(['active', 'suspended']);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const onboardingStatusSchema = z.enum(['draft', 'published', 'live']);
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;

/** Body for POST /api/admin/tenants (register). */
export const registerTenantSchema = z.object({
  email: z.string().email(),
  firmName: z.string().min(1),
});
export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;

/** Body for PATCH /api/admin/tenants/[id]/status. */
export const setTenantStatusSchema = z.object({
  status: tenantStatusSchema,
});
export type SetTenantStatusInput = z.infer<typeof setTenantStatusSchema>;

// --- Fleet overview / detail DTOs ---

export const tenantSummarySchema = z.object({
  accountId: z.string(),
  firmName: z.string().nullable(),
  email: z.string(),
  status: tenantStatusSchema,
  onboardingStatus: onboardingStatusSchema,
  leadCount30d: z.number().int(),
  estimatedSpend30d: z.number(),
  lastActivityAt: z.string().nullable(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

// --- Onboarding wizard submission ---

export const wizardSubmissionSchema = z.object({
  firmIdentity: z.object({
    firmName: z.string().min(1),
    chatbotName: z.string().min(1),
    email: z.string().email(),
    domain: z.string().min(1),
  }).optional(),
  caseTypeSelection: z.array(z.object({
    caseTypeSlug: z.string().min(1),
    subTypeSlugs: z.array(z.string().min(1)).default([]),
  })).optional(),
  attorneys: z.array(z.object({
    name: z.string().min(1),
    email: z.string().email(),
    mobile: z.string().nullable().optional(),
    subTypeAssignments: z.array(z.object({
      caseTypeSlug: z.string().min(1),
      subTypeSlug: z.string().min(1),
    })).default([]),
  })).optional().default([]),
  finish: z.boolean().optional(),
});
export type WizardSubmission = z.infer<typeof wizardSubmissionSchema>;

/** Fields that must be present before a wizard may `finish` (FR-012). */
export const REQUIRED_WIZARD_SECTIONS = ['firmIdentity', 'caseTypeSelection'] as const;

// --- Metrics DTO ---

export const metricsWindowSchema = z.enum(['7d', '30d', '90d']).default('30d');
export type MetricsWindow = z.infer<typeof metricsWindowSchema>;

export const tenantMetricsSchema = z.object({
  window: metricsWindowSchema,
  funnel: z.object({
    conversationsStarted: z.number().int(),
    leadsCaptured: z.number().int(),
    breakdown: z.object({
      HOT: z.number().int(),
      WARM: z.number().int(),
      COLD: z.number().int(),
      SPAM: z.number().int(),
    }),
    conversionRate: z.number(),
  }),
  usageCost: z.object({
    conversationVolume: z.array(z.object({ date: z.string(), count: z.number().int() })),
    avgMessagesPerConversation: z.number(),
    tokens: z.object({
      prompt: z.number().int(),
      completion: z.number().int(),
      total: z.number().int(),
    }),
    estimatedSpend: z.number(),
    byProviderModel: z.array(
      z.object({
        provider: llmProviderSchema,
        model: z.string(),
        totalTokens: z.number().int(),
        estimatedSpend: z.number(),
      }),
    ),
  }),
  routing: z.object({
    hotLeadsRouted: z.number().int(),
    emailsDispatched: z.number().int(),
    followUpActions: z.object({
      contacted: z.number().int(),
      call_no_answer: z.number().int(),
      meeting_fixed: z.number().int(),
      none: z.number().int(),
    }),
  }),
});
export type TenantMetrics = z.infer<typeof tenantMetricsSchema>;
