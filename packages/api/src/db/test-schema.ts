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
  status: text('status').notNull().default('new'),
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
