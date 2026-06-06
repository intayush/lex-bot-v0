# Contract: Agent Tool Registry

**Feature**: 016-multi-branch-sop · **Spec FR**: FR-035
**Module location**: `packages/api/src/app/api/chat/route.ts`

This contract makes the Constitution VI tool count enforceable in CI.

## The Contract

The agent's `tools` map passed to `streamText({ ... })` MUST contain
exactly two keys, and no others:

- `searchContext`
- `captureLead`

The previously-registered `analyzeAndFollowUp` tool MUST be removed
entirely from the route handler. Its source file
(`packages/api/src/lib/sop/follow-up-tool.ts`) and its test file MUST
be deleted.

## Structural test

A new test file `packages/api/src/app/api/chat/tool-registry.test.ts`
imports the route handler's tool-registration code (or a refactored
helper that exposes the tool map) and asserts:

```ts
import { buildAgentTools } from './route'; // or its helper module

test('agent has exactly two tools', () => {
  const tools = buildAgentTools({ /* minimal fixture deps */ });
  const toolNames = Object.keys(tools).sort();
  expect(toolNames).toEqual(['captureLead', 'searchContext']);
});

test('analyzeAndFollowUp tool is not registered', () => {
  const tools = buildAgentTools({ /* ... */ });
  expect(tools).not.toHaveProperty('analyzeAndFollowUp');
});
```

## Negative tests (regression guards)

A grep-style sanity test (or a `vitest` filesystem assertion) verifies
that:

- No file under `packages/api/src/` exports a symbol named
  `analyzeAndFollowUp`.
- No file under `packages/api/src/` imports from
  `./sop/follow-up-tool` or any path ending in `follow-up-tool`.

These tests fail loudly if a future PR re-introduces the deleted tool.

## Constitutional rationale

Constitution VI: "The agent has exactly two tools in MVP …
`searchContext` and `captureLead`. Adding a third tool requires a
constitution amendment because additional tools change the agent's
behavior model and the system-prompt budget."

Spec 016 brings the tool count from 3 (with `analyzeAndFollowUp`)
back down to 2, restoring the constitutional invariant. Codifying the
invariant in tests prevents future regression.
