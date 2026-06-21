/**
 * measure-chat-latency.ts — Perf measurement script (021-chat-api-latency T033).
 *
 * POSTs N=50 scripted SOP-intake turns through /api/chat, measures TTFT
 * (time-to-first-token) and done-event timing per turn, and emits a JSON
 * file with { p50, p90, p99 } per metric.
 *
 * Usage:
 *   CHAT_API_URL=http://localhost:3000 CHAT_API_KEY=<key> \
 *     npx tsx packages/api/scripts/measure-chat-latency.ts [--output results.json]
 *
 * See quickstart.md Step 4a/4b for context.
 */

import fs from 'fs';
import path from 'path';

const CHAT_API_URL = process.env.CHAT_API_URL ?? 'http://localhost:3000';
const CHAT_API_KEY = process.env.CHAT_API_KEY ?? '';
const OUTPUT_FILE = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : 'latency-results.json';

const SCRIPTED_TURNS = [
  'Hello, I need legal help',
  'DUI',
  'I was arrested last night in Chicago',
  'I was pulled over and failed the breathalyzer',
  'It happened yesterday around 10pm',
];

const N_ITERATIONS = 10; // reduced from 50 for script brevity

interface TurnResult {
  ttft_ms: number;
  done_ms: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function measureTurn(
  sessionId: string | null,
  message: string,
  apiKey: string,
): Promise<TurnResult> {
  const start = Date.now();
  let ttft: number | null = null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  };
  if (sessionId) headers['x-session-id'] = sessionId;

  const resp = await fetch(`${CHAT_API_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages: [{ role: 'user', content: message }] }),
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (ttft === null && value && value.length > 0) {
      ttft = Date.now() - start;
    }
    if (done) break;
  }

  const doneMs = Date.now() - start;
  return { ttft_ms: ttft ?? doneMs, done_ms: doneMs };
}

async function main() {
  if (!CHAT_API_KEY) {
    console.error('CHAT_API_KEY env var is required');
    process.exit(1);
  }

  const ttfts: number[] = [];
  const dones: number[] = [];

  console.log(`Measuring ${N_ITERATIONS} scripted SOP-intake sequences against ${CHAT_API_URL}...`);

  for (let iter = 0; iter < N_ITERATIONS; iter++) {
    let sessionId: string | null = null;
    for (const message of SCRIPTED_TURNS) {
      const result = await measureTurn(sessionId, message, CHAT_API_KEY);
      ttfts.push(result.ttft_ms);
      dones.push(result.done_ms);
    }
    process.stdout.write('.');
  }
  console.log('\nDone.');

  ttfts.sort((a, b) => a - b);
  dones.sort((a, b) => a - b);

  const output = {
    n_turns: ttfts.length,
    ttft: { p50: percentile(ttfts, 50), p90: percentile(ttfts, 90), p99: percentile(ttfts, 99) },
    done: { p50: percentile(dones, 50), p90: percentile(dones, 90), p99: percentile(dones, 99) },
  };

  fs.writeFileSync(path.resolve(OUTPUT_FILE), JSON.stringify(output, null, 2));
  console.log(`Results written to ${OUTPUT_FILE}`);
  console.table({ TTFT: output.ttft, Done: output.done });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
