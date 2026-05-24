/**
 * Lead action update — testable handler (013-lead-action-tracking T012).
 *
 * Lives in a sibling file from `route.ts` because Next.js's route-file
 * compilation pass rejects exports other than recognized HTTP-verb
 * functions (lesson learned in 011-preflight-phrase). The DI seam
 * (`LeadActionDeps`) and the testable `handleLeadActionUpdate` function
 * live here; `route.ts` is the thin Next.js shell that imports both
 * and wires production deps.
 *
 * Source of truth: contracts/lead-action-route-contract.md.
 */

import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../../../../../db';
import { getAuthSession } from '../../../../../../lib/dashboard-session';
import { leadActionUpdateSchema, type LeadAction } from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// DI seam (for tests)
// ---------------------------------------------------------------------------

/**
 * Snapshot of the lead row returned by `findLeadByIdScopedToAccount`.
 * Only the fields the handler needs to confirm the lead exists +
 * belongs to the current account.
 */
export interface LeadRowSnapshot {
  id: string;
  account_id: string;
}

/**
 * Update operation result — what the DB returns after the action update.
 */
export interface LeadUpdateResult {
  id: string;
  follow_up_action: LeadAction | null;
  follow_up_action_changed_at: string | null;
}

/**
 * Collaborators the handler depends on. The exported `POST` in
 * `route.ts` wires the production implementations; tests pass mocks
 * via `handleLeadActionUpdate(req, params, deps)`.
 */
export interface LeadActionDeps {
  /** Returns the iron-session payload; check `session.accountId` for auth. */
  getAuthSession: () => Promise<{ accountId?: string }>;
  /**
   * Look up a lead by `id` AND `account_id`. Returns null when the lead
   * doesn't exist OR is owned by a different account. The single-shot
   * scoped query is the privacy-critical primitive (research.md R4):
   * the handler treats both cases identically as 404, never leaking
   * which case occurred.
   */
  findLeadByIdScopedToAccount: (input: {
    leadId: string;
    accountId: string;
  }) => Promise<LeadRowSnapshot | null>;
  /**
   * Apply the action update + timestamp to the lead row. Both fields
   * cleared when `action` is null (action and changedAt both null).
   */
  updateLeadAction: (input: {
    leadId: string;
    action: LeadAction | null;
    changedAt: string | null;
  }) => Promise<LeadUpdateResult>;
  /** Injectable clock for deterministic timestamps in tests. */
  now: () => Date;
}

// Production implementations of the DI hooks.
// `dashboard-session` and `db` are imported at module-load time so the
// production deps form a constant; tests pass their own deps.

const findLeadByIdScopedToAccountProd: LeadActionDeps['findLeadByIdScopedToAccount'] = async (
  { leadId, accountId },
) => {
  const rows = await db
    .select({ id: schema.leads.id, account_id: schema.leads.account_id })
    .from(schema.leads)
    .where(and(eq(schema.leads.id, leadId), eq(schema.leads.account_id, accountId)))
    .limit(1);
  return rows[0] ?? null;
};

const updateLeadActionProd: LeadActionDeps['updateLeadAction'] = async (
  { leadId, action, changedAt },
) => {
  const rows = await db
    .update(schema.leads)
    .set({
      follow_up_action: action,
      follow_up_action_changed_at: changedAt,
    })
    .where(eq(schema.leads.id, leadId))
    .returning({
      id: schema.leads.id,
      follow_up_action: schema.leads.follow_up_action,
      follow_up_action_changed_at: schema.leads.follow_up_action_changed_at,
    });
  if (!rows[0]) {
    throw new Error(`updateLeadAction: lead ${leadId} not found after auth check (race?)`);
  }
  return {
    id: rows[0].id,
    follow_up_action: rows[0].follow_up_action as LeadAction | null,
    follow_up_action_changed_at: rows[0].follow_up_action_changed_at,
  };
};

export const PRODUCTION_DEPS: LeadActionDeps = {
  getAuthSession,
  findLeadByIdScopedToAccount: findLeadByIdScopedToAccountProd,
  updateLeadAction: updateLeadActionProd,
  now: () => new Date(),
};

// ---------------------------------------------------------------------------
// Pure handler (testable)
// ---------------------------------------------------------------------------

/**
 * Update a lead's follow-up action.
 *
 * Order of operations:
 *   1. Auth: iron-session must have an `accountId`.
 *   2. Body parse + Zod validate.
 *   3. Lookup the lead scoped to the session's account (404 if not found
 *      or cross-account — privacy preserves indistinguishability).
 *   4. Apply the update, including clearing the timestamp when action is null.
 *   5. Return 200 with the updated values.
 */
export async function handleLeadActionUpdate(
  req: Request,
  params: { id: string },
  deps: LeadActionDeps,
): Promise<Response> {
  // --- Auth ----------------------------------------------------------------
  const session = await deps.getAuthSession();
  if (!session.accountId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Not authenticated' },
      { status: 401 },
    );
  }

  // --- Body parse + Zod ---------------------------------------------------
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'bad_request', message: 'Invalid JSON body.' },
      { status: 400 },
    );
  }
  const parsed = leadActionUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'bad_request',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      },
      { status: 400 },
    );
  }
  const { action } = parsed.data;

  // --- Lookup lead (account-scoped; 404 covers both not-exist and cross-account) -
  const lead = await deps.findLeadByIdScopedToAccount({
    leadId: params.id,
    accountId: session.accountId,
  });
  if (!lead) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // --- Apply the update ---------------------------------------------------
  const changedAt = action === null ? null : deps.now().toISOString();
  const result = await deps.updateLeadAction({
    leadId: lead.id,
    action,
    changedAt,
  });

  return NextResponse.json(
    {
      success: true,
      follow_up_action: result.follow_up_action,
      follow_up_action_changed_at: result.follow_up_action_changed_at,
    },
    { status: 200 },
  );
}
