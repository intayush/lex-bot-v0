/**
 * Tests for the lead action update route handler (013-lead-action-tracking T011).
 *
 * Follows the dependency-injection pattern from 011-preflight-phrase:
 * the testable handler `handleLeadActionUpdate(req, params, deps)` lives
 * in a sibling `handler.ts`; tests stub all collaborators (session
 * provider + DB read + DB write) via the `LeadActionDeps` interface so
 * no DB or HTTP roundtrip is needed.
 *
 * Tests cover ALL paths from contracts/lead-action-route-contract.md:
 *   - 200 happy paths (each of 3 action slugs + null clears the action)
 *   - 401 when iron-session is missing or invalid
 *   - 404 when lead id doesn't exist
 *   - 404 when lead exists but lead.account_id !== session.accountId
 *     (the cross-account guard — privacy-critical per Constitution V)
 *   - 400 when body fails Zod (missing field, invalid enum, non-object)
 *   - Response body shape: { success, follow_up_action,
 *     follow_up_action_changed_at }
 *   - Timestamp is ISO when action non-null; null when action cleared
 */
import { describe, it, expect, vi } from 'vitest';
import {
  handleLeadActionUpdate,
  type LeadActionDeps,
  type LeadRowSnapshot,
} from './handler';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/dashboard/leads/lead_test/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SAMPLE_LEAD: LeadRowSnapshot = {
  id: 'lead_test',
  account_id: 'acct_test',
};

function makeDeps(overrides: Partial<LeadActionDeps> = {}): LeadActionDeps {
  return {
    getAuthSession: vi.fn().mockResolvedValue({ accountId: 'acct_test' }),
    findLeadByIdScopedToAccount: vi.fn().mockResolvedValue(SAMPLE_LEAD),
    updateLeadAction: vi.fn().mockImplementation(
      async ({ leadId, action, changedAt }) => {
        // Echo back whatever the caller asked to set so the handler can
        // include it in the response body.
        return { id: leadId, follow_up_action: action, follow_up_action_changed_at: changedAt };
      },
    ),
    now: () => new Date('2026-05-24T14:14:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 200 happy paths
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/leads/[id]/action — 200 happy paths', () => {
  it.each(['contacted', 'call_no_answer', 'meeting_fixed'] as const)(
    'returns 200 when action is %s',
    async (action) => {
      const deps = makeDeps();
      const res = await handleLeadActionUpdate(
        makeRequest({ action }),
        { id: 'lead_test' },
        deps,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.follow_up_action).toBe(action);
      expect(body.follow_up_action_changed_at).toBe('2026-05-24T14:14:00.000Z');
    },
  );

  it('returns 200 with both fields null when action is null (clear)', async () => {
    const deps = makeDeps();
    const res = await handleLeadActionUpdate(
      makeRequest({ action: null }),
      { id: 'lead_test' },
      deps,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.follow_up_action).toBeNull();
    expect(body.follow_up_action_changed_at).toBeNull();
  });

  it('passes the correct args to updateLeadAction on a non-null update', async () => {
    const deps = makeDeps();
    await handleLeadActionUpdate(
      makeRequest({ action: 'contacted' }),
      { id: 'lead_test' },
      deps,
    );
    expect(deps.updateLeadAction).toHaveBeenCalledWith({
      leadId: 'lead_test',
      action: 'contacted',
      changedAt: '2026-05-24T14:14:00.000Z',
    });
  });

  it('passes null timestamp to updateLeadAction when clearing', async () => {
    const deps = makeDeps();
    await handleLeadActionUpdate(
      makeRequest({ action: null }),
      { id: 'lead_test' },
      deps,
    );
    expect(deps.updateLeadAction).toHaveBeenCalledWith({
      leadId: 'lead_test',
      action: null,
      changedAt: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 401 unauthorized
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/leads/[id]/action — 401 unauthorized', () => {
  it('returns 401 when iron-session is missing', async () => {
    const deps = makeDeps({
      getAuthSession: vi.fn().mockResolvedValue({}),  // no accountId
    });
    const res = await handleLeadActionUpdate(
      makeRequest({ action: 'contacted' }),
      { id: 'lead_test' },
      deps,
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('does not call findLeadByIdScopedToAccount when unauthorized', async () => {
    const deps = makeDeps({
      getAuthSession: vi.fn().mockResolvedValue({}),
    });
    await handleLeadActionUpdate(
      makeRequest({ action: 'contacted' }),
      { id: 'lead_test' },
      deps,
    );
    expect(deps.findLeadByIdScopedToAccount).not.toHaveBeenCalled();
    expect(deps.updateLeadAction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 404 not_found (or cross-account)
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/leads/[id]/action — 404 not_found', () => {
  it('returns 404 when the lead does not exist', async () => {
    const deps = makeDeps({
      findLeadByIdScopedToAccount: vi.fn().mockResolvedValue(null),
    });
    const res = await handleLeadActionUpdate(
      makeRequest({ action: 'contacted' }),
      { id: 'nonexistent_id' },
      deps,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });

  it('returns 404 when the lead exists but is owned by a different account (cross-account guard)', async () => {
    // The findLeadByIdScopedToAccount helper should ALREADY return null
    // when the lead's account_id doesn't match. This test asserts that
    // the handler treats that case identically to "lead doesn't exist"
    // — i.e., does not leak via different status code or message.
    const deps = makeDeps({
      // Even though session.accountId is 'acct_test', the cross-account
      // helper returns null because the lead's actual account is 'acct_other'.
      findLeadByIdScopedToAccount: vi.fn().mockResolvedValue(null),
    });
    const res = await handleLeadActionUpdate(
      makeRequest({ action: 'contacted' }),
      { id: 'lead_owned_by_other_account' },
      deps,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
    // Privacy invariant: response body should NOT carry any data about
    // the lead's actual existence or its real owner. (The mocked
    // helper returns null in both cases; this test documents the
    // invariant.)
    expect(body).not.toHaveProperty('account_id');
    expect(body).not.toHaveProperty('lead_id');
  });

  it('does not call updateLeadAction when the lead is not found', async () => {
    const deps = makeDeps({
      findLeadByIdScopedToAccount: vi.fn().mockResolvedValue(null),
    });
    await handleLeadActionUpdate(
      makeRequest({ action: 'contacted' }),
      { id: 'nonexistent' },
      deps,
    );
    expect(deps.updateLeadAction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 400 bad_request
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/leads/[id]/action — 400 bad_request', () => {
  it('returns 400 when action field is missing', async () => {
    const deps = makeDeps();
    const res = await handleLeadActionUpdate(
      makeRequest({}),
      { id: 'lead_test' },
      deps,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('bad_request');
  });

  it('returns 400 when action is an unknown slug', async () => {
    const deps = makeDeps();
    const res = await handleLeadActionUpdate(
      makeRequest({ action: 'invalid_slug' }),
      { id: 'lead_test' },
      deps,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('bad_request');
  });

  it('returns 400 when body is malformed JSON', async () => {
    const deps = makeDeps();
    const malformed = new Request('http://localhost:3000/api/dashboard/leads/lead_test/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    const res = await handleLeadActionUpdate(malformed, { id: 'lead_test' }, deps);
    expect(res.status).toBe(400);
  });

  it('returns 400 when action is undefined explicitly (must use null to clear)', async () => {
    const deps = makeDeps();
    const res = await handleLeadActionUpdate(
      makeRequest({ action: undefined }),
      { id: 'lead_test' },
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('does not call findLeadByIdScopedToAccount when body fails Zod', async () => {
    const deps = makeDeps();
    await handleLeadActionUpdate(
      makeRequest({ action: 'invalid' }),
      { id: 'lead_test' },
      deps,
    );
    expect(deps.findLeadByIdScopedToAccount).not.toHaveBeenCalled();
    expect(deps.updateLeadAction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Response shape invariants
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/leads/[id]/action — response shape', () => {
  it('200 response always has success=true field', async () => {
    const deps = makeDeps();
    const res = await handleLeadActionUpdate(
      makeRequest({ action: 'contacted' }),
      { id: 'lead_test' },
      deps,
    );
    const body = await res.json();
    expect(body).toHaveProperty('success', true);
  });

  it('200 response always has follow_up_action field (even when null)', async () => {
    const deps = makeDeps();
    const res = await handleLeadActionUpdate(
      makeRequest({ action: null }),
      { id: 'lead_test' },
      deps,
    );
    const body = await res.json();
    expect(body).toHaveProperty('follow_up_action');
  });

  it('200 response always has follow_up_action_changed_at field (even when null)', async () => {
    const deps = makeDeps();
    const res = await handleLeadActionUpdate(
      makeRequest({ action: null }),
      { id: 'lead_test' },
      deps,
    );
    const body = await res.json();
    expect(body).toHaveProperty('follow_up_action_changed_at');
  });

  it('timestamp is a valid ISO 8601 string when action is non-null', async () => {
    const deps = makeDeps();
    const res = await handleLeadActionUpdate(
      makeRequest({ action: 'meeting_fixed' }),
      { id: 'lead_test' },
      deps,
    );
    const body = await res.json();
    expect(body.follow_up_action_changed_at).toBe('2026-05-24T14:14:00.000Z');
    expect(() => new Date(body.follow_up_action_changed_at)).not.toThrow();
  });
});
