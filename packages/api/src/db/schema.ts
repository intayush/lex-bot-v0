import { pgTable, text, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  password_hash: text('password_hash').notNull(),
  firm_name: text('firm_name'),
  created_at: text('created_at').notNull(),
  /** 027-platform-admin-console: lifecycle status. 'active' | 'suspended'. */
  status: text('status').notNull().default('active'),
  /** 027: onboarding progress. 'draft' | 'published' | 'live'. Existing rows default 'live'. */
  onboarding_status: text('onboarding_status').notNull().default('live'),
  /** 027: soft-delete marker (ISO string). NULL = active fleet member. */
  deleted_at: text('deleted_at'),
  /** 027 onboarding-redesign: website domain where the widget is deployed. Display-only. */
  domain: text('domain'),
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
  label: text('label'),
}, (table) => [
  uniqueIndex('configurations_account_version_unique').on(table.account_id, table.version),
]);

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
  /**
   * Undo stack (2026-07-04 conversation rollback). JSON-encoded
   * SOPStateHistory (max 10 snapshots) per
   * `packages/shared/src/schemas/sop.ts → sopStateHistorySchema`.
   * Each entry captures state ENTERING a turn so undo can restore it.
   * Null for sessions that predate this feature.
   */
  sop_state_history_json: text('sop_state_history_json'),
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
  /**
   * Spec 016 multi-branch SOP. JSON-encoded `BranchSnapshot` (see
   * `packages/shared/src/schemas/branch.ts → branchSnapshotSchema`)
   * frozen at lead finalization or at session-end abandonment per
   * FR-018 / FR-011a. NULL for default-only leads (no branch fired).
   * Validated via `branchSnapshotSchema` at every boundary so this
   * column stays a plain `text | null` here.
   */
  branch_snapshot_json: text('branch_snapshot_json'),
  /**
   * Spec 016 multi-branch SOP. Sibling boolean for fast filter
   * queries (FR-011b). `true` for partial-branch leads written by the
   * session-end finalizer per FR-011a; `false` for completed-branch
   * leads and for default-only leads. Mirrors the
   * `branch_incomplete` field inside `branch_snapshot_json`.
   */
  branch_incomplete: boolean('branch_incomplete').notNull().default(false),
  created_at: text('created_at').notNull(),
  /**
   * ISO 8601 timestamp set ONLY by revertLastTurn (conversation undo) when
   * the creating turn of a lead was undone. Marks a lead whose conversation
   * turn was rolled back. Such leads are hidden from the dashboard list.
   * Not used for normal re-submissions (re-capturing a lead in the same session).
   */
  reverted_at: text('reverted_at'),
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
  /**
   * 024-attorney-routing: FK to the specific attorney this email-channel
   * notification is addressed to. NULL for dashboard-channel rows.
   */
  attorney_id: text('attorney_id'),
});

// ---------------------------------------------------------------------------
// 024-attorney-routing: attorney roster + case type assignments
// ---------------------------------------------------------------------------

export const attorneys = pgTable('attorneys', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(),
  email: text('email').notNull(),
  mobile: text('mobile'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('attorneys_account_email_unique').on(table.account_id, table.email),
]);

export const attorneyCaseTypeAssignments = pgTable('attorney_case_type_assignments', {
  id: text('id').primaryKey(),
  attorney_id: text('attorney_id').notNull().references(() => attorneys.id, { onDelete: 'cascade' }),
  account_id: text('account_id').notNull().references(() => accounts.id),
  case_type_slug: text('case_type_slug').notNull(),
  /** 027 onboarding-redesign: optional sub-type scope. NULL = whole case type. */
  sub_type_slug: text('sub_type_slug'),
  created_at: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('attorney_assignment_unique').on(table.attorney_id, table.case_type_slug, table.sub_type_slug),
]);

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
  label: text('label'),
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
   * @deprecated Spec 016 multi-branch SOP supersedes spec 015's
   * per-sub-type scoring config. New runtime code MUST read scoring
   * data from the `branches` / `branchVersions` tables below. This
   * column is preserved for backwards compatibility of historical
   * lead rendering and for migration safety; drop is a follow-up
   * cleanup migration (research.md R2).
   *
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

// ---------------------------------------------------------------------------
// Spec 016 — Multi-Branch SOP Workflow
// ---------------------------------------------------------------------------

/**
 * A configurable per-(case_type_slug, sub_type_slug) workflow that
 * fires AFTER the default SOP's Step 6 (contact) satisfies. At most
 * one ACTIVE branch may exist per pair (FR-009).
 *
 * Per-account scoping uses `account_id` (consistent with `case_types`
 * and `sub_types`); the slug-pair lookup is by string match — not a
 * hard FK to those rows — so admins can rename slugs without
 * cascading branch deletions. The runtime resolves slugs to live
 * `case_types` / `sub_types` rows at lookup time.
 *
 * `current_version_id` points at the published `branch_versions` row
 * in effect for new conversations. NULL when only drafts exist.
 * In-flight conversations pin to the version ID resolved at branch
 * activation (FR-031, research.md R7).
 */
export const branches = pgTable('branches', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  case_type_slug: text('case_type_slug').notNull(),
  sub_type_slug: text('sub_type_slug').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  /**
   * 025-case-value-estimator: case-type-level on/off toggle.
   * When false, no value badge is shown for leads of this branch.
   * Separate from the versioned config so toggling off doesn't lose bands.
   */
  is_case_value_enabled: boolean('is_case_value_enabled').notNull().default(false),
  /**
   * FK is declared as a plain text column without a hard reference
   * to `branch_versions.id` to break the circular dependency
   * (branches → branch_versions → branches). The migration's data
   * copy and the application code maintain referential integrity.
   */
  current_version_id: text('current_version_id'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('branches_account_pair_unique').on(
    table.account_id,
    table.case_type_slug,
    table.sub_type_slug,
  ),
  index('branches_account_idx').on(table.account_id),
]);

/**
 * Immutable snapshot of a Branch's full configuration. Each Save
 * creates a new row; Publish flips one row's `is_published` to true
 * (and the parent's `current_version_id`). All other fields are
 * write-once. In-flight conversations load the row by id (R7).
 */
export const branchVersions = pgTable('branch_versions', {
  id: text('id').primaryKey(),
  branch_id: text('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  version_number: integer('version_number').notNull(),
  is_published: boolean('is_published').notNull().default(false),
  /** JSON-encoded `BranchQuestion[]`; validated via `branchQuestionSchema[]`. */
  questions_json: text('questions_json').notNull(),
  /** JSON-encoded `{ self, family_friend }`; validated via threshold schemas. */
  classification_thresholds_json: text('classification_thresholds_json').notNull(),
  /** JSON-encoded `HardOverridesEnabled`. */
  hard_override_toggles_json: text('hard_override_toggles_json').notNull(),
  /**
   * 025-case-value-estimator: optional JSON-encoded `CaseValueConfig`.
   * Null when case value estimation is not configured for this version.
   */
  case_value_config_json: text('case_value_config_json'),
  published_at: text('published_at'),
  created_at: text('created_at').notNull(),
  created_by_user_id: text('created_by_user_id').notNull(),
}, (table) => [
  uniqueIndex('branch_versions_branch_version_unique').on(
    table.branch_id,
    table.version_number,
  ),
  index('branch_versions_branch_idx').on(table.branch_id),
]);

// ---------------------------------------------------------------------------
// 027-platform-admin-console
// ---------------------------------------------------------------------------

/** Platform operator identity — separate from `accounts` (Constitution VIII). */
export const superAdmins = pgTable('super_admins', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  password_hash: text('password_hash').notNull(),
  created_at: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('super_admins_email_unique').on(table.email),
]);

/** Per-tenant LLM provider/model/key. Absent row => platform default. */
export const accountLlmConfig = pgTable('account_llm_config', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  /** 'google' | 'anthropic' | 'openai' (validated by Zod at the boundary). */
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  /** AES-256-GCM `iv:tag:ciphertext` (base64). NULL => use platform key. */
  api_key_encrypted: text('api_key_encrypted'),
  is_active: boolean('is_active').notNull().default(true),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('account_llm_config_account_unique').on(table.account_id),
]);

/** Per-conversation token usage for metrics + cost attribution (Constitution VI). */
export const usageEvents = pgTable('usage_events', {
  id: text('id').primaryKey(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  session_id: text('session_id'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  prompt_tokens: integer('prompt_tokens').notNull().default(0),
  completion_tokens: integer('completion_tokens').notNull().default(0),
  total_tokens: integer('total_tokens').notNull().default(0),
  created_at: text('created_at').notNull(),
}, (table) => [
  index('usage_events_account_idx').on(table.account_id),
  index('usage_events_created_idx').on(table.created_at),
]);

/** Attribution for every mutating admin action (Constitution VIII). */
export const adminAuditLog = pgTable('admin_audit_log', {
  id: text('id').primaryKey(),
  super_admin_id: text('super_admin_id').notNull().references(() => superAdmins.id),
  action: text('action').notNull(),
  target_account_id: text('target_account_id'),
  metadata_json: text('metadata_json'),
  created_at: text('created_at').notNull(),
}, (table) => [
  index('admin_audit_log_created_idx').on(table.created_at),
]);
