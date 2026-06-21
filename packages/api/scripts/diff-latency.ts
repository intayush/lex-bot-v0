/**
 * diff-latency.ts — Latency diff script (021-chat-api-latency T034).
 *
 * Reads two JSON files produced by measure-chat-latency.ts (baseline and
 * feature-branch) and prints a diff table. Exits non-zero if SC-001 or
 * SC-002 thresholds are not met.
 *
 * Success criteria (021-chat-api-latency spec.md):
 *   SC-001: P50 TTFT improvement ≥ 150 ms
 *   SC-002: P50 done-event improvement ≥ 200 ms
 *
 * Usage:
 *   npx tsx packages/api/scripts/diff-latency.ts baseline.json feature.json
 *
 * See quickstart.md Step 4c for context.
 */

import fs from 'fs';

const SC_001_TTFT_P50_DROP_MS = 150;
const SC_002_DONE_P50_DROP_MS = 200;

interface LatencyResult {
  n_turns: number;
  ttft: { p50: number; p90: number; p99: number };
  done: { p50: number; p90: number; p99: number };
}

function loadResult(filePath: string): LatencyResult {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LatencyResult;
  } catch (err) {
    console.error(`Failed to read ${filePath}:`, err);
    process.exit(1);
  }
}

function fmt(ms: number): string {
  return `${ms.toFixed(1)} ms`;
}

function fmtDiff(baseline: number, feature: number): string {
  const diff = baseline - feature;
  const sign = diff >= 0 ? '-' : '+';
  return `${sign}${Math.abs(diff).toFixed(1)} ms`;
}

function main() {
  const [, , baselinePath, featurePath] = process.argv;
  if (!baselinePath || !featurePath) {
    console.error('Usage: diff-latency.ts <baseline.json> <feature.json>');
    process.exit(1);
  }

  const baseline = loadResult(baselinePath);
  const feature = loadResult(featurePath);

  console.log('\n=== Latency Diff: baseline → feature branch ===\n');
  console.log(`Baseline turns: ${baseline.n_turns}   Feature turns: ${feature.n_turns}`);
  console.log('');

  // TTFT table
  console.log('TTFT (time-to-first-token):');
  console.log(`  P50: ${fmt(baseline.ttft.p50)} → ${fmt(feature.ttft.p50)}  (${fmtDiff(baseline.ttft.p50, feature.ttft.p50)})`);
  console.log(`  P90: ${fmt(baseline.ttft.p90)} → ${fmt(feature.ttft.p90)}  (${fmtDiff(baseline.ttft.p90, feature.ttft.p90)})`);
  console.log(`  P99: ${fmt(baseline.ttft.p99)} → ${fmt(feature.ttft.p99)}  (${fmtDiff(baseline.ttft.p99, feature.ttft.p99)})`);
  console.log('');

  // Done-event table
  console.log('Done-event (total request time):');
  console.log(`  P50: ${fmt(baseline.done.p50)} → ${fmt(feature.done.p50)}  (${fmtDiff(baseline.done.p50, feature.done.p50)})`);
  console.log(`  P90: ${fmt(baseline.done.p90)} → ${fmt(feature.done.p90)}  (${fmtDiff(baseline.done.p90, feature.done.p90)})`);
  console.log(`  P99: ${fmt(baseline.done.p99)} → ${fmt(feature.done.p99)}  (${fmtDiff(baseline.done.p99, feature.done.p99)})`);
  console.log('');

  // Success-criteria gate
  const ttftDrop = baseline.ttft.p50 - feature.ttft.p50;
  const doneDrop = baseline.done.p50 - feature.done.p50;

  let allPassed = true;

  const sc001 = ttftDrop >= SC_001_TTFT_P50_DROP_MS;
  const sc002 = doneDrop >= SC_002_DONE_P50_DROP_MS;

  console.log('=== Success Criteria Gate ===\n');
  console.log(`SC-001 (P50 TTFT drop ≥ ${SC_001_TTFT_P50_DROP_MS} ms): ${sc001 ? '✓ PASS' : '✗ FAIL'} (actual: ${fmtDiff(baseline.ttft.p50, feature.ttft.p50)})`);
  console.log(`SC-002 (P50 done drop ≥ ${SC_002_DONE_P50_DROP_MS} ms): ${sc002 ? '✓ PASS' : '✗ FAIL'} (actual: ${fmtDiff(baseline.done.p50, feature.done.p50)})`);

  if (!sc001 || !sc002) {
    allPassed = false;
    console.error('\nOne or more success criteria not met.');
  } else {
    console.log('\nAll success criteria met!');
  }

  process.exit(allPassed ? 0 : 1);
}

main();
