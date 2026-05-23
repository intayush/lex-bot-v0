/**
 * Idempotent migration to add the contact-form step (position 6) to any
 * existing default SOP that doesn't yet have one. Bumps the SOP's
 * qualified_lead_threshold from 5 to 6 so the contact step's capture
 * marks the lead as complete.
 *
 * Safe to run multiple times. Skips accounts whose SOP already has a
 * contact_form step (idempotent by design).
 *
 * Background: pre-existing dev/prod accounts were seeded with the
 * original 5-step default SOP (case_type, sub_type, where, what, when).
 * The lawyer-described UX now requires a 6th step that captures
 * name + phone/email via input fields rendered in the chat panel —
 * defining when the lead is complete. Running db:seed would wipe data;
 * this migration adds the step in place.
 */
import { db, schema } from '../db';
import { eq, and, sql as drizzleSql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { DEFAULT_QUALIFIED_LEAD_THRESHOLD } from './seed-defaults/sop';

interface MigrationResult {
  account_id: string;
  outcome: 'inserted' | 'skipped_already_present' | 'no_published_sop';
}

export async function ensureContactStepForAllAccounts(): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];

  const accounts = await db.select({ id: schema.accounts.id }).from(schema.accounts);
  for (const acct of accounts) {
    const r = await ensureContactStepForAccount(acct.id);
    results.push(r);
  }
  return results;
}

export async function ensureContactStepForAccount(accountId: string): Promise<MigrationResult> {
  // Find the published SOP for the account.
  const cfgRows = await db
    .select()
    .from(schema.sopConfigurations)
    .where(
      and(
        eq(schema.sopConfigurations.account_id, accountId),
        eq(schema.sopConfigurations.is_published, true),
      ),
    )
    .limit(1);
  const cfgRow = cfgRows[0];
  if (!cfgRow) return { account_id: accountId, outcome: 'no_published_sop' };

  // Already has a contact_form step?
  const existing = await db
    .select()
    .from(schema.sopSteps)
    .where(
      and(
        eq(schema.sopSteps.sop_configuration_id, cfgRow.id),
        eq(schema.sopSteps.chip_source, 'contact_form'),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return { account_id: accountId, outcome: 'skipped_already_present' };
  }

  // Find the highest existing position so we can insert AFTER it.
  const maxPosRows = await db
    .select({ max: drizzleSql<number>`MAX(${schema.sopSteps.position})` })
    .from(schema.sopSteps)
    .where(eq(schema.sopSteps.sop_configuration_id, cfgRow.id));
  const nextPosition = (maxPosRows[0]?.max ?? 0) + 1;

  // Insert the contact step.
  await db.insert(schema.sopSteps).values({
    id: nanoid(),
    sop_configuration_id: cfgRow.id,
    position: nextPosition,
    slug: 'contact',
    question_text: 'Last step — please share your contact info so we can follow up.',
    chip_source: 'contact_form',
    inline_chips_json: null,
    accepts_free_text: false,
    is_required: true,
    counts_toward_threshold: true,
    is_default: true,
    skip_condition_json: null,
  });

  // Bump the threshold to match the default (6 in the default SOP).
  // For non-default SOPs (lawyer-customized) we only bump if their
  // current threshold equals their step count BEFORE the contact-step
  // insert (i.e., they had every step counting); otherwise we leave the
  // threshold alone — they may have a custom rule.
  const stepCountAfter = nextPosition; // since we just inserted at nextPosition
  const newThreshold =
    cfgRow.qualified_lead_threshold === stepCountAfter - 1
      ? stepCountAfter
      : Math.max(cfgRow.qualified_lead_threshold, DEFAULT_QUALIFIED_LEAD_THRESHOLD);

  if (newThreshold !== cfgRow.qualified_lead_threshold) {
    await db
      .update(schema.sopConfigurations)
      .set({ qualified_lead_threshold: newThreshold })
      .where(eq(schema.sopConfigurations.id, cfgRow.id));
  }

  return { account_id: accountId, outcome: 'inserted' };
}

// CLI entry point — `tsx ensure-contact-step.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureContactStepForAllAccounts()
    .then((results) => {
      for (const r of results) console.log(`  ${r.account_id}: ${r.outcome}`);
      console.log(`Migration complete (${results.length} accounts processed).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
