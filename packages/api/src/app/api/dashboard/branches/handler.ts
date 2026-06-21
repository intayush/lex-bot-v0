/**
 * Spec 016 — Branches admin handlers (US4 / T049-T051).
 *
 * Five testable handlers exposed to two route shells:
 *
 *   /api/dashboard/branches
 *     GET  → handleListBranches (T049)  — list every (case_type, sub_type) pair with branch status.
 *
 *   /api/dashboard/branches/[caseType]/[subType]
 *     GET     → handleGetBranchDetail (T050)  — return current_version + draft_version (or 404).
 *     PUT     → handleSaveBranch     (T050)  — create branch on first save; otherwise stack a new draft.
 *     POST    → handlePublishBranch  (T051)  — publish the latest draft (the route uses POST + ?action=publish suffix).
 *     DELETE  → handleDeleteBranch   (T050)  — delete branch + cascade versions; preserve lead snapshots (FR-018).
 *
 * Handlers are pure — they accept a `BranchesDeps` object so tests can
 * stub every collaborator without touching the Neon dev DB. Production
 * deps live in `PRODUCTION_DEPS` and are wired by the route shells.
 *
 * Source of truth: contracts/branches-admin-api.md.
 *
 * Lives in a sibling file from `route.ts` because Next.js's route-file
 * compilation pass rejects exports beyond recognized HTTP-verb functions
 * (lesson learned in 011-preflight-phrase + reused in 013).
 */

import { NextResponse } from 'next/server';
import { and, asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db, schema } from '../../../../db';
import { getAuthSession } from '../../../../lib/dashboard-session';
import {
  branchSaveRequestSchema,
  caseValueConfigSchema,
  type BranchPairSummary,
  type BranchSaveResponse,
  type BranchSaveWarning,
  type BranchVersion,
  type CaseValueConfig,
} from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// DB row shapes (subset of `schema.branches` / `schema.branchVersions`)
// ---------------------------------------------------------------------------

export interface BranchRow {
  id: string;
  account_id: string;
  case_type_slug: string;
  sub_type_slug: string;
  is_active: boolean;
  /** 025-case-value-estimator: case-type-level toggle. */
  is_case_value_enabled?: boolean;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BranchVersionRow {
  id: string;
  branch_id: string;
  version_number: number;
  is_published: boolean;
  questions_json: string;
  classification_thresholds_json: string;
  hard_override_toggles_json: string;
  /** 025-case-value-estimator: optional JSON-encoded CaseValueConfig. */
  case_value_config_json?: string | null;
  published_at: string | null;
  created_at: string;
  created_by_user_id: string;
}

export interface CaseTypeRow {
  id: string;
  slug: string;
  label: string;
  position: number;
}

export interface SubTypeRow {
  id: string;
  case_type_id: string;
  slug: string;
  label: string;
  position: number;
}

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export interface BranchesDeps {
  /** Returns the iron-session payload; `accountId` is the auth gate. */
  getAuthSession: () => Promise<{ accountId?: string }>;

  /** Every case_type for an account, ordered by position. */
  listCaseTypes: (accountId: string) => Promise<CaseTypeRow[]>;
  /** Every sub_type for an account, ordered by case_type → position. */
  listSubTypes: (accountId: string) => Promise<SubTypeRow[]>;
  /** Every branch row for an account. */
  listBranches: (accountId: string) => Promise<BranchRow[]>;
  /** Every published version row for the supplied account's branches. */
  listPublishedVersions: (accountId: string) => Promise<BranchVersionRow[]>;

  /** Find one branch by (account, case_type_slug, sub_type_slug). */
  findBranchByPair: (input: {
    accountId: string;
    caseTypeSlug: string;
    subTypeSlug: string;
  }) => Promise<BranchRow | null>;
  /** Fetch a specific version row by id. */
  getVersionById: (versionId: string) => Promise<BranchVersionRow | null>;
  /** Latest unpublished (draft) version for a branch — null when none exists. */
  getDraftVersion: (branchId: string) => Promise<BranchVersionRow | null>;
  /** Highest version_number on the branch (used to compute next number). */
  getMaxVersionNumber: (branchId: string) => Promise<number>;

  /** Insert a fresh branches row. */
  insertBranch: (row: BranchRow) => Promise<void>;
  /** Replace `branches.current_version_id` + bump `updated_at`. */
  updateBranchCurrentVersion: (input: {
    branchId: string;
    currentVersionId: string | null;
    updatedAt: string;
    isActive?: boolean;
  }) => Promise<void>;
  /** Insert a new branch_versions row. */
  insertBranchVersion: (row: BranchVersionRow) => Promise<void>;
  /** Mark a single version row as published (the publish action). */
  setVersionPublished: (input: {
    versionId: string;
    publishedAt: string;
  }) => Promise<void>;
  /** Delete the branches row (cascades to branch_versions via FK). */
  deleteBranchById: (branchId: string) => Promise<void>;

  /** Injectable id generator (tests can stub for determinism). */
  newId: () => string;
  /** Injectable clock. */
  now: () => Date;
  /** Injectable user id for `created_by_user_id`. Falls back to session.accountId. */
  currentUserId: (session: { accountId: string }) => string;
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

const listCaseTypesProd: BranchesDeps['listCaseTypes'] = async (accountId) =>
  db
    .select({
      id: schema.caseTypes.id,
      slug: schema.caseTypes.slug,
      label: schema.caseTypes.label,
      position: schema.caseTypes.position,
    })
    .from(schema.caseTypes)
    .where(eq(schema.caseTypes.account_id, accountId))
    .orderBy(asc(schema.caseTypes.position));

const listSubTypesProd: BranchesDeps['listSubTypes'] = async (accountId) =>
  db
    .select({
      id: schema.subTypes.id,
      case_type_id: schema.subTypes.case_type_id,
      slug: schema.subTypes.slug,
      label: schema.subTypes.label,
      position: schema.subTypes.position,
    })
    .from(schema.subTypes)
    .innerJoin(schema.caseTypes, eq(schema.subTypes.case_type_id, schema.caseTypes.id))
    .where(eq(schema.caseTypes.account_id, accountId))
    .orderBy(asc(schema.subTypes.position));

const listBranchesProd: BranchesDeps['listBranches'] = async (accountId) =>
  db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.account_id, accountId));

const listPublishedVersionsProd: BranchesDeps['listPublishedVersions'] = async (
  accountId,
) =>
  db
    .select({
      id: schema.branchVersions.id,
      branch_id: schema.branchVersions.branch_id,
      version_number: schema.branchVersions.version_number,
      is_published: schema.branchVersions.is_published,
      questions_json: schema.branchVersions.questions_json,
      classification_thresholds_json:
        schema.branchVersions.classification_thresholds_json,
      hard_override_toggles_json:
        schema.branchVersions.hard_override_toggles_json,
      published_at: schema.branchVersions.published_at,
      created_at: schema.branchVersions.created_at,
      created_by_user_id: schema.branchVersions.created_by_user_id,
    })
    .from(schema.branchVersions)
    .innerJoin(schema.branches, eq(schema.branchVersions.branch_id, schema.branches.id))
    .where(
      and(
        eq(schema.branches.account_id, accountId),
        eq(schema.branchVersions.is_published, true),
      ),
    );

const findBranchByPairProd: BranchesDeps['findBranchByPair'] = async ({
  accountId,
  caseTypeSlug,
  subTypeSlug,
}) => {
  const rows = await db
    .select()
    .from(schema.branches)
    .where(
      and(
        eq(schema.branches.account_id, accountId),
        eq(schema.branches.case_type_slug, caseTypeSlug),
        eq(schema.branches.sub_type_slug, subTypeSlug),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

const getVersionByIdProd: BranchesDeps['getVersionById'] = async (versionId) => {
  const rows = await db
    .select()
    .from(schema.branchVersions)
    .where(eq(schema.branchVersions.id, versionId))
    .limit(1);
  return rows[0] ?? null;
};

const getDraftVersionProd: BranchesDeps['getDraftVersion'] = async (branchId) => {
  const rows = await db
    .select()
    .from(schema.branchVersions)
    .where(
      and(
        eq(schema.branchVersions.branch_id, branchId),
        eq(schema.branchVersions.is_published, false),
      ),
    )
    .orderBy(desc(schema.branchVersions.version_number))
    .limit(1);
  return rows[0] ?? null;
};

const getMaxVersionNumberProd: BranchesDeps['getMaxVersionNumber'] = async (
  branchId,
) => {
  const rows = await db
    .select({ version_number: schema.branchVersions.version_number })
    .from(schema.branchVersions)
    .where(eq(schema.branchVersions.branch_id, branchId))
    .orderBy(desc(schema.branchVersions.version_number))
    .limit(1);
  return rows[0]?.version_number ?? 0;
};

const insertBranchProd: BranchesDeps['insertBranch'] = async (row) => {
  await db.insert(schema.branches).values(row);
};

const updateBranchCurrentVersionProd: BranchesDeps['updateBranchCurrentVersion'] = async ({
  branchId,
  currentVersionId,
  updatedAt,
  isActive,
}) => {
  const patch: { current_version_id: string | null; updated_at: string; is_active?: boolean } = {
    current_version_id: currentVersionId,
    updated_at: updatedAt,
  };
  if (isActive !== undefined) patch.is_active = isActive;
  await db.update(schema.branches).set(patch).where(eq(schema.branches.id, branchId));
};

const insertBranchVersionProd: BranchesDeps['insertBranchVersion'] = async (row) => {
  await db.insert(schema.branchVersions).values(row);
};

const setVersionPublishedProd: BranchesDeps['setVersionPublished'] = async ({
  versionId,
  publishedAt,
}) => {
  await db
    .update(schema.branchVersions)
    .set({ is_published: true, published_at: publishedAt })
    .where(eq(schema.branchVersions.id, versionId));
};

const deleteBranchByIdProd: BranchesDeps['deleteBranchById'] = async (branchId) => {
  // Drizzle on Neon-HTTP doesn't expose transactional delete; FK ON DELETE
  // CASCADE on branch_versions handles the children automatically.
  await db.delete(schema.branchVersions).where(eq(schema.branchVersions.branch_id, branchId));
  await db.delete(schema.branches).where(eq(schema.branches.id, branchId));
};

export const PRODUCTION_DEPS: BranchesDeps = {
  getAuthSession,
  listCaseTypes: listCaseTypesProd,
  listSubTypes: listSubTypesProd,
  listBranches: listBranchesProd,
  listPublishedVersions: listPublishedVersionsProd,
  findBranchByPair: findBranchByPairProd,
  getVersionById: getVersionByIdProd,
  getDraftVersion: getDraftVersionProd,
  getMaxVersionNumber: getMaxVersionNumberProd,
  insertBranch: insertBranchProd,
  updateBranchCurrentVersion: updateBranchCurrentVersionProd,
  insertBranchVersion: insertBranchVersionProd,
  setVersionPublished: setVersionPublishedProd,
  deleteBranchById: deleteBranchByIdProd,
  newId: () => nanoid(),
  now: () => new Date(),
  currentUserId: (session) => session.accountId,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unauthorized() {
  return NextResponse.json(
    { error: 'unauthorized', message: 'Not authenticated' },
    { status: 401 },
  );
}

function badRequest(message: string) {
  return NextResponse.json({ error: 'bad_request', message }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

/**
 * Hydrate a `BranchVersionRow` (DB shape) into the
 * `BranchVersion` shape exposed in the contract — same fields, but
 * with the JSON columns parsed into structured objects so the
 * dashboard receives ready-to-render payloads.
 */
function hydrateVersion(row: BranchVersionRow): BranchVersion {
  let case_value_config: CaseValueConfig | null = null;
  if (row.case_value_config_json) {
    try {
      const parsed = caseValueConfigSchema.safeParse(JSON.parse(row.case_value_config_json));
      if (parsed.success) case_value_config = parsed.data;
    } catch {
      // Malformed JSON — treat as unconfigured
    }
  }
  return {
    id: row.id,
    branch_id: row.branch_id,
    version_number: row.version_number,
    is_published: row.is_published,
    questions: JSON.parse(row.questions_json) as BranchVersion['questions'],
    classification_thresholds: JSON.parse(
      row.classification_thresholds_json,
    ) as BranchVersion['classification_thresholds'],
    hard_override_toggles: JSON.parse(
      row.hard_override_toggles_json,
    ) as BranchVersion['hard_override_toggles'],
    case_value_config,
    published_at: row.published_at === null ? null : Number(new Date(row.published_at)),
    created_at: Number(new Date(row.created_at)),
    created_by_user_id: row.created_by_user_id,
  };
}

/**
 * Compute the warnings array surfaced on save (FR-023). The contract
 * lists three codes:
 *   - `negative_total_max`        : Σ(max-weight per question) < 0.
 *   - `positive_total_max_above_100`: Σ(max-weight per question) > 100.
 *   - `zero_questions`            : the saved branch has no questions.
 */
function computeWarnings(
  questions: ReadonlyArray<{ chips: ReadonlyArray<{ score_weight: number }> }>,
): BranchSaveWarning[] {
  const warnings: BranchSaveWarning[] = [];
  if (questions.length === 0) {
    warnings.push({
      code: 'zero_questions',
      message:
        'Branch has no questions; runtime will treat it as unconfigured (no scoring).',
    });
  }
  const maxTotal = questions.reduce((sum, q) => {
    if (q.chips.length === 0) return sum;
    return sum + Math.max(...q.chips.map((c) => c.score_weight));
  }, 0);
  if (maxTotal < 0) {
    warnings.push({
      code: 'negative_total_max',
      message: `Maximum theoretical score is ${maxTotal} (below 0); consider raising chip weights.`,
    });
  }
  if (maxTotal > 100) {
    warnings.push({
      code: 'positive_total_max_above_100',
      message: `Maximum theoretical score is ${maxTotal} (above 100). The runtime clamps the final score at 100; warning surfaced for visibility.`,
    });
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/branches  → list pairs (T049)
// ---------------------------------------------------------------------------

export async function handleListBranches(
  _req: Request,
  deps: BranchesDeps,
): Promise<Response> {
  const session = await deps.getAuthSession();
  if (!session.accountId) return unauthorized();

  const accountId = session.accountId;
  const [caseTypes, subTypes, branches, publishedVersions] = await Promise.all([
    deps.listCaseTypes(accountId),
    deps.listSubTypes(accountId),
    deps.listBranches(accountId),
    deps.listPublishedVersions(accountId),
  ]);

  const caseTypesById = new Map(caseTypes.map((ct) => [ct.id, ct]));
  const branchByPair = new Map<string, BranchRow>();
  for (const b of branches) {
    branchByPair.set(`${b.case_type_slug}::${b.sub_type_slug}`, b);
  }
  const publishedByBranchId = new Map<string, BranchVersionRow>();
  for (const v of publishedVersions) publishedByBranchId.set(v.branch_id, v);

  const pairs: BranchPairSummary[] = [];
  for (const sub of subTypes) {
    const ct = caseTypesById.get(sub.case_type_id);
    if (!ct) continue;
    const branch = branchByPair.get(`${ct.slug}::${sub.slug}`) ?? null;

    let summary: BranchPairSummary['branch'] = null;
    if (branch !== null) {
      const published = branch.current_version_id
        ? publishedByBranchId.get(branch.id)
        : undefined;
      let questionsCount = 0;
      if (published) {
        try {
          const arr = JSON.parse(published.questions_json) as unknown[];
          questionsCount = Array.isArray(arr) ? arr.length : 0;
        } catch {
          questionsCount = 0;
        }
      }
      summary = {
        id: branch.id,
        is_active: branch.is_active,
        current_version_id: branch.current_version_id,
        version_number: published?.version_number ?? null,
        questions_count: questionsCount,
        is_published: published?.is_published ?? false,
        updated_at: Number(new Date(branch.updated_at)),
      };
    }

    pairs.push({
      case_type_slug: ct.slug,
      case_type_label: ct.label,
      sub_type_slug: sub.slug,
      sub_type_label: sub.label,
      branch: summary,
    });
  }

  return NextResponse.json({ pairs }, { status: 200 });
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/branches/[caseType]/[subType]  → detail (T050)
// ---------------------------------------------------------------------------

export async function handleGetBranchDetail(
  _req: Request,
  params: { caseType: string; subType: string },
  deps: BranchesDeps,
): Promise<Response> {
  const session = await deps.getAuthSession();
  if (!session.accountId) return unauthorized();

  const branch = await deps.findBranchByPair({
    accountId: session.accountId,
    caseTypeSlug: params.caseType,
    subTypeSlug: params.subType,
  });
  if (!branch) return notFound();

  const currentVersion = branch.current_version_id
    ? await deps.getVersionById(branch.current_version_id)
    : null;
  const draftVersion = await deps.getDraftVersion(branch.id);

  // The "draft" returned to the dashboard is the latest unpublished
  // version that's NEWER than the current published one. If there's no
  // draft yet, return null.
  return NextResponse.json(
    {
      branch: {
        id: branch.id,
        case_type_slug: branch.case_type_slug,
        sub_type_slug: branch.sub_type_slug,
        is_active: branch.is_active,
        is_case_value_enabled: branch.is_case_value_enabled ?? false,
      },
      current_version: currentVersion ? hydrateVersion(currentVersion) : null,
      draft_version: draftVersion ? hydrateVersion(draftVersion) : null,
    },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// PUT /api/dashboard/branches/[caseType]/[subType]  → save (T050)
// ---------------------------------------------------------------------------

export async function handleSaveBranch(
  req: Request,
  params: { caseType: string; subType: string },
  deps: BranchesDeps,
): Promise<Response> {
  const session = await deps.getAuthSession();
  if (!session.accountId) return unauthorized();
  const accountId = session.accountId;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }

  const parsed = branchSaveRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return badRequest(
      parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    );
  }
  const body = parsed.data;

  const ts = deps.now().toISOString();
  let branchId: string;
  let isFirstSave = false;

  // Find or create the parent branches row.
  const existing = await deps.findBranchByPair({
    accountId,
    caseTypeSlug: params.caseType,
    subTypeSlug: params.subType,
  });
  if (existing) {
    branchId = existing.id;
    // If is_active changed on save, reflect it now (don't wait for publish).
    if (existing.is_active !== body.is_active) {
      await deps.updateBranchCurrentVersion({
        branchId,
        currentVersionId: existing.current_version_id,
        updatedAt: ts,
        isActive: body.is_active,
      });
    }
  } else {
    branchId = deps.newId();
    isFirstSave = true;
    await deps.insertBranch({
      id: branchId,
      account_id: accountId,
      case_type_slug: params.caseType,
      sub_type_slug: params.subType,
      is_active: body.is_active,
      current_version_id: null,
      created_at: ts,
      updated_at: ts,
    });
  }

  // Create a new draft version on top.
  const versionId = deps.newId();
  const versionNumber = (await deps.getMaxVersionNumber(branchId)) + 1;
  // 025-case-value-estimator: persist case_value_config if provided in the request body
  const bodyWithCv = rawBody as Record<string, unknown>;
  let caseValueConfigJson: string | null = null;
  if (bodyWithCv.case_value_config !== undefined && bodyWithCv.case_value_config !== null) {
    const cvParsed = caseValueConfigSchema.safeParse(bodyWithCv.case_value_config);
    if (cvParsed.success) caseValueConfigJson = JSON.stringify(cvParsed.data);
  }

  await deps.insertBranchVersion({
    id: versionId,
    branch_id: branchId,
    version_number: versionNumber,
    is_published: false,
    questions_json: JSON.stringify(body.questions),
    classification_thresholds_json: JSON.stringify(body.classification_thresholds),
    hard_override_toggles_json: JSON.stringify(body.hard_override_toggles),
    case_value_config_json: caseValueConfigJson,
    published_at: null,
    created_at: ts,
    created_by_user_id: deps.currentUserId({ accountId }),
  });

  // First-save convenience: if this is a brand-new branch with NO
  // published version, auto-publish v1 so the runtime can use it
  // immediately. Subsequent saves require an explicit Publish click.
  // (Matches admin expectations: clicking Save on a never-existed
  // branch shouldn't leave it in a draft-only limbo.)
  if (isFirstSave) {
    await deps.setVersionPublished({ versionId, publishedAt: ts });
    await deps.updateBranchCurrentVersion({
      branchId,
      currentVersionId: versionId,
      updatedAt: ts,
    });
  }

  const warnings = computeWarnings(body.questions);
  const response: BranchSaveResponse = {
    branch_id: branchId,
    draft_version_id: versionId,
    version_number: versionNumber,
    warnings,
  };
  return NextResponse.json(response, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST /api/dashboard/branches/[caseType]/[subType]/publish  → publish (T051)
// ---------------------------------------------------------------------------

export async function handlePublishBranch(
  _req: Request,
  params: { caseType: string; subType: string },
  deps: BranchesDeps,
): Promise<Response> {
  const session = await deps.getAuthSession();
  if (!session.accountId) return unauthorized();

  const branch = await deps.findBranchByPair({
    accountId: session.accountId,
    caseTypeSlug: params.caseType,
    subTypeSlug: params.subType,
  });
  if (!branch) return notFound();

  const draft = await deps.getDraftVersion(branch.id);
  if (!draft) {
    return NextResponse.json(
      { error: 'conflict', message: 'No draft version exists to publish.' },
      { status: 409 },
    );
  }

  const ts = deps.now().toISOString();
  await deps.setVersionPublished({ versionId: draft.id, publishedAt: ts });
  await deps.updateBranchCurrentVersion({
    branchId: branch.id,
    currentVersionId: draft.id,
    updatedAt: ts,
  });

  return NextResponse.json(
    {
      branch_id: branch.id,
      published_version_id: draft.id,
      version_number: draft.version_number,
      published_at: Number(new Date(ts)),
    },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// DELETE /api/dashboard/branches/[caseType]/[subType]  → delete (T050)
// ---------------------------------------------------------------------------

export async function handleDeleteBranch(
  _req: Request,
  params: { caseType: string; subType: string },
  deps: BranchesDeps,
): Promise<Response> {
  const session = await deps.getAuthSession();
  if (!session.accountId) return unauthorized();

  const branch = await deps.findBranchByPair({
    accountId: session.accountId,
    caseTypeSlug: params.caseType,
    subTypeSlug: params.subType,
  });
  if (!branch) return notFound();

  await deps.deleteBranchById(branch.id);
  return new NextResponse(null, { status: 204 });
}


// ---------------------------------------------------------------------------
// POST /api/dashboard/branches/[caseType]/[subType]/toggle-case-value
// 025-case-value-estimator: toggles is_case_value_enabled without a new version
// ---------------------------------------------------------------------------

export async function handleToggleCaseValue(
  req: Request,
  params: { caseType: string; subType: string },
  deps: BranchesDeps,
): Promise<Response> {
  const session = await deps.getAuthSession();
  if (!session.accountId) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }

  const parsed = z.object({ enabled: z.boolean() }).safeParse(body);
  if (!parsed.success) return badRequest('enabled (boolean) is required.');

  const branch = await deps.findBranchByPair({
    accountId: session.accountId,
    caseTypeSlug: params.caseType,
    subTypeSlug: params.subType,
  });
  if (!branch) return notFound();

  await db
    .update(schema.branches)
    .set({ is_case_value_enabled: parsed.data.enabled, updated_at: deps.now().toISOString() })
    .where(eq(schema.branches.id, branch.id));

  return NextResponse.json({ success: true });
}
