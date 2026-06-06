import { pgTable, text, integer, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  password_hash: text('password_hash').notNull(),
  firm_name: text('firm_name'),
  created_at: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('accounts_email_unique').on(table.email),
]);

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  key_hash: text('key_hash').notNull(),
  label: text('label'),
  context_store_url: text('context_store_url').notNull(),
  created_at: text('created_at').notNull(),
  revoked_at: text('revoked_at'),
});

export const configurations = pgTable('configurations', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  version: integer('version').notNull(),
  config_json: text('config_json').notNull(),
  is_published: boolean('is_published').notNull().default(false),
  created_at: text('created_at').notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  messages_json: text('messages_json').notNull().default('[]'),
  is_preview: boolean('is_preview').notNull().default(false),
  /**
   * SOP Workflow runtime state (010-sop-workflow). JSON-serialized SOPState
   * per `packages/shared/src/schemas/sop.ts → sopStateSchema`. Null for
   * sessions that predate SOP support or whose runtime hasn't initialized
   * state yet.
   */
  sop_state_json: text('sop_state_json'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const leads = pgTable('leads', {
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
  /**
   * SOP Workflow snapshot (010-sop-workflow). Set at SOP finalization or
   * out-of-scope termination. JSON-serialized SOPState per
   * `packages/shared/src/schemas/sop.ts → sopStateSchema`.
   */
  sop_state_snapshot: text('sop_state_snapshot'),
  status: text('status').notNull().default('new'),
  /**
   * Lawyer-recorded follow-up action (013-lead-action-tracking). One of
   * `'contacted'`, `'call_no_answer'`, `'meeting_fixed'`, or null
   * (default — no action yet). Independent of `classification` (LLM-set,
   * immutable) and `status` (system state). Validated app-side via
   * `leadActionEnum` from `@legal-chatbot/shared`.
   */
  follow_up_action: text('follow_up_action'),
  /**
   * ISO 8601 timestamp of the most recent follow_up_action change.
   * Set to the current time on every action change; cleared to null
   * when the action is cleared. Most-recent only — no history log
   * (out of scope for v1 per spec.md).
   */
  follow_up_action_changed_at: text('follow_up_action_changed_at'),
  /**
   * Numeric lead score in `[0, 100]` inclusive when set; NULL when
   * the lead was scored by the LLM fallback path, the partial-lead
   * heuristic, the legacy migration, or when the rule-based scorer
   * threw at finalization (FR-010b safe-default capture). Spec 015.
   */
  lead_score: integer('lead_score'),
  /**
   * JSON-encoded array of human-readable reason phrases. NULL for
   * unscored leads. Special sentinel `'["scoring_error"]'` flags a
   * scorer-failure capture per FR-010b. Spec 015.
   */
  score_reasons_json: text('score_reasons_json'),
  /**
   * Captured request-type metadata from the new SOP step. One of
   * `'SELF'` or `'FRIEND_FAMILY'`; NULL on legacy / fallback paths
   * where the question was not asked. Selects which
   * classification-threshold table the scorer applies. Spec 015 FR-014.
   */
  request_type: text('request_type'),
  /**
   * Captured geographic-qualification metadata. One of
   * `'IN_SERVICE_AREA'` or `'OUTSIDE_SERVICE_AREA'`; NULL when not
   * asked. Spec 015 FR-015.
   */
  geographic_qualification: text('geographic_qualification'),
  /**
   * JSON-encoded `{ city, state }` populated only when
   * `geographic_qualification = 'OUTSIDE_SERVICE_AREA'`. Spec 015 FR-015.
   */
  geographic_qualification_details_json: text('geographic_qualification_details_json'),
  created_at: text('created_at').notNull(),
});

export const archivedData = pgTable('archived_data', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull(),
  original_table: text('original_table').notNull(),
  original_id: text('original_id').notNull(),
  data_json: text('data_json').notNull(),
  deleted_by_user_at: text('deleted_by_user_at').notNull(),
  archived_at: text('archived_at').notNull(),
});

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  lead_id: text('lead_id').references(() => leads.id),
  read: boolean('read').notNull().default(false),
  delivery_channel: text('delivery_channel').notNull().default('dashboard'),
  delivered_at: text('delivered_at'),
  created_at: text('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// SOP Workflow tables (010-sop-workflow)
// See specs/010-sop-workflow/data-model.md
// ---------------------------------------------------------------------------

/**
 * Per-account SOP configurations. Versioned; only one row per account has
 * is_published=true at any time.
 */
export const sopConfigurations = pgTable('sop_configurations', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  version: integer('version').notNull(),
  qualified_lead_threshold: integer('qualified_lead_threshold').notNull().default(5),
  is_published: boolean('is_published').notNull().default(false),
  derived_from_legacy: boolean('derived_from_legacy').notNull().default(false),
  created_at: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('sop_configurations_account_version_unique').on(table.account_id, table.version),
]);

/**
 * Ordered SOP steps under a configuration. Position uniqueness is enforced
 * at the application layer via transactional reorder; Drizzle expresses the
 * intended uniqueness via a deferred-friendly composite index.
 */
export const sopSteps = pgTable('sop_steps', {
  id: text('id').primaryKey(),
  sop_configuration_id: text('sop_configuration_id').notNull().references(() => sopConfigurations.id),
  position: integer('position').notNull(),
  slug: text('slug').notNull(),
  question_text: text('question_text').notNull(),
  /** 'case_types' | 'sub_types' | 'inline' | null */
  chip_source: text('chip_source'),
  /** JSON-serialized array of `{ label, slug }` when chip_source = 'inline'. */
  inline_chips_json: text('inline_chips_json'),
  accepts_free_text: boolean('accepts_free_text').notNull().default(true),
  is_required: boolean('is_required').notNull().default(true),
  counts_toward_threshold: boolean('counts_toward_threshold').notNull().default(true),
  is_default: boolean('is_default').notNull().default(false),
  /** Reserved for advanced skip rules (post-MVP). */
  skip_condition_json: text('skip_condition_json'),
  /**
   * When set, this step only fires for visitors whose captured
   * `sub_type` slug matches this value. NULL means "always fires"
   * (the default for the existing 6 default steps). Used by spec
   * 015 to scope the 9 new car-accident scoring steps to
   * `'car_accident'`. Filtered at runtime in `nextPendingStep`
   * (research.md §R2). Spec 015.
   */
  applies_when_sub_type_slug: text('applies_when_sub_type_slug'),
}, (table) => [
  uniqueIndex('sop_steps_config_slug_unique').on(table.sop_configuration_id, table.slug),
]);

/**
 * Per-account configurable case-type list. Source for the case-type chip step.
 */
export const caseTypes = pgTable('case_types', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
  is_in_scope: boolean('is_in_scope').notNull().default(true),
  created_at: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('case_types_account_slug_unique').on(table.account_id, table.slug),
]);

/**
 * Per-case-type configurable sub-type list.
 */
export const subTypes = pgTable('sub_types', {
  id: text('id').primaryKey(),
  case_type_id: text('case_type_id').notNull().references(() => caseTypes.id),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
  /**
   * Per-sub_type lead-classification scoring configuration.
   * JSON-encoded `ScoringConfig` (see
   * `packages/shared/src/schemas/sop.ts → scoringConfigSchema` and
   * `specs/015-lead-classification-revamp/contracts/scoring-config.md`).
   * NULL means "no scoring configuration; fall through to the LLM
   * classifier" (FR-022). Validated by Zod at every boundary read /
   * write. Spec 015.
   */
  scoring_config_json: text('scoring_config_json'),
  created_at: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('sub_types_case_type_slug_unique').on(table.case_type_id, table.slug),
]);

/**
 * Per-account configurable list of phrases that, when said by the visitor,
 * trigger the bot's polite closing message.
 */
export const goodbyePhrases = pgTable('goodbye_phrases', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  phrase: text('phrase').notNull(),
  created_at: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('goodbye_phrases_account_phrase_unique').on(table.account_id, table.phrase),
]);
