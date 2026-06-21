/**
 * dump-walk-fixtures.ts — Walk fixture dumper (021-chat-api-latency T035).
 *
 * Runs the surviving e2e walks against a deterministic mocked LLM,
 * dumps the final DB state per fixture to JSONL for byte-equal diffing
 * against `main`.
 *
 * Usage:
 *   CHAT_API_URL=http://localhost:3000 \
 *     npx tsx packages/api/scripts/dump-walk-fixtures.ts [--output fixtures.jsonl]
 *
 * See quickstart.md Step 5 for context.
 *
 * Implementation note: This script is a stub. Full implementation requires
 * running the walk fixtures against a deterministic LLM mock and capturing
 * the final DB state. The Playwright e2e walks in packages/api/tests/e2e/
 * are the source of truth for walk fixture structure.
 */

import fs from 'fs';
import path from 'path';

const OUTPUT_FILE = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : 'walk-fixtures.jsonl';

interface FixtureDump {
  walk: string;
  timestamp: string;
  db_state: {
    session: { message_count: number } | null;
    lead: { classification: string | null } | null;
  };
}

/**
 * Walk names (surviving walks after T013/T014 deletions).
 * widget-us3-off-sop-detour has been deleted.
 */
const SURVIVING_WALKS = [
  'widget-us1-happy-path',
  'widget-us5-no-goodbye',
  'widget-sop-subtype-chips',
  'widget-preflight-phrase',
  'widget-progressbar-refinement',
  'widget-redesign-playground',
  'case-types-reflect-in-chatbot',
  'sop-tabs',
  'smoke-016-personal-injury',
  'smoke-016-criminal-defense',
  'smoke-016-branches-dashboard',
  'dashboard-lead-action',
];

async function dumpFixtures(): Promise<void> {
  const CHAT_API_URL = process.env.CHAT_API_URL;
  if (!CHAT_API_URL) {
    console.error('CHAT_API_URL env var is required');
    process.exit(1);
  }

  console.log(`Dumping walk fixture DB state against ${CHAT_API_URL}...`);
  console.log(`Surviving walks: ${SURVIVING_WALKS.length}`);

  const dumps: FixtureDump[] = [];

  for (const walk of SURVIVING_WALKS) {
    // TODO: Run the walk against a deterministic mocked LLM and capture final DB state.
    // For now, emit a placeholder dump.
    const dump: FixtureDump = {
      walk,
      timestamp: new Date().toISOString(),
      db_state: {
        session: null, // TODO: query sessions table
        lead: null,    // TODO: query leads table
      },
    };
    dumps.push(dump);
    process.stdout.write('.');
  }
  console.log('\nDone.');

  const jsonl = dumps.map((d) => JSON.stringify(d)).join('\n');
  fs.writeFileSync(path.resolve(OUTPUT_FILE), jsonl);
  console.log(`Fixture dumps written to ${OUTPUT_FILE} (${dumps.length} walks)`);
}

dumpFixtures().catch((err) => {
  console.error(err);
  process.exit(1);
});
