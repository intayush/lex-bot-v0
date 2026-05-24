/**
 * Test-only SQLite schema that mirrors the production PostgreSQL schema.
 * Used by test mocks to create in-memory SQLite databases.
 * Boolean columns use integer (0/1) since SQLite has no native boolean.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  firm_name: text('firm_name'),
  created_at: text('created_at').notNull(),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  key_hash: text('key_hash').notNull(),
  label: text('label'),
  context_store_url: text('context_store_url').notNull(),
  created_at: text('created_at').notNull(),
  revoked_at: text('revoked_at'),
});

export const configurations = sqliteTable('configurations', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  version: integer('version').notNull(),
  config_json: text('config_json').notNull(),
  is_published: integer('is_published', { mode: 'boolean' }).notNull().default(false),
  created_at: text('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  messages_json: text('messages_json').notNull().default('[]'),
  is_preview: integer('is_preview', { mode: 'boolean' }).notNull().default(false),
  /** SOP runtime state (010-sop-workflow). JSON-serialized SOPState. */
  sop_state_json: text('sop_state_json'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const leads = sqliteTable('leads', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  session_id: text('session_id').notNull().references(() => sessions.id),
  name: text('name'),
  contact_email: text('contact_email'),
  contact_phone: text('contact_phone'),
  case_type: text('case_type'),
  incident_date: text('incident_date'),
  brief_description: text('brief_description'),
  classification: text('classification').notNull(),
  classification_rationale: text('classification_rationale'),
  urgency_factors_json: text('urgency_factors_json'),
  /** SOP snapshot (010-sop-workflow). JSON-serialized SOPState. */
  sop_state_snapshot: text('sop_state_snapshot'),
  status: text('status').notNull().default('new'),
  /** Lawyer-recorded follow-up action (013-lead-action-tracking). */
  follow_up_action: text('follow_up_action'),
  /** ISO 8601 timestamp of the most recent follow_up_action change. */
  follow_up_action_changed_at: text('follow_up_action_changed_at'),
  created_at: text('created_at').notNull(),
});

export const archivedData = sqliteTable('archived_data', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull(),
  original_table: text('original_table').notNull(),
  original_id: text('original_id').notNull(),
  data_json: text('data_json').notNull(),
  deleted_by_user_at: text('deleted_by_user_at').notNull(),
  archived_at: text('archived_at').notNull(),
});

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  lead_id: text('lead_id').references(() => leads.id),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  delivery_channel: text('delivery_channel').notNull().default('dashboard'),
  delivered_at: text('delivered_at'),
  created_at: text('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// SOP Workflow tables (010-sop-workflow) — SQLite mirror for tests
// ---------------------------------------------------------------------------

export const sopConfigurations = sqliteTable('sop_configurations', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  version: integer('version').notNull(),
  qualified_lead_threshold: integer('qualified_lead_threshold').notNull().default(5),
  is_published: integer('is_published', { mode: 'boolean' }).notNull().default(false),
  derived_from_legacy: integer('derived_from_legacy', { mode: 'boolean' }).notNull().default(false),
  created_at: text('created_at').notNull(),
});

export const sopSteps = sqliteTable('sop_steps', {
  id: text('id').primaryKey(),
  sop_configuration_id: text('sop_configuration_id').notNull().references(() => sopConfigurations.id),
  position: integer('position').notNull(),
  slug: text('slug').notNull(),
  question_text: text('question_text').notNull(),
  chip_source: text('chip_source'),
  inline_chips_json: text('inline_chips_json'),
  accepts_free_text: integer('accepts_free_text', { mode: 'boolean' }).notNull().default(true),
  is_required: integer('is_required', { mode: 'boolean' }).notNull().default(true),
  counts_toward_threshold: integer('counts_toward_threshold', { mode: 'boolean' }).notNull().default(true),
  is_default: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  skip_condition_json: text('skip_condition_json'),
});

export const caseTypes = sqliteTable('case_types', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
  is_in_scope: integer('is_in_scope', { mode: 'boolean' }).notNull().default(true),
  created_at: text('created_at').notNull(),
});

export const subTypes = sqliteTable('sub_types', {
  id: text('id').primaryKey(),
  case_type_id: text('case_type_id').notNull().references(() => caseTypes.id),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
  created_at: text('created_at').notNull(),
});

export const goodbyePhrases = sqliteTable('goodbye_phrases', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  phrase: text('phrase').notNull(),
  created_at: text('created_at').notNull(),
});
