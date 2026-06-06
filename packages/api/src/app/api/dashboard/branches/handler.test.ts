/**
 * Spec 016 US4 — Branches admin handler tests (T043–T047).
 *
 * Pure handler tests using DI seams from `./handler.ts`. No DB, no
 * iron-session — just stubbed collaborators. Each test maps to a
 * specific contract assertion in
 * `specs/016-multi-branch-sop/contracts/branches-admin-api.md`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  handleDeleteBranch,
  handleGetBranchDetail,
  handleListBranches,
  handlePublishBranch,
  handleSaveBranch,
  type BranchRow,
  type BranchVersionRow,
  type BranchesDeps,
  type CaseTypeRow,
  type SubTypeRow,
} from './handler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_ID = 'acct_test';

const SAMPLE_QUESTIONS = [
  {
    id: 'q_role',
    position: 0,
    text: 'Driver or passenger?',
    preface: null,
    chips: [
      { slug: 'driver', label: 'Driver', score_weight: 10 },
      { slug: 'passenger', label: 'Passenger', score_weight: 8 },
    ],
    free_text_allowed: false,
    multi_select: false,
  },
];

const SAMPLE_THRESHOLDS_SELF = {
  hot: [76, 100] as [number, number],
  warm: [51, 75] as [number, number],
  cold: [26, 50] as [number, number],
  spam: [0, 25] as [number, number],
};

const SAMPLE_THRESHOLDS_FAMILY = {
  hot: [71, 100] as [number, number],
  warm: [46, 70] as [number, number],
  spam: [0, 45] as [number, number],
};

const SAMPLE_OVERRIDES = {
  missing_contact: true,
  out_of_scope: true,
  no_injury_no_treatment: true,
  fake_info: true,
};

function caseType(slug: string, label: string, position: number): CaseTypeRow {
  return { id: `ct_${slug}`, slug, label, position };
}

function subType(
  caseTypeSlug: string,
  slug: string,
  label: string,
  position: number,
): SubTypeRow {
  return {
    id: `st_${slug}`,
    case_type_id: `ct_${caseTypeSlug}`,
    slug,
    label,
    position,
  };
}

function branchRow(overrides: Partial<BranchRow> = {}): BranchRow {
  return {
    id: 'br_test',
    account_id: ACCOUNT_ID,
    case_type_slug: 'personal_injury',
    sub_type_slug: 'car_accident',
    is_active: true,
    current_version_id: 'bv_v1',
    created_at: '2026-06-06T00:00:00Z',
    updated_at: '2026-06-06T00:00:00Z',
    ...overrides,
  };
}

function versionRow(overrides: Partial<BranchVersionRow> = {}): BranchVersionRow {
  return {
    id: 'bv_v1',
    branch_id: 'br_test',
    version_number: 1,
    is_published: true,
    questions_json: JSON.stringify(SAMPLE_QUESTIONS),
    classification_thresholds_json: JSON.stringify({
      self: SAMPLE_THRESHOLDS_SELF,
      family_friend: SAMPLE_THRESHOLDS_FAMILY,
    }),
    hard_override_toggles_json: JSON.stringify(SAMPLE_OVERRIDES),
    published_at: '2026-06-06T00:00:00Z',
    created_at: '2026-06-06T00:00:00Z',
    created_by_user_id: 'u_admin',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<BranchesDeps> = {}): BranchesDeps {
  let idCounter = 0;
  return {
    getAuthSession: vi.fn().mockResolvedValue({ accountId: ACCOUNT_ID }),
    listCaseTypes: vi.fn().mockResolvedValue([]),
    listSubTypes: vi.fn().mockResolvedValue([]),
    listBranches: vi.fn().mockResolvedValue([]),
    listPublishedVersions: vi.fn().mockResolvedValue([]),
    findBranchByPair: vi.fn().mockResolvedValue(null),
    getVersionById: vi.fn().mockResolvedValue(null),
    getDraftVersion: vi.fn().mockResolvedValue(null),
    getMaxVersionNumber: vi.fn().mockResolvedValue(0),
    insertBranch: vi.fn().mockResolvedValue(undefined),
    updateBranchCurrentVersion: vi.fn().mockResolvedValue(undefined),
    insertBranchVersion: vi.fn().mockResolvedValue(undefined),
    setVersionPublished: vi.fn().mockResolvedValue(undefined),
    deleteBranchById: vi.fn().mockResolvedValue(undefined),
    newId: () => `id_${++idCounter}`,
    now: () => new Date('2026-06-06T12:00:00Z'),
    currentUserId: (s) => s.accountId,
    ...overrides,
  };
}

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost:3000/api/dashboard/branches', {
    method: body !== undefined ? 'PUT' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// T043 — GET /api/dashboard/branches  (list)
// ---------------------------------------------------------------------------

describe('handleListBranches (T043 / FR-020)', () => {
  it('returns 401 when no session', async () => {
    const deps = makeDeps({
      getAuthSession: vi.fn().mockResolvedValue({}),
    });
    const res = await handleListBranches(makeRequest(), deps);
    expect(res.status).toBe(401);
  });

  it('returns the empty list when the firm has no case types', async () => {
    const deps = makeDeps();
    const res = await handleListBranches(makeRequest(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pairs).toEqual([]);
  });

  it('returns one row per (case_type, sub_type) pair with branch=null when unconfigured', async () => {
    const deps = makeDeps({
      listCaseTypes: vi.fn().mockResolvedValue([
        caseType('criminal_defense', 'Criminal Defense', 1),
      ]),
      listSubTypes: vi.fn().mockResolvedValue([
        subType('criminal_defense', 'assault', 'Assault', 1),
        subType('criminal_defense', 'theft', 'Theft', 2),
      ]),
    });
    const res = await handleListBranches(makeRequest(), deps);
    const body = await res.json();
    expect(body.pairs).toHaveLength(2);
    expect(body.pairs[0]).toMatchObject({
      case_type_slug: 'criminal_defense',
      sub_type_slug: 'assault',
      branch: null,
    });
    expect(body.pairs[1]).toMatchObject({
      case_type_slug: 'criminal_defense',
      sub_type_slug: 'theft',
      branch: null,
    });
  });

  it('hydrates branch summary including questions_count from the published version', async () => {
    const deps = makeDeps({
      listCaseTypes: vi.fn().mockResolvedValue([
        caseType('personal_injury', 'Personal Injury', 1),
      ]),
      listSubTypes: vi.fn().mockResolvedValue([
        subType('personal_injury', 'car_accident', 'Car Accident', 1),
      ]),
      listBranches: vi.fn().mockResolvedValue([branchRow()]),
      listPublishedVersions: vi.fn().mockResolvedValue([versionRow()]),
    });
    const res = await handleListBranches(makeRequest(), deps);
    const body = await res.json();
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0].branch).toMatchObject({
      id: 'br_test',
      is_active: true,
      version_number: 1,
      questions_count: 1,
      is_published: true,
    });
  });

  it('handles 50 pairs in O(n) (SC-010 budget proxy)', async () => {
    const cts = Array.from({ length: 10 }, (_, i) =>
      caseType(`ct${i}`, `Case Type ${i}`, i + 1),
    );
    const subs: SubTypeRow[] = [];
    for (const ct of cts) {
      for (let j = 0; j < 5; j++) {
        subs.push(subType(ct.slug, `${ct.slug}_${j}`, `Sub ${j}`, j + 1));
      }
    }
    const deps = makeDeps({
      listCaseTypes: vi.fn().mockResolvedValue(cts),
      listSubTypes: vi.fn().mockResolvedValue(subs),
    });
    const res = await handleListBranches(makeRequest(), deps);
    const body = await res.json();
    expect(body.pairs).toHaveLength(50);
  });
});

// ---------------------------------------------------------------------------
// T044 — GET /api/dashboard/branches/[caseType]/[subType]  (detail)
// ---------------------------------------------------------------------------

describe('handleGetBranchDetail (T044)', () => {
  it('returns 401 when no session', async () => {
    const deps = makeDeps({ getAuthSession: vi.fn().mockResolvedValue({}) });
    const res = await handleGetBranchDetail(
      makeRequest(),
      { caseType: 'pi', subType: 'ca' },
      deps,
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when no branch exists', async () => {
    const deps = makeDeps({ findBranchByPair: vi.fn().mockResolvedValue(null) });
    const res = await handleGetBranchDetail(
      makeRequest(),
      { caseType: 'criminal_defense', subType: 'assault' },
      deps,
    );
    expect(res.status).toBe(404);
  });

  it('returns branch + current_version with parsed JSON; draft_version null when absent', async () => {
    const deps = makeDeps({
      findBranchByPair: vi.fn().mockResolvedValue(branchRow()),
      getVersionById: vi.fn().mockResolvedValue(versionRow()),
      getDraftVersion: vi.fn().mockResolvedValue(null),
    });
    const res = await handleGetBranchDetail(
      makeRequest(),
      { caseType: 'personal_injury', subType: 'car_accident' },
      deps,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch).toMatchObject({
      id: 'br_test',
      case_type_slug: 'personal_injury',
      is_active: true,
    });
    expect(body.current_version.questions[0].id).toBe('q_role');
    expect(body.current_version.classification_thresholds.self.hot).toEqual([76, 100]);
    expect(body.current_version.hard_override_toggles.missing_contact).toBe(true);
    expect(body.draft_version).toBeNull();
  });

  it('returns BOTH current and draft when a draft exists', async () => {
    const draft = versionRow({
      id: 'bv_v2_draft',
      version_number: 2,
      is_published: false,
      published_at: null,
    });
    const deps = makeDeps({
      findBranchByPair: vi.fn().mockResolvedValue(branchRow()),
      getVersionById: vi.fn().mockResolvedValue(versionRow()),
      getDraftVersion: vi.fn().mockResolvedValue(draft),
    });
    const res = await handleGetBranchDetail(
      makeRequest(),
      { caseType: 'personal_injury', subType: 'car_accident' },
      deps,
    );
    const body = await res.json();
    expect(body.draft_version).not.toBeNull();
    expect(body.draft_version.version_number).toBe(2);
    expect(body.draft_version.is_published).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T045 — PUT /api/dashboard/branches/[caseType]/[subType]  (save)
// ---------------------------------------------------------------------------

describe('handleSaveBranch (T045 / FR-021–FR-024)', () => {
  const VALID_BODY = {
    is_active: true,
    questions: SAMPLE_QUESTIONS,
    classification_thresholds: {
      self: SAMPLE_THRESHOLDS_SELF,
      family_friend: SAMPLE_THRESHOLDS_FAMILY,
    },
    hard_override_toggles: SAMPLE_OVERRIDES,
  };

  it('returns 401 when no session', async () => {
    const deps = makeDeps({ getAuthSession: vi.fn().mockResolvedValue({}) });
    const res = await handleSaveBranch(
      makeRequest(VALID_BODY),
      { caseType: 'pi', subType: 'ca' },
      deps,
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed body', async () => {
    const deps = makeDeps();
    const res = await handleSaveBranch(
      makeRequest({ is_active: 'not-a-bool', questions: 'nope' }),
      { caseType: 'pi', subType: 'ca' },
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('creates a brand-new branch on first save and auto-publishes v1', async () => {
    const insertBranch = vi.fn().mockResolvedValue(undefined);
    const insertBranchVersion = vi.fn().mockResolvedValue(undefined);
    const setVersionPublished = vi.fn().mockResolvedValue(undefined);
    const updateBranchCurrentVersion = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      findBranchByPair: vi.fn().mockResolvedValue(null),
      getMaxVersionNumber: vi.fn().mockResolvedValue(0),
      insertBranch,
      insertBranchVersion,
      setVersionPublished,
      updateBranchCurrentVersion,
    });

    const res = await handleSaveBranch(
      makeRequest(VALID_BODY),
      { caseType: 'criminal_defense', subType: 'assault' },
      deps,
    );
    expect(res.status).toBe(200);
    expect(insertBranch).toHaveBeenCalledTimes(1);
    expect(insertBranchVersion).toHaveBeenCalledTimes(1);
    // First save auto-publishes:
    expect(setVersionPublished).toHaveBeenCalledTimes(1);
    expect(updateBranchCurrentVersion).toHaveBeenCalled();

    const body = await res.json();
    expect(body.branch_id).toBeDefined();
    expect(body.draft_version_id).toBeDefined();
    expect(body.version_number).toBe(1);
  });

  it('stacks a new draft version on existing branch (no auto-publish)', async () => {
    const setVersionPublished = vi.fn().mockResolvedValue(undefined);
    const insertBranchVersion = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      findBranchByPair: vi.fn().mockResolvedValue(branchRow()),
      getMaxVersionNumber: vi.fn().mockResolvedValue(3),
      insertBranchVersion,
      setVersionPublished,
    });

    const res = await handleSaveBranch(
      makeRequest(VALID_BODY),
      { caseType: 'personal_injury', subType: 'car_accident' },
      deps,
    );
    expect(res.status).toBe(200);
    expect(insertBranchVersion).toHaveBeenCalledTimes(1);
    // Second save MUST NOT auto-publish; admin clicks Publish separately.
    expect(setVersionPublished).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.version_number).toBe(4);
  });

  it('emits a zero_questions warning when the body has empty questions', async () => {
    const deps = makeDeps({
      findBranchByPair: vi.fn().mockResolvedValue(branchRow()),
      getMaxVersionNumber: vi.fn().mockResolvedValue(1),
    });
    const res = await handleSaveBranch(
      makeRequest({ ...VALID_BODY, questions: [] }),
      { caseType: 'personal_injury', subType: 'car_accident' },
      deps,
    );
    const body = await res.json();
    expect(body.warnings.some((w: { code: string }) => w.code === 'zero_questions')).toBe(true);
  });

  it('emits negative_total_max when max-weight totals are below 0', async () => {
    const negQuestions = [
      {
        id: 'q1',
        position: 0,
        text: 'q',
        preface: null,
        chips: [{ slug: 'a', label: 'A', score_weight: -10 }],
        free_text_allowed: false,
        multi_select: false,
      },
    ];
    const deps = makeDeps({
      findBranchByPair: vi.fn().mockResolvedValue(branchRow()),
    });
    const res = await handleSaveBranch(
      makeRequest({ ...VALID_BODY, questions: negQuestions }),
      { caseType: 'personal_injury', subType: 'car_accident' },
      deps,
    );
    const body = await res.json();
    expect(
      body.warnings.some((w: { code: string }) => w.code === 'negative_total_max'),
    ).toBe(true);
  });

  it('emits positive_total_max_above_100 when the upper bound is too high', async () => {
    const overflow = Array.from({ length: 5 }, (_, i) => ({
      id: `q${i}`,
      position: i,
      text: `q${i}`,
      preface: null,
      chips: [{ slug: 'a', label: 'A', score_weight: 50 }],
      free_text_allowed: false,
      multi_select: false,
    }));
    const deps = makeDeps({
      findBranchByPair: vi.fn().mockResolvedValue(branchRow()),
    });
    const res = await handleSaveBranch(
      makeRequest({ ...VALID_BODY, questions: overflow }),
      { caseType: 'personal_injury', subType: 'car_accident' },
      deps,
    );
    const body = await res.json();
    expect(
      body.warnings.some(
        (w: { code: string }) => w.code === 'positive_total_max_above_100',
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T046 — POST /api/dashboard/branches/[caseType]/[subType]/publish
// ---------------------------------------------------------------------------

describe('handlePublishBranch (T046 / FR-017)', () => {
  it('returns 401 when no session', async () => {
    const deps = makeDeps({ getAuthSession: vi.fn().mockResolvedValue({}) });
    const res = await handlePublishBranch(
      makeRequest(),
      { caseType: 'pi', subType: 'ca' },
      deps,
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when no branch exists', async () => {
    const deps = makeDeps({ findBranchByPair: vi.fn().mockResolvedValue(null) });
    const res = await handlePublishBranch(
      makeRequest(),
      { caseType: 'pi', subType: 'ca' },
      deps,
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when no draft version exists to publish', async () => {
    const deps = makeDeps({
      findBranchByPair: vi.fn().mockResolvedValue(branchRow()),
      getDraftVersion: vi.fn().mockResolvedValue(null),
    });
    const res = await handlePublishBranch(
      makeRequest(),
      { caseType: 'personal_injury', subType: 'car_accident' },
      deps,
    );
    expect(res.status).toBe(409);
  });

  it('publishes the draft and updates current_version_id', async () => {
    const setVersionPublished = vi.fn().mockResolvedValue(undefined);
    const updateBranchCurrentVersion = vi.fn().mockResolvedValue(undefined);
    const draft = versionRow({
      id: 'bv_v2',
      version_number: 2,
      is_published: false,
      published_at: null,
    });
    const deps = makeDeps({
      findBranchByPair: vi.fn().mockResolvedValue(branchRow()),
      getDraftVersion: vi.fn().mockResolvedValue(draft),
      setVersionPublished,
      updateBranchCurrentVersion,
    });

    const res = await handlePublishBranch(
      makeRequest(),
      { caseType: 'personal_injury', subType: 'car_accident' },
      deps,
    );
    expect(res.status).toBe(200);
    expect(setVersionPublished).toHaveBeenCalledWith({
      versionId: 'bv_v2',
      publishedAt: expect.any(String),
    });
    expect(updateBranchCurrentVersion).toHaveBeenCalledWith({
      branchId: 'br_test',
      currentVersionId: 'bv_v2',
      updatedAt: expect.any(String),
    });
    const body = await res.json();
    expect(body.published_version_id).toBe('bv_v2');
    expect(body.version_number).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T047 — DELETE /api/dashboard/branches/[caseType]/[subType]
// ---------------------------------------------------------------------------

describe('handleDeleteBranch (T047 / FR-026)', () => {
  it('returns 401 when no session', async () => {
    const deps = makeDeps({ getAuthSession: vi.fn().mockResolvedValue({}) });
    const res = await handleDeleteBranch(
      makeRequest(),
      { caseType: 'pi', subType: 'ca' },
      deps,
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when no branch exists', async () => {
    const deps = makeDeps({ findBranchByPair: vi.fn().mockResolvedValue(null) });
    const res = await handleDeleteBranch(
      makeRequest(),
      { caseType: 'pi', subType: 'ca' },
      deps,
    );
    expect(res.status).toBe(404);
  });

  it('returns 204 and calls deleteBranchById on success', async () => {
    const deleteBranchById = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      findBranchByPair: vi.fn().mockResolvedValue(branchRow()),
      deleteBranchById,
    });

    const res = await handleDeleteBranch(
      makeRequest(),
      { caseType: 'personal_injury', subType: 'car_accident' },
      deps,
    );
    expect(res.status).toBe(204);
    expect(deleteBranchById).toHaveBeenCalledWith('br_test');
  });
});


