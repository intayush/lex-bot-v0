/**
 * 027-platform-admin-console — tenant registration + wizard-driven onboarding
 * (US2). Reuses the existing configuration/versioning model and the SOP
 * seed/ensure machinery; introduces NO parallel config store (Constitution VIII).
 */
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { eq, and, desc } from 'drizzle-orm';
import type { WizardSubmission } from '@legal-chatbot/shared';
import { REQUIRED_WIZARD_SECTIONS } from '@legal-chatbot/shared';
import { db, schema } from '../../db/index';

/** Generate a widget API key: returns the plaintext (shown once) + bcrypt hash. */
export async function generateApiKey(): Promise<{ plaintext: string; keyHash: string }> {
  const plaintext = `lk_${nanoid(32)}`;
  const keyHash = await bcrypt.hash(plaintext, 10);
  return { plaintext, keyHash };
}

/** Which required wizard sections are still missing (FR-012). */
export function missingRequiredSections(sub: WizardSubmission): string[] {
  const missing: string[] = [];
  for (const key of REQUIRED_WIZARD_SECTIONS) {
    const val = (sub as Record<string, unknown>)[key];
    if (val == null || (Array.isArray(val) && val.length === 0)) {
      missing.push(key);
    }
  }
  return missing;
}

/**
 * Map wizard answers → a `configurationSchema`-shaped object. Pure function,
 * fully unit-testable. Sensible defaults fill anything the wizard omitted.
 */
export function buildDraftFromWizard(sub: WizardSubmission, now: string): Record<string, unknown> {
  const identity = sub.firmIdentity;
  const contact = sub.contact;
  return {
    version: 1,
    saved_at: now,
    persona: {
      firm_name: identity?.firmName ?? '',
      chatbot_name: identity?.chatbotName ?? 'Assistant',
      greeting_message: identity?.greetingMessage ?? 'Hi! How can I help you today?',
      tone: sub.persona?.tone ?? 'friendly',
      language: identity?.language ?? 'English',
    },
    out_of_scope_response:
      "I'm not able to help with that area, but I'd recommend reaching out to another attorney who specializes in it.",
    boundaries: {
      never_say: [
        'Never provide specific legal advice or legal opinions',
        'Never promise case outcomes',
        'Never discuss fees or payment structures',
      ],
    },
    escalation: {
      triggers: sub.escalation?.triggers ?? [],
      message: sub.escalation?.message ?? '',
    },
    contact: {
      phone: contact?.phone ?? '',
      // configurationSchema requires a valid email; use a placeholder for
      // partial drafts (contact is a required section before publish anyway).
      email: contact?.email ?? 'unknown@example.com',
      office_hours: contact?.officeHours ?? [],
      after_hours_message: contact?.afterHoursMessage ?? '',
    },
    custom_instructions: '',
  };
}

/**
 * Persist wizard progress. Upserts a DRAFT (is_published=false) configuration
 * row (version 1) for the account and keeps onboarding_status='draft'.
 * Returns whether the draft is ready to publish (all required sections present).
 */
export async function saveOnboardingDraft(
  accountId: string,
  submission: WizardSubmission,
  now: () => string = () => new Date().toISOString(),
): Promise<{ ready: boolean; missing: string[] }> {
  const missing = missingRequiredSections(submission);
  const ts = now();
  const draftConfig = buildDraftFromWizard(submission, ts);

  const existing = await db
    .select()
    .from(schema.configurations)
    .where(and(eq(schema.configurations.account_id, accountId), eq(schema.configurations.version, 1)));

  if (existing.length > 0) {
    await db
      .update(schema.configurations)
      .set({ config_json: JSON.stringify(draftConfig) })
      .where(eq(schema.configurations.id, existing[0].id));
  } else {
    await db.insert(schema.configurations).values({
      id: nanoid(),
      account_id: accountId,
      version: 1,
      config_json: JSON.stringify(draftConfig),
      is_published: false,
      created_at: ts,
      label: 'Onboarding draft',
    });
  }

  return { ready: missing.length === 0, missing };
}

/**
 * Finalize onboarding: ensure the SOP + default branches exist for the account.
 * Delegates to the shared seed/ensure machinery (idempotent). Kept as a thin
 * seam so route/integration tests can mock it.
 */
export async function seedSopAndBranches(accountId: string): Promise<void> {
  const { seedSopForAccount } = await import('../../db/seed');
  const { ensureContactStepForAccount } = await import('../../db/ensure-contact-step');
  const { ensureCarAccidentBranchForAccount } = await import('../../db/ensure-car-accident-branch');
  const { ensureDefaultBranchesForAccount } = await import('../../db/ensure-default-branches');
  await seedSopForAccount(accountId);
  await ensureContactStepForAccount(accountId);
  await ensureCarAccidentBranchForAccount(accountId);
  await ensureDefaultBranchesForAccount(accountId);
}

/** Publish the tenant: flip config + SOP `is_published`, set onboarding 'live'. */
export async function publishTenant(
  accountId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<{ published: boolean }> {
  const drafts = await db
    .select()
    .from(schema.configurations)
    .where(eq(schema.configurations.account_id, accountId))
    .orderBy(desc(schema.configurations.version));
  if (drafts.length === 0) {
    return { published: false };
  }

  // Publish the latest config version; unpublish older ones.
  const latest = drafts[0];
  await db
    .update(schema.configurations)
    .set({ is_published: false })
    .where(eq(schema.configurations.account_id, accountId));
  await db
    .update(schema.configurations)
    .set({ is_published: true })
    .where(eq(schema.configurations.id, latest.id));

  // Publish the latest SOP configuration if present.
  const sops = await db
    .select()
    .from(schema.sopConfigurations)
    .where(eq(schema.sopConfigurations.account_id, accountId))
    .orderBy(desc(schema.sopConfigurations.version));
  if (sops.length > 0) {
    await db
      .update(schema.sopConfigurations)
      .set({ is_published: true })
      .where(eq(schema.sopConfigurations.id, sops[0].id));
  }

  await db
    .update(schema.accounts)
    .set({ onboarding_status: 'live' })
    .where(eq(schema.accounts.id, accountId));

  void now;
  return { published: true };
}
