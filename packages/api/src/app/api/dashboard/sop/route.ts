/**
 * Dashboard SOP Route Handler (`/api/dashboard/sop`).
 *
 * Implements:
 *   GET  → return current published SOP + version history.
 *   POST { action: 'save', qualified_lead_threshold, steps[] }
 *        → insert new draft sop_configurations row + sop_steps rows.
 *   POST { action: 'publish' }
 *        → flip is_published exclusively to the latest version.
 *   POST { action: 'rollback', version_id }
 *        → copy a historical version's steps into a new draft version.
 *
 * Transactionality note: the Neon-HTTP driver in use does not support
 * `db.transaction(...)`, so the multi-row writes here are sequential.
 * Failure mode: if a step INSERT fails after the configuration INSERT
 * succeeded, the orphaned configuration row stays in the table with
 * `is_published=false` and no published flag is touched — the next save
 * supersedes it. The Route Handler is best-effort idempotent.
 *
 * Source of truth: contracts/sop-config-routes-contract.md.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { eq, and, desc, asc } from 'drizzle-orm';
import { db, schema } from '../../../../db';
import { getAuthSession } from '../../../../lib/dashboard-session';
import { getPublishedSOP } from '../../../../lib/sop-config';
import { invalidateSystemPromptCache } from '../../../../lib/system-prompt-cache';
import {
  validateSopStepStructure,
  validateThreshold,
  type SopStepDraft,
} from '../../../../lib/sop/sop-config-validation';

// ---------------------------------------------------------------------------
// Body schema
// ---------------------------------------------------------------------------

const stepDraftSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be lowercase snake_case'),
  position: z.number().int().positive(),
  question_text: z.string().min(1).max(500),
  // contact_form is supported (T037 enhancement) in addition to the contract's three values.
  chip_source: z.enum(['case_types', 'sub_types', 'inline', 'contact_form']).nullable(),
  inline_chips_json: z.string().nullable(),
  accepts_free_text: z.boolean(),
  is_required: z.boolean(),
  counts_toward_threshold: z.boolean(),
});

const sopActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    qualified_lead_threshold: z.number().int().positive(),
    steps: z.array(stepDraftSchema).min(1),
  }),
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('rollback'), version_id: z.string().min(1) }),
]);

// ---------------------------------------------------------------------------
// GET → current_published + history
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const accountId = session.accountId;
  const [current, allRows] = await Promise.all([
    getPublishedSOP(accountId),
    db
      .select({
        id: schema.sopConfigurations.id,
        version: schema.sopConfigurations.version,
        is_published: schema.sopConfigurations.is_published,
        created_at: schema.sopConfigurations.created_at,
      })
      .from(schema.sopConfigurations)
      .where(eq(schema.sopConfigurations.account_id, accountId))
      .orderBy(desc(schema.sopConfigurations.version))
      .limit(20),
  ]);

  return NextResponse.json({
    current_published: current,
    history: allRows,
  });
}

// ---------------------------------------------------------------------------
// POST → save | publish | rollback
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const accountId = session.accountId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = sopActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }

  if (parsed.data.action === 'save') {
    return handleSave(accountId, parsed.data);
  }
  if (parsed.data.action === 'publish') {
    return handlePublish(accountId);
  }
  return handleRollback(accountId, parsed.data.version_id);
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleSave(
  accountId: string,
  data: { qualified_lead_threshold: number; steps: SopStepDraft[] },
) {
  // Structural validation beyond Zod.
  const stepsResult = validateSopStepStructure(data.steps);
  if (!stepsResult.ok) {
    return NextResponse.json({ error: 'bad_request', message: stepsResult.error }, { status: 400 });
  }
  const thresholdResult = validateThreshold(data.qualified_lead_threshold, data.steps);
  if (!thresholdResult.ok) {
    return NextResponse.json({ error: 'bad_request', message: thresholdResult.error }, { status: 400 });
  }

  // Compute next version number.
  const maxRows = await db
    .select({ version: schema.sopConfigurations.version })
    .from(schema.sopConfigurations)
    .where(eq(schema.sopConfigurations.account_id, accountId))
    .orderBy(desc(schema.sopConfigurations.version))
    .limit(1);
  const nextVersion = (maxRows[0]?.version ?? 0) + 1;

  const newConfigId = nanoid();
  const nowIso = new Date().toISOString();

  // Insert config row.
  await db.insert(schema.sopConfigurations).values({
    id: newConfigId,
    account_id: accountId,
    version: nextVersion,
    qualified_lead_threshold: data.qualified_lead_threshold,
    is_published: false,
    derived_from_legacy: false,
    created_at: nowIso,
  });

  // Insert step rows.
  const stepRows = data.steps.map((s) => ({
    id: nanoid(),
    sop_configuration_id: newConfigId,
    position: s.position,
    slug: s.slug,
    question_text: s.question_text,
    chip_source: s.chip_source,
    inline_chips_json: s.inline_chips_json,
    accepts_free_text: s.accepts_free_text,
    is_required: s.is_required,
    counts_toward_threshold: s.counts_toward_threshold,
    is_default: false,
    skip_condition_json: null,
  }));
  if (stepRows.length > 0) {
    await db.insert(schema.sopSteps).values(stepRows);
  }

  return NextResponse.json({ success: true, version: nextVersion, config_id: newConfigId });
}

async function handlePublish(accountId: string) {
  // Find the latest version.
  const latestRows = await db
    .select()
    .from(schema.sopConfigurations)
    .where(eq(schema.sopConfigurations.account_id, accountId))
    .orderBy(desc(schema.sopConfigurations.version))
    .limit(1);
  const latest = latestRows[0];
  if (!latest) {
    return NextResponse.json(
      { error: 'bad_request', message: 'No SOP configuration to publish.' },
      { status: 400 },
    );
  }

  // Unpublish all.
  await db
    .update(schema.sopConfigurations)
    .set({ is_published: false })
    .where(eq(schema.sopConfigurations.account_id, accountId));

  // Publish latest.
  await db
    .update(schema.sopConfigurations)
    .set({ is_published: true })
    .where(and(eq(schema.sopConfigurations.id, latest.id)));

  // 021-chat-api-latency T020: SOP changes affect the system prompt.
  // Invalidate the prompt cache so live chats pick up the new SOP block
  // immediately. (No config-cache invalidation needed; the SOP route only
  // touches the sop_configurations table, not configurations.)
  invalidateSystemPromptCache(accountId);

  return NextResponse.json({ success: true, version: latest.version });
}

async function handleRollback(accountId: string, versionId: string) {
  // Read historical configuration; verify ownership.
  const historicalRows = await db
    .select()
    .from(schema.sopConfigurations)
    .where(
      and(
        eq(schema.sopConfigurations.id, versionId),
        eq(schema.sopConfigurations.account_id, accountId),
      ),
    )
    .limit(1);
  const historical = historicalRows[0];
  if (!historical) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const historicalSteps = await db
    .select()
    .from(schema.sopSteps)
    .where(eq(schema.sopSteps.sop_configuration_id, historical.id))
    .orderBy(asc(schema.sopSteps.position));

  // Compute next version number.
  const maxRows = await db
    .select({ version: schema.sopConfigurations.version })
    .from(schema.sopConfigurations)
    .where(eq(schema.sopConfigurations.account_id, accountId))
    .orderBy(desc(schema.sopConfigurations.version))
    .limit(1);
  const nextVersion = (maxRows[0]?.version ?? 0) + 1;

  const newConfigId = nanoid();
  const nowIso = new Date().toISOString();

  await db.insert(schema.sopConfigurations).values({
    id: newConfigId,
    account_id: accountId,
    version: nextVersion,
    qualified_lead_threshold: historical.qualified_lead_threshold,
    is_published: false,
    derived_from_legacy: historical.derived_from_legacy,
    created_at: nowIso,
  });

  if (historicalSteps.length > 0) {
    await db.insert(schema.sopSteps).values(
      historicalSteps.map((s) => ({
        id: nanoid(),
        sop_configuration_id: newConfigId,
        position: s.position,
        slug: s.slug,
        question_text: s.question_text,
        chip_source: s.chip_source,
        inline_chips_json: s.inline_chips_json,
        accepts_free_text: s.accepts_free_text,
        is_required: s.is_required,
        counts_toward_threshold: s.counts_toward_threshold,
        is_default: s.is_default,
        skip_condition_json: s.skip_condition_json,
      })),
    );
  }

  return NextResponse.json({ success: true, new_version: nextVersion, config_id: newConfigId });
}
