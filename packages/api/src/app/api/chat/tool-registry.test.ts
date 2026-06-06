/**
 * Spec 016 T016 — Tool registry contract.
 *
 * Codifies Constitution VI's "exactly two agent tools in MVP" rule and
 * spec 016 FR-035's "remove analyzeAndFollowUp from the registry"
 * mandate. This is a structural test against the chat route's source
 * file (not its runtime), because the route is a Next.js handler that
 * depends on request context that can't be fabricated cheaply in a
 * unit test.
 *
 * If a future PR re-adds the deleted tool — by import, by registration,
 * or by a sibling file under packages/api/src/ — this test fails loudly
 * before the regression can ship.
 *
 * See: specs/016-multi-branch-sop/contracts/tool-registry-contract.md
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ROUTE_PATH = new URL('./route.ts', import.meta.url).pathname;

describe('chat route tool registry (Constitution VI + FR-035)', () => {
  it('does not import analyzeAndFollowUp from any sibling module', async () => {
    const src = await readFile(ROUTE_PATH, 'utf8');
    // No import line that pulls analyzeAndFollowUp{,Tool} or follow-up-tool.
    expect(src).not.toMatch(/from\s+['"][^'"]*follow-up-tool['"]/);
    expect(src).not.toMatch(/import[^;]*analyzeAndFollowUp/);
  });

  it('does not register an analyzeAndFollowUp tool key on the agent tools map', async () => {
    const src = await readFile(ROUTE_PATH, 'utf8');
    // No `analyzeAndFollowUp` token anywhere in the route file.
    // (The token is intentionally specific so this test catches both
    //  `tools.analyzeAndFollowUp = ...` and `analyzeAndFollowUp:` shorthand.)
    expect(src).not.toMatch(/\banalyzeAndFollowUp\b/);
  });

  it('registers exactly the two MVP tools: searchContext and captureLead', async () => {
    const src = await readFile(ROUTE_PATH, 'utf8');
    expect(src).toMatch(/searchContext:\s*tool\(/);
    expect(src).toMatch(/captureLead:\s*tool\(/);
  });
});
