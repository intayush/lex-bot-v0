import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import * as schema from './schema.js';
import {
  DEFAULT_SOP_STEPS,
  DEFAULT_CASE_TYPES,
  DEFAULT_GOODBYE_PHRASES,
  DEFAULT_QUALIFIED_LEAD_THRESHOLD,
  CAR_ACCIDENT_BRANCH_HARD_OVERRIDES_JSON,
  CAR_ACCIDENT_BRANCH_QUESTIONS_JSON,
  CAR_ACCIDENT_BRANCH_THRESHOLDS_JSON,
} from './seed-defaults/sop.js';
import { DEFAULT_BRANCH_SEEDS } from './seed-defaults/branches.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const db = drizzle(sql, { schema });

/**
 * Seed the default SOP, case types, sub-types, and goodbye phrases for a
 * given account. Idempotent: if the account already has any
 * `sop_configurations` row, this function exits early without inserting.
 *
 * Per FR-004 and R1: shipped with every fresh account; lazy migration
 * helper for legacy accounts is in `migrate-legacy-qualifying-questions.ts`
 * (T071).
 */
export async function seedSopForAccount(accountId: string): Promise<void> {
  const existing = await db
    .select({ id: schema.sopConfigurations.id })
    .from(schema.sopConfigurations)
    .where(eq(schema.sopConfigurations.account_id, accountId));
  if (existing.length > 0) {
    console.log(`  SOP already seeded for account ${accountId}; skipping.`);
    return;
  }

  const now = new Date().toISOString();
  const sopConfigId = nanoid();

  // 1. SOP configuration row
  await db.insert(schema.sopConfigurations).values({
    id: sopConfigId,
    account_id: accountId,
    version: 1,
    qualified_lead_threshold: DEFAULT_QUALIFIED_LEAD_THRESHOLD,
    is_published: true,
    derived_from_legacy: false,
    created_at: now,
  });

  // 2. SOP step rows (5 default steps)
  for (const step of DEFAULT_SOP_STEPS) {
    await db.insert(schema.sopSteps).values({
      id: nanoid(),
      sop_configuration_id: sopConfigId,
      ...step,
    });
  }

  // 3. Case types (6) + sub-types (≥3 each)
  for (const ct of DEFAULT_CASE_TYPES) {
    const caseTypeId = nanoid();
    await db.insert(schema.caseTypes).values({
      id: caseTypeId,
      account_id: accountId,
      slug: ct.slug,
      label: ct.label,
      position: ct.position,
      is_in_scope: ct.is_in_scope,
      created_at: now,
    });
    for (const st of ct.sub_types) {
      await db.insert(schema.subTypes).values({
        id: nanoid(),
        case_type_id: caseTypeId,
        slug: st.slug,
        label: st.label,
        position: st.position,
        created_at: now,
      });
    }
  }

  // 4. Goodbye phrases
  for (const phrase of DEFAULT_GOODBYE_PHRASES) {
    await db.insert(schema.goodbyePhrases).values({
      id: nanoid(),
      account_id: accountId,
      phrase,
      created_at: now,
    });
  }

  // 5. Spec 016 — seed the (personal_injury, car_accident) Branch with the
  // 9 scoring questions, thresholds, and hard-override toggles relocated
  // from spec 015 (FR-016).
  const branchId = nanoid();
  const versionId = nanoid();
  await db.insert(schema.branches).values({
    id: branchId,
    account_id: accountId,
    case_type_slug: 'personal_injury',
    sub_type_slug: 'car_accident',
    is_active: true,
    current_version_id: versionId,
    created_at: now,
    updated_at: now,
  });
  await db.insert(schema.branchVersions).values({
    id: versionId,
    branch_id: branchId,
    version_number: 1,
    is_published: true,
    questions_json: CAR_ACCIDENT_BRANCH_QUESTIONS_JSON,
    classification_thresholds_json: CAR_ACCIDENT_BRANCH_THRESHOLDS_JSON,
    hard_override_toggles_json: CAR_ACCIDENT_BRANCH_HARD_OVERRIDES_JSON,
    published_at: now,
    created_at: now,
    created_by_user_id: 'system_seed_016',
  });

  // 6. Seed every other default sub-type's Branch (spec 017 follow-up —
  // expansion beyond the car_accident reference). Family Law and Estate
  // Planning are intentionally excluded from this batch; their seed entries
  // are absent from `DEFAULT_BRANCH_SEEDS`. See `seed-defaults/branches.ts`.
  for (const seed of DEFAULT_BRANCH_SEEDS) {
    const seededBranchId = nanoid();
    const seededVersionId = nanoid();
    await db.insert(schema.branches).values({
      id: seededBranchId,
      account_id: accountId,
      case_type_slug: seed.case_type_slug,
      sub_type_slug: seed.sub_type_slug,
      is_active: true,
      current_version_id: seededVersionId,
      created_at: now,
      updated_at: now,
    });
    await db.insert(schema.branchVersions).values({
      id: seededVersionId,
      branch_id: seededBranchId,
      version_number: 1,
      is_published: true,
      questions_json: seed.questions_json,
      classification_thresholds_json: seed.classification_thresholds_json,
      hard_override_toggles_json: seed.hard_override_toggles_json,
      published_at: now,
      created_at: now,
      created_by_user_id: 'system_seed_017',
    });
  }

  const subTypeCount = DEFAULT_CASE_TYPES.reduce((acc, ct) => acc + ct.sub_types.length, 0);
  console.log(
    `  SOP seeded for account ${accountId}: ` +
    `1 config, ${DEFAULT_SOP_STEPS.length} steps, ` +
    `${DEFAULT_CASE_TYPES.length} case types, ${subTypeCount} sub-types, ` +
    `${DEFAULT_GOODBYE_PHRASES.length} goodbye phrases, ` +
    `${1 + DEFAULT_BRANCH_SEEDS.length} branches ` +
    `(1 car-accident reference + ${DEFAULT_BRANCH_SEEDS.length} default sub-type branches).`,
  );
}

async function seed() {
  // Clear existing data for idempotent re-runs
  // Order matters due to foreign keys
  await db.delete(schema.branchVersions);
  await db.delete(schema.branches);
  await db.delete(schema.notifications);
  await db.delete(schema.leads);
  await db.delete(schema.sessions);
  await db.delete(schema.subTypes);
  await db.delete(schema.caseTypes);
  await db.delete(schema.goodbyePhrases);
  await db.delete(schema.sopSteps);
  await db.delete(schema.sopConfigurations);
  await db.delete(schema.configurations);
  await db.delete(schema.apiKeys);
  await db.delete(schema.archivedData);
  await db.delete(schema.accounts);

  const accountId = nanoid();
  const apiKeyId = nanoid();
  const configId = nanoid();
  const now = new Date().toISOString();

  const passwordHash = await bcrypt.hash('password123', 10);

  await db.insert(schema.accounts).values({
    id: accountId,
    email: 'dev@legalchatbot.com',
    password_hash: passwordHash,
    firm_name: 'Shrager Defense Attorneys',
    created_at: now,
  });

  const keyHash = await bcrypt.hash('dev_test_key', 10);

  await db.insert(schema.apiKeys).values({
    id: apiKeyId,
    account_id: accountId,
    key_hash: keyHash,
    label: 'Development',
    context_store_url: process.env.CONTEXT_STORE_URL || 'http://localhost:5173/chatbot-context/',
    created_at: now,
  });

  const config = {
    version: 1,
    saved_at: now,
    persona: {
      firm_name: 'Shrager Defense Attorneys',
      chatbot_name: 'Alex',
      greeting_message: "Hi! I'm Alex, a virtual assistant for Shrager Defense Attorneys in Pittsburgh. Whether you're facing criminal charges, a DUI, or need legal guidance, I'm here to help. How can I assist you today?",
      tone: 'friendly',
      language: 'English',
    },
    practice_areas: {
      // Spec 016 alignment: the widget's initial greeting chips render
      // from this list. It MUST overlap with the seeded `case_types`
      // labels (DUI, Criminal Defense, Personal Injury, Family Law,
      // Drug Crime, Estate Planning) so visitors can land on the
      // configured Car Accident branch directly from the chip
      // selection.
      active: [
        'DUI',
        'Criminal Defense',
        'Personal Injury',
        'Family Law',
        'Drug Crime',
        'Estate Planning',
        'Assault Charges',
        'Sex Crimes',
        'Theft Charges',
        'Gun Crimes',
        'Federal Crimes',
        'Fraud',
      ],
      custom: [],
      out_of_scope_response: "I'm not able to help with that area, but I'd recommend reaching out to another attorney who specializes in that practice area. If you have a criminal-defense, DUI, personal-injury, or family-law matter, I'm happy to help — call Attorney David Shrager directly at 412-969-2540.",
    },
    qualifying_questions: [
      { question: 'What type of criminal charges are you facing, or what happened?', required: true, order: 1 },
      { question: 'When were you charged or when did the incident occur?', required: true, order: 2 },
      { question: 'In which county were you charged (e.g., Allegheny, Beaver, Westmoreland)?', required: true, order: 3 },
      { question: 'What is your name and best way to reach you?', required: true, order: 4 },
      { question: 'Have you already had a preliminary hearing or arraignment?', required: false, order: 5 },
    ],
    boundaries: {
      never_say: [
        'Never provide specific legal advice or legal opinions',
        'Never promise case outcomes or guarantee charges will be dismissed',
        'Never discuss fees or payment structures',
        'Never disclose information about other clients or cases',
        'Never recommend against hiring an attorney',
      ],
    },
    escalation: {
      triggers: [
        'User mentions active danger to themselves or others',
        'User says they have a court date within the next 48 hours',
        'User says they are currently being detained or arrested',
        'User asks for a human representative',
        'User expresses repeated frustration with the chatbot',
      ],
      message: 'I want to make sure you get help right away. Please call Attorney David Shrager directly at 412-969-2540 — he personally answers calls and texts 24/7. If this is a life-threatening emergency, please call 911.',
    },
    contact: {
      phone: '412-969-2540',
      email: 'info@shragerdefense.com',
      office_hours: [
        { day: 'Monday', open: '24/7', close: '24/7' },
        { day: 'Tuesday', open: '24/7', close: '24/7' },
        { day: 'Wednesday', open: '24/7', close: '24/7' },
        { day: 'Thursday', open: '24/7', close: '24/7' },
        { day: 'Friday', open: '24/7', close: '24/7' },
        { day: 'Saturday', open: '24/7', close: '24/7' },
        { day: 'Sunday', open: '24/7', close: '24/7' },
      ],
      after_hours_message: 'Attorney David Shrager is available 24/7. Call or text 412-969-2540 any time for a free and confidential consultation.',
    },
    custom_instructions: 'Always emphasize that consultations are free and confidential.\nMention that Attorney David Shrager personally answers calls 24/7.\nThe firm has been in Pittsburgh since 1967 (over 50 years).\nDavid Shrager has 25+ years of experience and is recognized by Super Lawyers.\nThe firm is located in the Frick Building in downtown Pittsburgh, across from the Allegheny County Courthouse.\nUse the motto "Don\'t Be Scared; Be Prepared!" when appropriate.',
  };

  await db.insert(schema.configurations).values({
    id: configId,
    account_id: accountId,
    version: 1,
    config_json: JSON.stringify(config),
    is_published: true,
    created_at: now,
  });

  // Seed default SOP, case types, sub-types, goodbye phrases (010-sop-workflow R1)
  await seedSopForAccount(accountId);

  console.log('Seed complete.');
  console.log(`  Account: dev@legalchatbot.com / password123`);
  console.log(`  API Key: dev_test_key`);
  console.log(`  Context Store: ${process.env.CONTEXT_STORE_URL || 'http://localhost:5173/chatbot-context/'}`);
}

// CLI invocation guard. Only runs `seed()` when this file is the
// process entry point (`tsx src/db/seed.ts`). Importing
// `seedSopForAccount` from another module MUST NOT destructively
// reseed the DB — earlier versions had no guard and any consumer
// that re-exported a sibling module triggered a full wipe.
if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
}
