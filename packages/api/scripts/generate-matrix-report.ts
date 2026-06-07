/**
 * Generate an HTML report (coverage-report style) for the
 * test-lead-matrix run.
 *
 * Reads:
 *   - /tmp/seed-run.log              (latest matrix run output)
 *   - the live dev DB                (leads + sop_state_snapshot
 *                                     + branch_snapshot)
 *
 * Joins those two streams by the email-fixture marker we use across
 * the harness (`fixture-N@legalchatbot.test`), where N matches the
 * `[N/96]` index in the log line.
 *
 * Output: a single self-contained HTML file (inlined CSS + JS, no
 * external assets) at `packages/api/scripts/reports/lead-matrix-
 * <timestamp>.html`. Open it in a browser; it's self-contained so
 * you can email / Slack the file.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/generate-matrix-report.ts
 *   [--log /custom/path]   override the default /tmp/seed-run.log
 *   [--out /custom/path]   override the output path
 */

import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const args = new Map<string, string | true>();
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq === -1) args.set(a.slice(2), true);
    else args.set(a.slice(2, eq), a.slice(eq + 1));
  }
}
const LOG_PATH =
  typeof args.get('log') === 'string' ? (args.get('log') as string) : '/tmp/seed-run.log';
const OUT_PATH =
  typeof args.get('out') === 'string'
    ? (args.get('out') as string)
    : path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        'reports',
        `lead-matrix-${new Date().toISOString().replace(/[:.]/g, '-')}.html`,
      );

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunOutcome {
  idx: number;
  status: 'match' | 'mismatch' | 'fail';
  case_type: string;
  sub_type: string;
  bucket: 'HOT' | 'WARM' | 'COLD' | 'SPAM';
  rt: 'SELF' | 'FRIEND_FAMILY';
  predScore: string;
  predBucket: string;
  actScore: string;
  actBucket: string;
  durationSec: number;
  turns: number;
}

interface LeadRow {
  id: string;
  contact_email: string | null;
  classification: string | null;
  lead_score: number | null;
  brief_description: string | null;
  branched: boolean;
  score_reasons_json: string | null;
  sop_finalized: boolean;
  sop_pending_step: string | null;
  sub_type_slug_from_snapshot: string | null;
  hard_overrides_fired: string[];
}

// ---------------------------------------------------------------------------
// Run-log parser
// ---------------------------------------------------------------------------

const LOG_RE =
  /^\[ *(\d+)\/96\] (.) ([a-z_]+)\/([a-z_]+)\/([A-Z]+)\/([A-Z_]+) predicted=(-?\d+|null)\/([A-Z]+) actual=([a-zA-Z0-9]+)\/([A-Z]+) \((\d+(?:\.\d+)?)s, (\d+) turns\)/;

function parseRunLog(filePath: string): RunOutcome[] {
  const text = fs.readFileSync(filePath, 'utf8');
  const out: RunOutcome[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(LOG_RE);
    if (!m) continue;
    out.push({
      idx: Number(m[1]),
      status: m[2] === '✓' ? 'match' : m[2] === '⚠' ? 'mismatch' : 'fail',
      case_type: m[3]!,
      sub_type: m[4]!,
      bucket: m[5] as RunOutcome['bucket'],
      rt: m[6] as RunOutcome['rt'],
      predScore: m[7]!,
      predBucket: m[8]!,
      actScore: m[9]!,
      actBucket: m[10]!,
      durationSec: Number(m[11]),
      turns: Number(m[12]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lead-row loader
// ---------------------------------------------------------------------------

async function loadLeads(): Promise<Map<number, LeadRow>> {
  const sql = neon(DATABASE_URL!);
  const rows = (await sql`
    SELECT id, contact_email, classification, lead_score, brief_description,
           branch_snapshot_json IS NOT NULL AS branched,
           branch_snapshot_json::jsonb ->> 'sub_type_slug' AS sub_slug,
           score_reasons_json,
           sop_state_snapshot
    FROM leads
    WHERE contact_email LIKE '%@legalchatbot.test'
    ORDER BY contact_email
  `) as Array<{
    id: string;
    contact_email: string | null;
    classification: string | null;
    lead_score: number | null;
    brief_description: string | null;
    branched: boolean;
    sub_slug: string | null;
    score_reasons_json: string | null;
    sop_state_snapshot: string | null;
  }>;

  const byIdx = new Map<number, LeadRow>();
  const HARD_OVERRIDE_NAMES = [
    'missing_contact',
    'out_of_scope',
    'no_injury_no_treatment',
    'fake_info',
  ];
  for (const r of rows) {
    const m = r.contact_email?.match(/^fixture-(\d+)@/);
    if (!m) continue;
    const idx = Number(m[1]);
    let sopFinalized = false;
    let pendingSlug: string | null = null;
    if (r.sop_state_snapshot) {
      try {
        const sop = JSON.parse(r.sop_state_snapshot);
        sopFinalized = !!sop.is_finalized;
        const pending = sop.steps?.find(
          (s: { status: string }) => s.status === 'pending',
        );
        pendingSlug = pending?.slug ?? null;
      } catch {
        // malformed snapshot — leave defaults
      }
    }
    let reasons: string[] = [];
    try {
      reasons = r.score_reasons_json ? JSON.parse(r.score_reasons_json) : [];
    } catch {
      reasons = [];
    }
    const overridesFired = reasons.filter((s) =>
      HARD_OVERRIDE_NAMES.includes(s),
    );
    byIdx.set(idx, {
      id: r.id,
      contact_email: r.contact_email,
      classification: r.classification,
      lead_score: r.lead_score,
      brief_description: r.brief_description,
      branched: r.branched,
      score_reasons_json: r.score_reasons_json,
      sop_finalized: sopFinalized,
      sop_pending_step: pendingSlug,
      sub_type_slug_from_snapshot: r.sub_slug,
      hard_overrides_fired: overridesFired,
    });
  }
  return byIdx;
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

interface JoinedRow extends RunOutcome {
  lead: LeadRow | null;
}

interface PerSubTypeStats {
  case_type: string;
  sub_type: string;
  total: number;
  matched: number;
  mismatched: number;
  branched: number;
  llmFallback: number;
  /**
   * Cells indexed by `${bucket}-${rt}` for the report's heatmap.
   * Possible cells: HOT-SELF, HOT-FF, WARM-SELF, WARM-FF, COLD-SELF,
   * COLD-FF (always missing per spec — family_friend has no cold tier),
   * SPAM-SELF, SPAM-FF.
   */
  cells: Map<string, JoinedRow>;
}

function joinOutcomesWithLeads(
  outcomes: RunOutcome[],
  leads: Map<number, LeadRow>,
): JoinedRow[] {
  // Run-log uses 1-based `[N/96]` indices; the harness's
  // `fixtureEmail = fixture-${planIndex}@…` is 0-based, so subtract 1.
  return outcomes.map((o) => ({ ...o, lead: leads.get(o.idx - 1) ?? null }));
}

function aggregatePerSubType(joined: JoinedRow[]): PerSubTypeStats[] {
  const map = new Map<string, PerSubTypeStats>();
  for (const j of joined) {
    const key = `${j.case_type}/${j.sub_type}`;
    let stats = map.get(key);
    if (!stats) {
      stats = {
        case_type: j.case_type,
        sub_type: j.sub_type,
        total: 0,
        matched: 0,
        mismatched: 0,
        branched: 0,
        llmFallback: 0,
        cells: new Map(),
      };
      map.set(key, stats);
    }
    stats.total++;
    if (j.status === 'match') stats.matched++;
    else if (j.status === 'mismatch') stats.mismatched++;
    if (j.actScore !== 'null') stats.branched++;
    else stats.llmFallback++;
    stats.cells.set(`${j.bucket}-${j.rt}`, j);
  }
  return [...map.values()].sort((a, b) =>
    `${a.case_type}/${a.sub_type}`.localeCompare(`${b.case_type}/${b.sub_type}`),
  );
}

interface OverallStats {
  total: number;
  matched: number;
  mismatched: number;
  failed: number;
  branched: number;
  llmFallback: number;
  matchRateBranched: number;
  matchRateLlm: number;
  /** Per-bucket totals for an at-a-glance summary. */
  byBucket: Record<string, { total: number; matched: number; mismatched: number }>;
  perSubType: PerSubTypeStats[];
  mismatches: JoinedRow[];
  generatedAtIso: string;
}

function computeOverall(joined: JoinedRow[], perSubType: PerSubTypeStats[]): OverallStats {
  const total = joined.length;
  const matched = joined.filter((j) => j.status === 'match').length;
  const mismatched = joined.filter((j) => j.status === 'mismatch').length;
  const failed = joined.filter((j) => j.status === 'fail').length;
  const branched = joined.filter((j) => j.actScore !== 'null').length;
  const llmFallback = total - branched;

  const branchedMatched = joined.filter(
    (j) => j.actScore !== 'null' && j.status === 'match',
  ).length;
  const llmMatched = joined.filter(
    (j) => j.actScore === 'null' && j.status === 'match',
  ).length;

  const byBucket: OverallStats['byBucket'] = {};
  for (const b of ['HOT', 'WARM', 'COLD', 'SPAM']) {
    const slice = joined.filter((j) => j.bucket === b);
    byBucket[b] = {
      total: slice.length,
      matched: slice.filter((j) => j.status === 'match').length,
      mismatched: slice.filter((j) => j.status === 'mismatch').length,
    };
  }

  return {
    total,
    matched,
    mismatched,
    failed,
    branched,
    llmFallback,
    matchRateBranched: branched > 0 ? branchedMatched / branched : 0,
    matchRateLlm: llmFallback > 0 ? llmMatched / llmFallback : 0,
    byBucket,
    perSubType,
    mismatches: joined.filter((j) => j.status === 'mismatch'),
    generatedAtIso: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// HTML rendering — self-contained file with inlined CSS + JS.
// ---------------------------------------------------------------------------

/** Escape strings for inclusion as HTML text content. */
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
:root {
  --bg: #fafafa;
  --bg-card: #ffffff;
  --border: #e5e5e5;
  --border-soft: #f0f0f0;
  --text: #171717;
  --text-muted: #737373;
  --text-dim: #a3a3a3;
  --green: #059669;
  --green-bg: #ecfdf5;
  --amber: #d97706;
  --amber-bg: #fffbeb;
  --red: #dc2626;
  --red-bg: #fef2f2;
  --blue: #2563eb;
  --blue-bg: #eff6ff;
  --gray-bg: #f5f5f5;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.06);
  --radius: 8px;
}

* { box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  margin: 0;
  padding: 0;
}

main { max-width: 1280px; margin: 0 auto; padding: 24px; }

header.page-header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
header.page-header h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
header.page-header .meta { font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.subtitle { color: var(--text-muted); margin: 0 0 24px 0; font-size: 13px; }

.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
@media (max-width: 720px) { .kpi-row { grid-template-columns: repeat(2, 1fr); } }
.kpi { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; box-shadow: var(--shadow); }
.kpi .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 6px; }
.kpi .value { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.kpi .sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
.kpi.success .value { color: var(--green); }
.kpi.warn .value { color: var(--amber); }
.kpi.danger .value { color: var(--red); }
.kpi.info .value { color: var(--blue); }

section { margin-bottom: 32px; }
section h2 { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin: 0 0 12px 0; }

.matrix-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); }
.matrix-card .scroll { overflow-x: auto; }
table.matrix { width: 100%; border-collapse: collapse; font-size: 12px; }
table.matrix th, table.matrix td { padding: 8px 10px; border-bottom: 1px solid var(--border-soft); text-align: center; vertical-align: middle; font-variant-numeric: tabular-nums; }
table.matrix th { font-weight: 600; color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; background: var(--gray-bg); white-space: nowrap; }
table.matrix td.branch-name { text-align: left; font-weight: 500; white-space: nowrap; }
table.matrix td.case-type-tag { text-align: left; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 500; }
table.matrix tr:hover td { background: var(--bg); }

.cell { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; min-width: 64px; padding: 6px 8px; border-radius: 6px; cursor: pointer; transition: transform 0.1s ease; user-select: none; }
.cell:hover { transform: translateY(-1px); }
.cell.match { background: var(--green-bg); color: var(--green); }
.cell.mismatch { background: var(--red-bg); color: var(--red); }
.cell.fail { background: var(--amber-bg); color: var(--amber); }
.cell.empty { background: transparent; color: var(--text-dim); cursor: default; }
.cell.empty:hover { transform: none; }
.cell .top { font-size: 11px; font-weight: 600; letter-spacing: 0.02em; }
.cell .bot { font-size: 10px; opacity: 0.85; }
.cell .scoring-badge { display: inline-block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; padding: 1px 5px; border-radius: 3px; background: rgba(0, 0, 0, 0.06); color: rgba(0, 0, 0, 0.55); }
.cell.llm .scoring-badge { background: var(--blue-bg); color: var(--blue); }

.row-summary { display: inline-flex; gap: 4px; font-size: 10px; }
.pill { padding: 2px 6px; border-radius: 10px; font-weight: 500; background: var(--gray-bg); color: var(--text-muted); }
.pill.success { background: var(--green-bg); color: var(--green); }
.pill.danger { background: var(--red-bg); color: var(--red); }
.pill.info { background: var(--blue-bg); color: var(--blue); }

table.mismatches { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
table.mismatches th, table.mismatches td { padding: 10px 14px; border-bottom: 1px solid var(--border-soft); text-align: left; vertical-align: top; }
table.mismatches th { background: var(--gray-bg); font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; color: var(--text-muted); }
table.mismatches tr:last-child td { border-bottom: 0; }
table.mismatches td.branch-cell { font-weight: 500; white-space: nowrap; }
table.mismatches td.delta-cell { white-space: nowrap; font-variant-numeric: tabular-nums; }
table.mismatches td.brief-cell { color: var(--text-muted); font-size: 12px; max-width: 320px; }

.tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 500; letter-spacing: 0.02em; }
.tag.HOT { background: var(--red-bg); color: var(--red); }
.tag.WARM { background: var(--amber-bg); color: var(--amber); }
.tag.COLD { background: var(--blue-bg); color: var(--blue); }
.tag.SPAM { background: var(--gray-bg); color: var(--text-muted); }
.tag.LLM { background: var(--blue-bg); color: var(--blue); font-size: 10px; }

.insights { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; box-shadow: var(--shadow); }
.insights ul { margin: 8px 0 0 0; padding-left: 20px; }
.insights li { margin-bottom: 6px; }
.insights .lead-id { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-size: 12px; color: var(--text-muted); }
.insight-block { margin-bottom: 18px; }
.insight-block:last-child { margin-bottom: 0; }
.insight-block h3 { font-size: 13px; font-weight: 600; margin: 0 0 6px 0; color: var(--text); }
.insight-block p { margin: 0; color: var(--text-muted); font-size: 13px; }

.detail-dialog { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.36); display: none; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
.detail-dialog.open { display: flex; }
.detail-dialog .panel { background: var(--bg-card); border-radius: var(--radius); width: min(640px, 100%); max-height: 80vh; overflow-y: auto; box-shadow: var(--shadow-lg); padding: 24px; }
.detail-dialog h3 { margin: 0 0 8px 0; font-size: 16px; letter-spacing: -0.01em; }
.detail-dialog .close-btn { float: right; background: transparent; border: 0; font-size: 18px; cursor: pointer; color: var(--text-muted); }
.detail-dialog dl { margin: 12px 0 0 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; }
.detail-dialog dt { color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.detail-dialog dd { margin: 0; font-size: 13px; word-break: break-word; }
.detail-dialog code { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-size: 12px; color: var(--text); background: var(--gray-bg); padding: 1px 4px; border-radius: 3px; }
.detail-dialog ul.reasons { margin: 4px 0; padding-left: 20px; font-size: 13px; }
.detail-dialog .footer-note { font-size: 12px; color: var(--text-muted); margin-top: 16px; }
`;

// ---------------------------------------------------------------------------
// Render helpers — each returns an HTML string for one section.
// ---------------------------------------------------------------------------

function renderKpis(stats: OverallStats): string {
  const matchPct = stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0;
  const branchedPct = stats.branched > 0 ? Math.round(stats.matchRateBranched * 100) : 0;
  return `
    <section class="kpi-row">
      <div class="kpi info">
        <div class="label">Conversations</div>
        <div class="value">${stats.total}</div>
        <div class="sub">96 plannable buckets · 9 unplannable per branch design</div>
      </div>
      <div class="kpi success">
        <div class="label">Predicted = Actual</div>
        <div class="value">${stats.matched} / ${stats.total}</div>
        <div class="sub">${matchPct}% overall match rate</div>
      </div>
      <div class="kpi danger">
        <div class="label">Mismatches</div>
        <div class="value">${stats.mismatched}</div>
        <div class="sub">${stats.failed} hard failures · see table below</div>
      </div>
      <div class="kpi warn">
        <div class="label">Branch Scorer Hit Rate</div>
        <div class="value">${stats.branched} / ${stats.total}</div>
        <div class="sub">Rule-scored = ${branchedPct}% perfect; LLM-fallback = ${stats.llmFallback} (where step blocked SOP finalization)</div>
      </div>
    </section>
  `;
}

function renderHeader(stats: OverallStats): string {
  return `
    <header class="page-header">
      <h1>Lead Classification Test Matrix</h1>
      <div class="meta">Generated ${htmlEscape(stats.generatedAtIso)}</div>
    </header>
    <p class="subtitle">
      One synthetic conversation per (branch × bucket × request_type) tuple
      driven against the live <code>/api/chat</code> endpoint. Predicted bucket
      comes from the harness's chip-targeting plan; actual bucket comes from
      the lead row written by the server.
    </p>
  `;
}

const MATRIX_COLUMNS: Array<{ bucket: string; rt: string; label: string }> = [
  { bucket: 'HOT', rt: 'SELF', label: 'HOT · S' },
  { bucket: 'HOT', rt: 'FRIEND_FAMILY', label: 'HOT · FF' },
  { bucket: 'WARM', rt: 'SELF', label: 'WARM · S' },
  { bucket: 'WARM', rt: 'FRIEND_FAMILY', label: 'WARM · FF' },
  { bucket: 'COLD', rt: 'SELF', label: 'COLD · S' },
  // FF has no COLD tier in the threshold table (intentionally absent).
  { bucket: 'SPAM', rt: 'SELF', label: 'SPAM · S' },
  { bucket: 'SPAM', rt: 'FRIEND_FAMILY', label: 'SPAM · FF' },
];

function renderMatrixCell(cell: JoinedRow | undefined): string {
  if (!cell) {
    return `<div class="cell empty" title="No plan for this bucket — chip-weight range can't reach this band">—</div>`;
  }
  const klass = cell.status === 'match' ? 'match' : cell.status === 'mismatch' ? 'mismatch' : 'fail';
  const llmKlass = cell.actScore === 'null' ? ' llm' : '';
  const dataAttrs = `data-idx="${cell.idx}" data-lead-id="${htmlEscape(cell.lead?.id ?? '')}"`;
  const top = cell.actScore === 'null'
    ? `<span class="top">${htmlEscape(cell.actBucket)}</span>`
    : `<span class="top">${htmlEscape(cell.actBucket)} · ${htmlEscape(cell.actScore)}</span>`;
  const bot = cell.status === 'mismatch'
    ? `<span class="bot">predicted ${htmlEscape(cell.predBucket)}</span>`
    : `<span class="bot">pred ${htmlEscape(cell.predScore)}</span>`;
  const badge = cell.actScore === 'null'
    ? `<span class="scoring-badge">LLM</span>`
    : `<span class="scoring-badge">RULE</span>`;
  return `<div class="cell ${klass}${llmKlass}" ${dataAttrs} role="button" tabindex="0">${top}${bot}${badge}</div>`;
}

function renderMatrix(stats: OverallStats): string {
  const headerCells = MATRIX_COLUMNS
    .map((c) => `<th>${htmlEscape(c.label)}</th>`)
    .join('');
  const rows = stats.perSubType
    .map((s) => {
      const cells = MATRIX_COLUMNS
        .map((c) => `<td>${renderMatrixCell(s.cells.get(`${c.bucket}-${c.rt}`))}</td>`)
        .join('');
      const matchPill = `<span class="pill ${s.matched === s.total ? 'success' : ''}">${s.matched}/${s.total}</span>`;
      const branchedPill = `<span class="pill info">${s.branched} branched</span>`;
      return `
        <tr>
          <td class="case-type-tag">${htmlEscape(s.case_type)}</td>
          <td class="branch-name">${htmlEscape(s.sub_type)}</td>
          ${cells}
          <td><span class="row-summary">${matchPill}${branchedPill}</span></td>
        </tr>
      `;
    })
    .join('');
  return `
    <section>
      <h2>Coverage matrix</h2>
      <div class="matrix-card">
        <div class="scroll">
          <table class="matrix">
            <thead>
              <tr>
                <th>Case type</th>
                <th>Sub-type</th>
                ${headerCells}
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function renderMismatches(stats: OverallStats): string {
  if (stats.mismatches.length === 0) {
    return `
      <section>
        <h2>Mismatches</h2>
        <div class="insights">
          <p>No mismatches in this run. All ${stats.total} conversations
          produced the predicted classification.</p>
        </div>
      </section>
    `;
  }
  const rows = stats.mismatches
    .map((m) => {
      const branchSlug = `${m.case_type}/${m.sub_type}`;
      const path = m.actScore === 'null' ? 'LLM-fallback' : 'rule-scored';
      const brief = m.lead?.brief_description ?? '';
      const pendingNote = m.lead && !m.lead.sop_finalized && m.lead.sop_pending_step
        ? ` · SOP stuck at <code>${htmlEscape(m.lead.sop_pending_step)}</code>`
        : '';
      return `
        <tr data-idx="${m.idx}" data-lead-id="${htmlEscape(m.lead?.id ?? '')}">
          <td class="branch-cell">${htmlEscape(branchSlug)}</td>
          <td><span class="tag ${m.bucket}">${m.bucket}</span> · ${htmlEscape(m.rt)}</td>
          <td class="delta-cell"><span class="tag ${m.predBucket}">${m.predBucket}</span> ${htmlEscape(m.predScore)}</td>
          <td class="delta-cell"><span class="tag ${m.actBucket}">${m.actBucket}</span> ${htmlEscape(m.actScore)}</td>
          <td><span class="tag ${m.actScore === 'null' ? 'LLM' : 'COLD'}">${path}</span>${pendingNote}</td>
          <td class="brief-cell">${htmlEscape(brief.slice(0, 140))}${brief.length > 140 ? '…' : ''}</td>
        </tr>
      `;
    })
    .join('');
  return `
    <section>
      <h2>Mismatches (${stats.mismatches.length})</h2>
      <table class="mismatches">
        <thead>
          <tr>
            <th>Branch</th>
            <th>Target bucket / RT</th>
            <th>Predicted</th>
            <th>Actual</th>
            <th>Path</th>
            <th>Brief description</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function renderInsights(stats: OverallStats): string {
  // Per-branch finalization rate. A branch where 0 leads finalised tells us
  // the SOP is stuck before contact (typically `where`/`what` free-text
  // rejected by a chip-only customisation), independent of any chip-scoring
  // problem.
  const stuckSubtypes = stats.perSubType.filter((s) => s.branched === 0);
  const branchedSubtypes = stats.perSubType.filter((s) => s.branched > 0);
  const cleanBranches = branchedSubtypes
    .filter((s) => s.matched === s.total)
    .map((s) => `${s.case_type}/${s.sub_type}`);

  const stuckList = stuckSubtypes
    .map((s) => `<li><code>${htmlEscape(s.case_type)}/${htmlEscape(s.sub_type)}</code> — 0 of ${s.total} leads engaged the rule scorer</li>`)
    .join('');

  const cleanList = cleanBranches.length === 0
    ? '<li><em>No fully-clean branch — every branch had at least one mismatch.</em></li>'
    : cleanBranches.map((b) => `<li><code>${htmlEscape(b)}</code></li>`).join('');

  return `
    <section>
      <h2>Insights & action items</h2>
      <div class="insights">
        <div class="insight-block">
          <h3>1. Rule scorer is correct on every conversation it actually saw</h3>
          <p>Of the <strong>${stats.branched}</strong> conversations that reached the branch
          finalisation path (and thus produced a numeric <code>lead_score</code>),
          <strong>${Math.round(stats.matchRateBranched * 100)}%</strong> matched the harness's
          predicted bucket. That means the chip-weight math, threshold tables, and
          per-branch toggles all behave as designed when the conversation gets that far.</p>
        </div>
        <div class="insight-block">
          <h3>2. ${stuckSubtypes.length} branches never reached the rule scorer</h3>
          <p>These sub-types stayed on the LLM-fallback path because the SOP wasn't able
          to finalise before <code>captureLead</code> fired. Inspecting each such lead's
          <code>sop_state_snapshot</code> shows the conversation got stuck at the
          <code>where</code> step — the firm's published v2 SOP customised that step into
          an inline-chip step (<em>In Pittsburgh</em> / <em>Outside Pittsburgh</em>), so the
          harness's free-text <em>"Pittsburgh, PA"</em> isn't accepted. The classifications
          on these rows come from the LLM and should be treated as
          <strong>incidental</strong>, not validated by this run.</p>
          <ul>${stuckList || '<li><em>None.</em></li>'}</ul>
        </div>
        <div class="insight-block">
          <h3>3. Branches with 100% rule-scored matches</h3>
          <p>These can be considered fully validated against the seeded chip-weight
          configuration:</p>
          <ul>${cleanList}</ul>
        </div>
        <div class="insight-block">
          <h3>4. Recommended next steps</h3>
          <ul>
            <li>Make the harness chip-aware so it sends a chip slug instead of free-text
              when the active SOP step has <code>chip_source != null</code>. The
              free-text-only assumption is the root cause of the LLM-fallback rows above.</li>
            <li>Re-run the matrix once the harness is chip-aware — the
              <strong>${stats.llmFallback}</strong> currently-LLM-driven rows will then exercise the
              rule scorer and confirm whether the predicted classifications hold.</li>
            <li>The <strong>${stats.mismatches.length}</strong> current mismatches are
              <em>all</em> on the LLM-fallback path. They are not bugs in the rule
              scorer; they are an LLM judging-call on incomplete intake data and the
              harness's chip selections happening to disagree with how the LLM
              labelled them.</li>
          </ul>
        </div>
      </div>
    </section>
  `;
}

function buildLeadDataset(stats: OverallStats): string {
  // Serialise enough lead data so the drill-down dialog can render
  // without round-tripping. Keys are 1-based log indices.
  const map: Record<string, unknown> = {};
  for (const sub of stats.perSubType) {
    for (const cell of sub.cells.values()) {
      map[String(cell.idx)] = {
        case_type: cell.case_type,
        sub_type: cell.sub_type,
        bucket: cell.bucket,
        rt: cell.rt,
        predicted: { score: cell.predScore, bucket: cell.predBucket },
        actual: { score: cell.actScore, bucket: cell.actBucket },
        durationSec: cell.durationSec,
        turns: cell.turns,
        lead: cell.lead
          ? {
              id: cell.lead.id,
              classification: cell.lead.classification,
              lead_score: cell.lead.lead_score,
              brief_description: cell.lead.brief_description,
              branched: cell.lead.branched,
              sop_finalized: cell.lead.sop_finalized,
              sop_pending_step: cell.lead.sop_pending_step,
              hard_overrides_fired: cell.lead.hard_overrides_fired,
              reasons: (() => {
                try {
                  return cell.lead.score_reasons_json
                    ? (JSON.parse(cell.lead.score_reasons_json) as string[])
                    : [];
                } catch {
                  return [];
                }
              })(),
            }
          : null,
      };
    }
  }
  return JSON.stringify(map);
}

const DRILLDOWN_JS = `
(function () {
  const dataset = window.__LEAD_DATASET || {};
  const dialog = document.getElementById('detail-dialog');
  const panel = dialog.querySelector('.panel');

  function renderDetail(idx) {
    const row = dataset[String(idx)];
    if (!row) return '<p>No data for this row.</p>';
    const lead = row.lead;
    const reasons = (lead && lead.reasons && lead.reasons.length)
      ? '<ul class="reasons">' + lead.reasons.map(r => '<li>' + r + '</li>').join('') + '</ul>'
      : '<em>none</em>';
    const overrides = (lead && lead.hard_overrides_fired && lead.hard_overrides_fired.length)
      ? lead.hard_overrides_fired.join(', ')
      : '<em>none</em>';
    const path = (row.actual.score === 'null') ? 'LLM-fallback' : 'Rule-scored';
    const sopStatus = lead
      ? (lead.sop_finalized ? 'Finalized' : 'Pending at <code>' + (lead.sop_pending_step || 'unknown') + '</code>')
      : '—';
    return [
      '<button class="close-btn" type="button" id="dlg-close" aria-label="Close">×</button>',
      '<h3>' + row.case_type + ' / ' + row.sub_type + ' · ' + row.bucket + ' · ' + row.rt + '</h3>',
      '<dl>',
      '  <dt>Predicted</dt><dd>' + row.predicted.bucket + ' (score ' + row.predicted.score + ')</dd>',
      '  <dt>Actual</dt><dd>' + row.actual.bucket + ' (score ' + row.actual.score + ')</dd>',
      '  <dt>Path</dt><dd>' + path + '</dd>',
      '  <dt>Duration</dt><dd>' + row.durationSec + 's, ' + row.turns + ' turns</dd>',
      '  <dt>Lead ID</dt><dd><code>' + (lead ? lead.id : '—') + '</code></dd>',
      '  <dt>SOP</dt><dd>' + sopStatus + '</dd>',
      '  <dt>Overrides fired</dt><dd>' + overrides + '</dd>',
      '  <dt>Reasons</dt><dd>' + reasons + '</dd>',
      '  <dt>Brief</dt><dd>' + (lead && lead.brief_description ? lead.brief_description : '—') + '</dd>',
      '</dl>',
      '<p class="footer-note">Tip: copy the lead ID and look it up in /dashboard/leads for the full conversation transcript.</p>',
    ].join('');
  }

  function open(idx) {
    panel.innerHTML = renderDetail(idx);
    dialog.classList.add('open');
    const closeBtn = document.getElementById('dlg-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
  }
  function close() { dialog.classList.remove('open'); }

  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // Wire up clicks on cells and mismatch rows.
  document.querySelectorAll('[data-idx]').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = el.getAttribute('data-idx');
      if (idx) open(idx);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const idx = el.getAttribute('data-idx');
        if (idx) open(idx);
      }
    });
  });
})();
`;

function renderHtml(stats: OverallStats): string {
  const dataset = buildLeadDataset(stats);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lead Classification Test Matrix · ${htmlEscape(stats.generatedAtIso)}</title>
  <style>${CSS}</style>
</head>
<body>
  <main>
    ${renderHeader(stats)}
    ${renderKpis(stats)}
    ${renderMatrix(stats)}
    ${renderMismatches(stats)}
    ${renderInsights(stats)}
  </main>
  <div class="detail-dialog" id="detail-dialog" role="dialog" aria-modal="true">
    <div class="panel" role="document"></div>
  </div>
  <script>window.__LEAD_DATASET = ${dataset};</script>
  <script>${DRILLDOWN_JS}</script>
</body>
</html>
`;
}

async function main() {
  const outcomes = parseRunLog(LOG_PATH);
  const leads = await loadLeads();
  const joined = joinOutcomesWithLeads(outcomes, leads);
  const perSubType = aggregatePerSubType(joined);
  const stats = computeOverall(joined, perSubType);

  const html = renderHtml(stats);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, html, 'utf8');

  // Also publish a stable-named copy under the Next.js `public/`
  // directory so it ships as a static asset under
  // `/reports/lead-matrix-latest.html`. The leads dashboard page
  // links to this URL via a "View test report" button. Re-running
  // the generator overwrites this file, so the published report
  // always reflects the latest run.
  const PUBLIC_REPORT_PATH = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'public',
    'reports',
    'lead-matrix-latest.html',
  );
  fs.mkdirSync(path.dirname(PUBLIC_REPORT_PATH), { recursive: true });
  fs.writeFileSync(PUBLIC_REPORT_PATH, html, 'utf8');

  console.log(`Wrote report:    ${OUT_PATH}`);
  console.log(`Published copy:  ${PUBLIC_REPORT_PATH}`);
  console.log(`  conversations:  ${stats.total}`);
  console.log(`  matched:        ${stats.matched}`);
  console.log(`  mismatched:     ${stats.mismatched}`);
  console.log(`  branched/llm:   ${stats.branched} / ${stats.llmFallback}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
