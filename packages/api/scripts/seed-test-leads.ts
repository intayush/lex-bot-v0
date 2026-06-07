/**
 * Test-data lead generator (spec 017 follow-up).
 *
 * Drives the live `/api/chat` endpoint to produce one lead per
 * (branch × bucket × request_type) tuple plus a small set of
 * hard-override scenarios. Total ~90 leads, enough to manually
 * judge classification quality across every configured branch.
 *
 * Usage:
 *   # Generate
 *   pnpm --filter @legal-chatbot/api exec tsx --env-file=.env.local \
 *     scripts/seed-test-leads.ts
 *
 *   # Generate, narrowing to a single branch (debug):
 *   ... scripts/seed-test-leads.ts --branch=criminal_defense/theft
 *
 *   # Generate one bucket only (debug):
 *   ... scripts/seed-test-leads.ts --bucket=HOT
 *
 *   # Plan-only (no HTTP, no DB writes; prints the chip plan):
 *   ... scripts/seed-test-leads.ts --dry-run
 *
 *   # Cleanup all previously generated fixture leads:
 *   ... scripts/seed-test-leads.ts --clean
 *
 * Each generated lead is tagged with `[TEST-FIXTURE]` prefixed onto
 * its `brief_description` and a synthetic name pattern, so cleanup
 * is one SQL DELETE.
 *
 * Notes:
 *  - Requires the Next dev server running on http://localhost:3000
 *    (the script HTTPs against it). If it's not running, the script
 *    fails fast with a clear error.
 *  - The widget is bypassed entirely; this is a pure HTTP client.
 *  - `family_law` and `estate_planning` are out of scope (no Branch
 *    seeded → no branch path to score → no test data generated).
 *  - Family/Friend variants only generate HOT/WARM/SPAM (no COLD —
 *    the family_friend threshold table collapses cold into warm).
 *
 * Implementation lives entirely in this one file to keep it easy to
 * delete or move later.
 */

import { neon } from '@neondatabase/serverless';
import {
  DEFAULT_BRANCH_SEEDS,
  type DefaultBranchSeed,
} from '../src/db/seed-defaults/branches.js';
import {
  CAR_ACCIDENT_BRANCH_HARD_OVERRIDES_JSON,
  CAR_ACCIDENT_BRANCH_QUESTIONS_JSON,
  CAR_ACCIDENT_BRANCH_THRESHOLDS_JSON,
} from '../src/db/seed-defaults/sop.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.DEV_API_KEY ?? 'dev_test_key';
/**
 * Marker for fixture leads. Stored in `leads.contact_email` because
 * neither `brief_description` (LLM rewrites it) nor `name` (LLM may
 * trim it) preserve a custom marker reliably. The contact_email is
 * extracted by `extractContactPayload` via regex from the contact
 * form submit; its value is preserved verbatim.
 *
 * Pattern: `fixture-<index>@legalchatbot.test`. Cleanup matches by
 * domain (`@legalchatbot.test`) so cross-run cleanup works.
 */
const FIXTURE_EMAIL_DOMAIN = '@legalchatbot.test';
/** Legacy markers kept for backward-compat cleanup of pre-existing runs. */
const LEGACY_FIXTURE_TAG = '[TEST-FIXTURE]';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is required. Run via:\n' +
      '  pnpm --filter @legal-chatbot/api exec tsx --env-file=.env.local scripts/seed-test-leads.ts',
  );
  process.exit(1);
}

// CLI flag parsing (intentionally tiny — no minimist).
const args = new Map<string, string | true>();
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=');
    if (eq === -1) args.set(arg.slice(2), true);
    else args.set(arg.slice(2, eq), arg.slice(eq + 1));
  }
}
const FLAG_DRY_RUN = args.has('dry-run');
const FLAG_CLEAN = args.has('clean');
const FLAG_BRANCH = typeof args.get('branch') === 'string' ? (args.get('branch') as string) : null;
const FLAG_BUCKET = typeof args.get('bucket') === 'string' ? (args.get('bucket') as string) : null;

// ---------------------------------------------------------------------------
// Types from the branch JSON payload (subset — we only need the bits
// that drive chip selection).
// ---------------------------------------------------------------------------

interface BranchChip {
  label: string;
  slug: string;
  score_weight: number;
}

interface BranchQuestion {
  id: string;
  position: number;
  text: string;
  preface: string | null;
  chips: BranchChip[];
  free_text_allowed: boolean;
  multi_select: boolean;
}

interface ThresholdsSelf {
  hot: [number, number];
  warm: [number, number];
  cold: [number, number];
  spam: [number, number];
}

interface ThresholdsFamilyFriend {
  hot: [number, number];
  warm: [number, number];
  spam: [number, number];
}

interface BranchPayload {
  case_type_slug: string;
  sub_type_slug: string;
  questions: BranchQuestion[];
  thresholds: { self: ThresholdsSelf; family_friend: ThresholdsFamilyFriend };
  hard_overrides: { missing_contact: boolean; out_of_scope: boolean; no_injury_no_treatment: boolean; fake_info: boolean };
}

type Bucket = 'HOT' | 'WARM' | 'COLD' | 'SPAM';
type RequestType = 'SELF' | 'FRIEND_FAMILY';

// ---------------------------------------------------------------------------
// Branch loading — combine DEFAULT_BRANCH_SEEDS + the car_accident
// reference into a uniform iterable.
// ---------------------------------------------------------------------------

function loadBranchPayload(seed: DefaultBranchSeed): BranchPayload {
  return {
    case_type_slug: seed.case_type_slug,
    sub_type_slug: seed.sub_type_slug,
    questions: JSON.parse(seed.questions_json) as BranchQuestion[],
    thresholds: JSON.parse(seed.classification_thresholds_json),
    hard_overrides: JSON.parse(seed.hard_override_toggles_json),
  };
}

const ALL_BRANCHES: BranchPayload[] = [
  // Car Accident reference (seeded separately in seed-defaults/sop.ts)
  loadBranchPayload({
    case_type_slug: 'personal_injury',
    sub_type_slug: 'car_accident',
    questions_json: CAR_ACCIDENT_BRANCH_QUESTIONS_JSON,
    classification_thresholds_json: CAR_ACCIDENT_BRANCH_THRESHOLDS_JSON,
    hard_override_toggles_json: CAR_ACCIDENT_BRANCH_HARD_OVERRIDES_JSON,
  }),
  // 14 default sub-type branches (DUI, CD, non-CA PI, Drug Crime).
  ...DEFAULT_BRANCH_SEEDS.map(loadBranchPayload),
];

// ---------------------------------------------------------------------------
// `when` step chip weights (default SOP step 5). The branch
// orchestrator adds the matched chip's weight to the raw_score at
// finalize-time, so the targeting plan must subtract it from the
// branch-question budget. Source-of-truth: seed-defaults/sop.ts:131-138.
// ---------------------------------------------------------------------------

const WHEN_CHIP_WEIGHTS: Record<string, number> = {
  today: 20,
  yesterday: 15,
  this_week: 15,
  last_week: 10,
  this_month: 10,
  earlier_this_year: 5,
  longer_ago: 0,
};

// We intentionally pin the `when` chip to a stable mid bucket
// regardless of target band so the planner has a deterministic
// constant to subtract. `last_week` (+10) is a reasonable middle.
const WHEN_CHIP_SLUG = 'last_week';
const WHEN_CHIP_BONUS = WHEN_CHIP_WEIGHTS[WHEN_CHIP_SLUG]; // +10

/**
 * Branch-path contact bonus, per `computeContactBonus` in
 * branch-orchestrator.ts:171-192:
 *   phone (≥7 digits) +5
 *   email (RFC-ish regex match) +5
 * Both fields are present in our fixture contact submissions, so the
 * bonus is fixed +10. (NOTE: the legacy/spec-015 scoring path uses
 * phone +10 / email +5 = +15 instead — see leads.ts:301-303 — but
 * fixtures all hit the branch path so we pin to +10 here.)
 */
const CONTACT_BONUS_BRANCH = 10;

// ---------------------------------------------------------------------------
// Dummy log markers for debug.
// ---------------------------------------------------------------------------
function log(msg: string) {
  console.log(msg);
}
function logSection(title: string) {
  console.log(`\n=== ${title} ===`);
}

// ---------------------------------------------------------------------------
// Chip-targeting planner
//
// For each (branch × bucket × request_type) we want to pick ONE chip
// per scored question such that the sum (+ contact bonus + when
// bonus) lands inside the target bucket's range.
//
// Approach: brute-force enumerate combinations. With 6-7 questions
// each having 4-7 chips, the combinatorial space is ~5^7 ≈ 78k —
// trivially small. We pick the combination whose sum is closest to
// the bucket midpoint to give some margin against scorer collisions.
//
// Special handling:
//  - Slug-collision avoidance. The repo's scoreBranch() builds a
//    chipBySlug map keyed by slug across the whole branch (see
//    score-lead-partial.ts:67-69). When the same slug appears in
//    multiple questions with different weights the lookup returns
//    the LAST one encountered — i.e. the score is wrong vs the
//    targeting math. We sidestep this by only choosing chips whose
//    slug is unique within the branch (or whose weights are uniform
//    across all duplicates).
//  - Unscored Q0 (request_type) is fixed by the requested variant
//    (`myself` for SELF, `friend_family` for FRIEND_FAMILY).
//  - Unscored Q1 (geographic_qualification) is always `yes_in_area`
//    so the geographic_qualification override never fires.
// ---------------------------------------------------------------------------

const REQUEST_TYPE_QUESTION_ID = 'request_type';
const GEOGRAPHIC_QUESTION_ID = 'geographic_qualification';

interface ChipPlan {
  question_id: string;
  chip_slug: string;
  chip_label: string;
  contributes_weight: number;
}

interface BranchPlan {
  branch: BranchPayload;
  bucket: Bucket;
  request_type: RequestType;
  /** Plan for unscored Q0/Q1 + scored questions, in question order. */
  chip_plan: ChipPlan[];
  /** Sum of chip score_weights chosen across scored questions. */
  branch_chip_sum: number;
  /** Predicted final clamped score (matches scoreBranch's math). */
  predicted_score: number;
  /** Reasoning trail for human inspection. */
  notes: string[];
}

function bucketRangeForRequestType(
  branch: BranchPayload,
  bucket: Bucket,
  rt: RequestType,
): [number, number] | null {
  const t = branch.thresholds;
  if (rt === 'SELF') {
    switch (bucket) {
      case 'HOT': return t.self.hot;
      case 'WARM': return t.self.warm;
      case 'COLD': return t.self.cold;
      case 'SPAM': return t.self.spam;
    }
  } else {
    switch (bucket) {
      case 'HOT': return t.family_friend.hot;
      case 'WARM': return t.family_friend.warm;
      case 'SPAM': return t.family_friend.spam;
      case 'COLD': return null; // no cold tier in family_friend
    }
  }
}

/**
 * Build the set of chip slugs that are SAFE to use under the
 * scoreBranch slug-collision bug. A slug is safe iff it appears in
 * exactly one question OR all of its occurrences carry the same weight.
 */
function safeSlugSet(branch: BranchPayload): Set<string> {
  const occurrences = new Map<string, number[]>();
  for (const q of branch.questions) {
    for (const c of q.chips) {
      const arr = occurrences.get(c.slug) ?? [];
      arr.push(c.score_weight);
      occurrences.set(c.slug, arr);
    }
  }
  const safe = new Set<string>();
  for (const [slug, weights] of occurrences) {
    if (weights.length === 1 || new Set(weights).size === 1) safe.add(slug);
  }
  return safe;
}

function midpoint(range: [number, number]): number {
  return (range[0] + range[1]) / 2;
}

/**
 * Brute-force search: pick one chip per scored question; minimise
 * |sum + bonus - bucket_midpoint| subject to landing inside the
 * bucket range. Returns null if no valid combination exists.
 */
function planScoredChips(
  scoredQuestions: BranchQuestion[],
  safe: Set<string>,
  contactBonus: number,
  whenBonus: number,
  range: [number, number],
): { plan: ChipPlan[]; branchSum: number; predicted: number } | null {
  const target = midpoint(range);
  const [lo, hi] = range;

  // Pre-filter chips per question to safe slugs only. Multi-select
  // questions: we still pick exactly one chip (single-slug capture)
  // because that's what the multi-turn HTTP harness sends per turn.
  const choices: BranchChip[][] = scoredQuestions.map((q) =>
    q.chips.filter((c) => safe.has(c.slug)),
  );

  // If any question has no safe chips, we can't plan it.
  for (let i = 0; i < choices.length; i++) {
    if (choices[i].length === 0) return null;
  }

  // Iterative odometer over the index space.
  const counts = choices.map((c) => c.length);
  const idx = new Array(choices.length).fill(0);
  let bestSum = Number.POSITIVE_INFINITY;
  let best: { picks: BranchChip[]; sum: number } | null = null;

  while (true) {
    const picks = choices.map((arr, i) => arr[idx[i]]);
    const sum = picks.reduce((acc, c) => acc + c.score_weight, 0);
    const total = sum + contactBonus + whenBonus;
    const clamped = Math.max(0, Math.min(100, total));
    if (clamped >= lo && clamped <= hi) {
      const dist = Math.abs(clamped - target);
      if (dist < bestSum) {
        bestSum = dist;
        best = { picks, sum };
      }
    }

    // Increment odometer.
    let k = 0;
    while (k < idx.length) {
      idx[k]++;
      if (idx[k] < counts[k]) break;
      idx[k] = 0;
      k++;
    }
    if (k === idx.length) break;
  }

  if (!best) return null;

  const plan: ChipPlan[] = scoredQuestions.map((q, i) => ({
    question_id: q.id,
    chip_slug: best!.picks[i].slug,
    chip_label: best!.picks[i].label,
    contributes_weight: best!.picks[i].score_weight,
  }));
  return {
    plan,
    branchSum: best.sum,
    predicted: Math.max(0, Math.min(100, best.sum + contactBonus + whenBonus)),
  };
}

/**
 * `captureLead` adds a contact bonus when contact info is captured.
 * See packages/api/src/lib/scoring/score-lead.ts and the orchestrator's
 * `computeContactBonus`. We use the branch-path value here because
 * fixtures all flow through the branch finalization path.
 */
const CONTACT_BONUS = CONTACT_BONUS_BRANCH;

function planBranchBucket(
  branch: BranchPayload,
  bucket: Bucket,
  rt: RequestType,
): BranchPlan | null {
  const range = bucketRangeForRequestType(branch, bucket, rt);
  if (!range) return null;
  const safe = safeSlugSet(branch);

  // Scored questions = positions ≥ 2 (skip Q0 request_type, Q1 geo).
  const scored = branch.questions
    .filter((q) => q.position >= 2)
    .sort((a, b) => a.position - b.position);

  const planned = planScoredChips(scored, safe, CONTACT_BONUS, WHEN_CHIP_BONUS, range);
  if (!planned) return null;

  // Compose the full per-question plan including unscored Q0/Q1.
  const fullPlan: ChipPlan[] = [
    {
      question_id: REQUEST_TYPE_QUESTION_ID,
      chip_slug: rt === 'SELF' ? 'myself' : 'friend_family',
      chip_label: rt === 'SELF' ? 'Myself' : 'Friend / Family Member',
      contributes_weight: 0,
    },
    {
      question_id: GEOGRAPHIC_QUESTION_ID,
      chip_slug: 'yes_in_area',
      chip_label: 'Yes',
      contributes_weight: 0,
    },
    ...planned.plan,
  ];

  return {
    branch,
    bucket,
    request_type: rt,
    chip_plan: fullPlan,
    branch_chip_sum: planned.branchSum,
    predicted_score: planned.predicted,
    notes: [
      `target_range=[${range[0]}..${range[1]}]`,
      `branch_sum=${planned.branchSum}`,
      `+contact_bonus=${CONTACT_BONUS}`,
      `+when_bonus=${WHEN_CHIP_BONUS} (chip=${WHEN_CHIP_SLUG})`,
      `predicted_clamped=${planned.predicted}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Build the full plan matrix.
// ---------------------------------------------------------------------------

interface PlanMatrix {
  scored: BranchPlan[];
  /** Branches × buckets we couldn't plan. */
  unplannable: Array<{ branch: string; bucket: Bucket; rt: RequestType; reason: string }>;
}

function buildPlanMatrix(): PlanMatrix {
  const scored: BranchPlan[] = [];
  const unplannable: PlanMatrix['unplannable'] = [];
  const buckets: Bucket[] = ['HOT', 'WARM', 'COLD', 'SPAM'];
  const variants: RequestType[] = ['SELF', 'FRIEND_FAMILY'];

  for (const branch of ALL_BRANCHES) {
    if (FLAG_BRANCH && `${branch.case_type_slug}/${branch.sub_type_slug}` !== FLAG_BRANCH) continue;
    for (const bucket of buckets) {
      if (FLAG_BUCKET && bucket !== FLAG_BUCKET) continue;
      for (const rt of variants) {
        const plan = planBranchBucket(branch, bucket, rt);
        if (!plan) {
          // family_friend has no COLD tier — silent skip (expected).
          if (rt === 'FRIEND_FAMILY' && bucket === 'COLD') continue;
          unplannable.push({
            branch: `${branch.case_type_slug}/${branch.sub_type_slug}`,
            bucket,
            rt,
            reason:
              'no chip combination produces an in-range score under safe-slug constraint',
          });
          continue;
        }
        scored.push(plan);
      }
    }
  }
  return { scored, unplannable };
}

// ---------------------------------------------------------------------------
// HTTP client — multi-turn /api/chat conversation driver
// ---------------------------------------------------------------------------

interface SopStateHeaderPayload {
  current: number;
  total: number;
  pending_step_id: string | null;
  pending_step_slug: string | null;
  is_finalized: boolean;
  captured_case_type_slug?: string | null;
  branch_active_chips?: Array<{ slug: string; label: string; score_weight?: number }> | null;
}

interface ChatTurnResult {
  sessionId: string;
  sopState: SopStateHeaderPayload | null;
  status: number;
  bodySnippet: string;
}

class ChatClient {
  private sessionId: string | null = null;

  constructor(
    private readonly apiBase: string,
    private readonly apiKey: string,
  ) {}

  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Send a single user-message turn. Drains the data-stream body but
   *  doesn't parse tokens (we only care about side-effects + headers). */
  async send(userText: string): Promise<ChatTurnResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
    };
    if (this.sessionId) headers['x-session-id'] = this.sessionId;

    const res = await fetch(`${this.apiBase}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [{ role: 'user', content: userText }],
      }),
    });

    const newSession = res.headers.get('x-session-id');
    if (newSession) this.sessionId = newSession;

    let sopState: SopStateHeaderPayload | null = null;
    const sopHeader = res.headers.get('x-sop-state');
    if (sopHeader) {
      try {
        sopState = JSON.parse(sopHeader);
      } catch {
        sopState = null;
      }
    }

    // Drain the body so the server's `onFinish` callback fires (where
    // captureLead, branch-orchestrator finalize, and lead UPDATE happen).
    // We do NOT parse the AI-SDK data-stream tokens.
    const body = await res.text();
    const bodySnippet = body.slice(0, 200);

    return {
      sessionId: this.sessionId ?? '',
      sopState,
      status: res.status,
      bodySnippet,
    };
  }
}

// ---------------------------------------------------------------------------
// Walker — drives a full conversation: 6-step default SOP +
// 7+2 branch questions + contact form + branch finalization.
// ---------------------------------------------------------------------------

interface WalkerInput {
  plan: BranchPlan;
  /** Synthetic name for this fixture (e.g. "FixtureHotSelf01"). */
  fixtureName: string;
  fixtureEmail: string;
  fixturePhone: string;
}

interface WalkerOutput {
  sessionId: string;
  /** True if conversation reached SOP-finalized AND went through every branch question AND submitted the final orchestrator turn. */
  completedAllTurns: boolean;
  turnCount: number;
  lastSopState: SopStateHeaderPayload | null;
  failureReason?: string;
}

const SLEEP_BETWEEN_TURNS_MS = 50; // gentle pacing; the LLM is the bottleneck anyway
const PER_CONVERSATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per conversation
const PARALLEL_CONVERSATIONS = Number(process.env.SEED_PARALLEL ?? '3');

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runConversation(input: WalkerInput): Promise<WalkerOutput> {
  const { plan, fixtureName, fixtureEmail, fixturePhone } = input;
  const branchSlug = `${plan.branch.case_type_slug}/${plan.branch.sub_type_slug}`;
  const client = new ChatClient(API_BASE, API_KEY);
  let lastSopState: SopStateHeaderPayload | null = null;
  let turns = 0;

  /**
   * Send a turn and update lastSopState. Throws on non-2xx.
   */
  async function sendTurn(text: string, label: string): Promise<ChatTurnResult> {
    turns++;
    const res = await client.send(text);
    if (res.status !== 200) {
      throw new Error(
        `[${branchSlug}/${plan.bucket}/${plan.request_type}] turn ${turns} (${label}) — HTTP ${res.status}: ${res.bodySnippet}`,
      );
    }
    lastSopState = res.sopState;
    await sleep(SLEEP_BETWEEN_TURNS_MS);
    return res;
  }

  try {
    // -- Step 1: case_type
    await sendTurn(plan.branch.case_type_slug, 'case_type');

    // -- Step 2: sub_type
    await sendTurn(plan.branch.sub_type_slug, 'sub_type');

    // -- Step 3: where (free text). Fixture-tagged so cleanup can also
    //    match on this if needed; the brief_description tag is the
    //    canonical cleanup key.
    await sendTurn('Pittsburgh, PA', 'where');

    // -- Step 4: what (free text — short, generic description; the
    //    LLM rewrites it into brief_description anyway, so detail
    //    here is mostly cosmetic for log readability).
    await sendTurn(
      `It's a routine ${branchSlug.replace('/', ' / ')} matter.`,
      'what',
    );

    // -- Step 5: when — pinned to the chip slug used by the planner.
    await sendTurn(WHEN_CHIP_SLUG, 'when');

    // -- Step 6: contact — single message containing email + phone +
    //    name (extractContactPayload regex matches all three).
    await sendTurn(
      `My name is ${fixtureName}, my email is ${fixtureEmail}, my phone is ${fixturePhone}`,
      'contact',
    );

    // After Step 6 the SOP finalizes; the branch orchestrator activates
    // on the NEXT visitor message. Send a short kickoff so it presents
    // the first branch question.
    if (!lastSopState?.is_finalized) {
      // Some LLM turns finalize on the contact submit itself; others
      // need one more nudge. Send a benign kickoff; the orchestrator
      // doesn't care about the content here.
      await sendTurn('ok', 'kickoff_branch');
    }

    // -- Branch questions (positions 0..N). Send the chip slug for each
    //    in order. The orchestrator advances one question per turn.
    for (const c of plan.chip_plan) {
      await sendTurn(c.chip_slug, `branch:${c.question_id}=${c.chip_slug}`);
    }

    return {
      sessionId: client.getSessionId() ?? '',
      completedAllTurns: true,
      turnCount: turns,
      lastSopState,
    };
  } catch (err) {
    return {
      sessionId: client.getSessionId() ?? '',
      completedAllTurns: false,
      turnCount: turns,
      lastSopState,
      failureReason: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Lead read-back — query the DB to confirm classification + lead_score
// for a given session_id.
// ---------------------------------------------------------------------------

interface LeadRow {
  id: string;
  classification: string | null;
  lead_score: number | null;
  request_type: string | null;
  branch_incomplete: boolean | null;
  contact_email: string | null;
  contact_phone: string | null;
  name: string | null;
  brief_description: string | null;
  created_at: string;
}

async function readLeadBySession(sessionId: string): Promise<LeadRow | null> {
  if (!sessionId) return null;
  const sql = neon(DATABASE_URL!);
  const rows = (await sql`
    SELECT id, classification, lead_score, request_type, branch_incomplete,
           contact_email, contact_phone, name, brief_description, created_at
    FROM leads
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC
    LIMIT 1
  `) as Array<LeadRow>;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (FLAG_CLEAN) {
    logSection('Cleanup mode');
    const sql = neon(DATABASE_URL!);
    // Match by either: (a) fixture email domain (current marker), or
    // (b) legacy brief_description tag (backward-compat for runs
    // generated before the marker switch).
    // notifications carry a FK to leads.id; delete those first.
    const notifs = (await sql`
      DELETE FROM notifications
      WHERE lead_id IN (
        SELECT id FROM leads
        WHERE contact_email LIKE ${'%' + FIXTURE_EMAIL_DOMAIN}
           OR brief_description LIKE ${LEGACY_FIXTURE_TAG + '%'}
      )
      RETURNING id
    `) as Array<{ id: string }>;
    const result = (await sql`
      DELETE FROM leads
      WHERE contact_email LIKE ${'%' + FIXTURE_EMAIL_DOMAIN}
         OR brief_description LIKE ${LEGACY_FIXTURE_TAG + '%'}
      RETURNING id
    `) as Array<{ id: string }>;
    log(`Deleted ${result.length} fixture lead(s) and ${notifs.length} associated notification(s).`);
    return;
  }

  const matrix = buildPlanMatrix();

  logSection('Plan summary');
  log(`Scored plans: ${matrix.scored.length}`);
  log(`Unplannable:  ${matrix.unplannable.length}`);
  if (matrix.unplannable.length > 0) {
    for (const u of matrix.unplannable) {
      log(`  ! ${u.branch} ${u.bucket}/${u.rt} — ${u.reason}`);
    }
  }

  if (FLAG_DRY_RUN) {
    logSection('Plan detail (dry-run)');
    for (const p of matrix.scored) {
      const branchSlug = `${p.branch.case_type_slug}/${p.branch.sub_type_slug}`;
      log(
        `\n[${branchSlug}] ${p.bucket} ${p.request_type}  → predicted=${p.predicted_score}`,
      );
      for (const c of p.chip_plan) {
        log(`    ${c.question_id.padEnd(28)} ${c.chip_slug.padEnd(28)} ${String(c.contributes_weight).padStart(4)}`);
      }
      log(`    notes: ${p.notes.join(', ')}`);
    }
    return;
  }

  // Execute every plan against the live API.
  logSection(`Executing ${matrix.scored.length} conversation(s) against ${API_BASE} (parallel=${PARALLEL_CONVERSATIONS})`);

  type Result = {
    plan: BranchPlan;
    walk: WalkerOutput;
    lead: LeadRow | null;
  };
  const results: Result[] = [];

  // Tiny concurrency pool — ordered work queue + N parallel runners.
  const startedAt = Date.now();
  let nextIndex = 0;
  let completed = 0;

  async function runOne(planIndex: number): Promise<void> {
    const plan = matrix.scored[planIndex];
    const branchSlug = `${plan.branch.case_type_slug}/${plan.branch.sub_type_slug}`;
    const tag = `${branchSlug}/${plan.bucket}/${plan.request_type}`;
    const fixtureName = `Fixture ${plan.bucket} ${plan.request_type[0]}${planIndex.toString().padStart(2, '0')}`;
    // Avoid `+` in the email — extractContactPayload uses
    // /[\w.-]+@[\w.-]+\.\w+/ which doesn't match `+`, so an address
    // like `fixture+1@…` gets truncated to `1@…` and we lose the
    // index discriminator.
    const fixtureEmail = `fixture-${planIndex}@legalchatbot.test`;
    const fixturePhone = `555-100-${planIndex.toString().padStart(4, '0').slice(-4)}`;

    const startTurn = Date.now();

    // Race walker against per-conversation timeout.
    const walk = await Promise.race<WalkerOutput>([
      runConversation({ plan, fixtureName, fixtureEmail, fixturePhone }),
      sleep(PER_CONVERSATION_TIMEOUT_MS).then(() => ({
        sessionId: '',
        completedAllTurns: false,
        turnCount: 0,
        lastSopState: null,
        failureReason: `timeout after ${PER_CONVERSATION_TIMEOUT_MS / 1000}s`,
      } as WalkerOutput)),
    ]);

    const elapsed = ((Date.now() - startTurn) / 1000).toFixed(1);

    if (!walk.completedAllTurns) {
      console.log(`[${(++completed).toString().padStart(3)}/${matrix.scored.length}] ✗ ${tag} after ${walk.turnCount} turns (${elapsed}s): ${walk.failureReason}`);
      results.push({ plan, walk, lead: null });
      return;
    }

    await sleep(800);
    const lead = await readLeadBySession(walk.sessionId);
    if (!lead) {
      console.log(`[${(++completed).toString().padStart(3)}/${matrix.scored.length}] ✗ ${tag} NO LEAD ROW (${elapsed}s)`);
      results.push({ plan, walk, lead: null });
      return;
    }

    const ok = lead.classification === plan.bucket;
    const verdict = ok ? '✓' : '⚠';
    console.log(
      `[${(++completed).toString().padStart(3)}/${matrix.scored.length}] ${verdict} ${tag} predicted=${plan.predicted_score}/${plan.bucket} actual=${lead.lead_score}/${lead.classification} (${elapsed}s, ${walk.turnCount} turns)`,
    );
    results.push({ plan, walk, lead });
  }

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= matrix.scored.length) break;
      await runOne(i);
    }
  }

  await Promise.all(Array.from({ length: PARALLEL_CONVERSATIONS }, () => worker()));

  const totalSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  // Summary
  logSection(`Run summary (total ${totalSeconds}s)`);
  const totals = {
    completed: results.filter((r) => r.walk.completedAllTurns).length,
    leadInserted: results.filter((r) => r.lead).length,
    matched: results.filter((r) => r.lead && r.lead.classification === r.plan.bucket).length,
    mismatched: results.filter((r) => r.lead && r.lead.classification !== r.plan.bucket).length,
    failedConversations: results.filter((r) => !r.walk.completedAllTurns).length,
    leadMissing: results.filter((r) => r.walk.completedAllTurns && !r.lead).length,
  };
  log(JSON.stringify(totals, null, 2));

  if (totals.mismatched > 0) {
    logSection('Classification mismatches (predicted ≠ actual)');
    for (const r of results) {
      if (r.lead && r.lead.classification !== r.plan.bucket) {
        const branchSlug = `${r.plan.branch.case_type_slug}/${r.plan.branch.sub_type_slug}`;
        log(
          `  ! ${branchSlug} ${r.plan.bucket}/${r.plan.request_type} — ` +
            `predicted=${r.plan.predicted_score}, actual=${r.lead.lead_score}/${r.lead.classification} (lead=${r.lead.id})`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
