import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import * as schema from './schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const db = drizzle(sql, { schema });

async function seed() {
  // Clear existing data for idempotent re-runs
  // Order matters due to foreign keys
  await db.delete(schema.notifications);
  await db.delete(schema.leads);
  await db.delete(schema.sessions);
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
      active: ['Criminal Defense', 'DUI Defense', 'Drug Crimes', 'Assault Charges', 'Sex Crimes', 'Theft Charges', 'Gun Crimes', 'Federal Crimes', 'Fraud', 'Arson & Burglary'],
      custom: [],
      out_of_scope_response: "Our firm focuses exclusively on criminal defense and DUI law. I'm not able to help with that area, but I'd recommend reaching out to another attorney who specializes in that practice area. If you have a criminal matter, I'm happy to help — call Attorney David Shrager directly at 412-969-2540.",
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

  console.log('Seed complete.');
  console.log(`  Account: dev@legalchatbot.com / password123`);
  console.log(`  API Key: dev_test_key`);
  console.log(`  Context Store: ${process.env.CONTEXT_STORE_URL || 'http://localhost:5173/chatbot-context/'}`);
}

seed();
