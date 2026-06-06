# Contract: Branch Runtime

**Feature**: 016-multi-branch-sop · **Spec FRs**: FR-006 through FR-012, FR-031, FR-032
**Module locations**: `packages/api/src/lib/sop/{branch-lookup,branch-advancer,branch-snapshot}.ts`,
`packages/api/src/lib/scoring/score-lead-partial.ts`

This contract describes the in-process module surface used by the chat
route to dispatch and execute branch flows. It is internal to the API
package — no HTTP surface — and is validated by colocated unit tests.

## branch-lookup.ts

```ts
type BranchLookupArgs = {
  firmId: string;
  caseTypeSlug: string;
  subTypeSlug: string;
};

type BranchLookupResult =
  | { branch: Branch; version: BranchVersion }
  | { branch: null };

export async function lookupBranch(
  args: BranchLookupArgs,
  deps: { db: DrizzleDB }
): Promise<BranchLookupResult>;
```

**Behaviour**:

- Returns `{ branch: null }` when:
  - No `branches` row exists for the (firm_id, case_type_slug,
    sub_type_slug) tuple.
  - The branch row's `is_active` is `0`.
  - The branch's current published version has zero questions
    (Edge case from spec).
- Otherwise returns the Branch and its current published BranchVersion.

**Performance**: O(1) — single `SELECT` keyed by the UNIQUE
`(firm_id, case_type_slug, sub_type_slug)` index. Joined with the
`branch_versions` row for `current_version_id`.

**Test contract** (`branch-lookup.test.ts`):

- Returns null when no branch row exists.
- Returns null when `is_active = 0`.
- Returns null when current version has zero questions.
- Returns the branch + version when all conditions are met.
## branch-advancer.ts

```ts
type BranchAdvanceInput = {
  branchState: BranchState; // from SOP state JSON
  branchVersion: BranchVersion;
  userMessage: string;       // latest visitor input
};

type BranchAdvanceResult =
  | { type: 'next_question'; question: BranchQuestion; updatedState: BranchState }
  | { type: 'finalize'; capturedChips: CapturedChip[]; updatedState: BranchState }
  | { type: 'awaiting_clarification'; clarificationText: string; updatedState: BranchState };

export function advanceBranch(input: BranchAdvanceInput): BranchAdvanceResult;
```

**Behaviour**:

- Pure function (no I/O). Given the current branch state and the
  visitor's latest message, returns either the next question to ask,
  or a `finalize` signal when the last question has been answered.
- Uses the same chip-matching logic as the spec 010 advancer
  (fuzzy-match free text to chip labels, accept exact chip slugs from
  the widget's chip-tap path).
- On ambiguous input, returns `awaiting_clarification` — the assistant
  re-asks the same question with a disambiguating prompt.

**Test contract** (`branch-advancer.test.ts`):

- First call: returns `next_question` for question at position 0.
- Subsequent calls advance through positions in order.
- Last call returns `finalize` with the full capturedChips array.
- Free-text input that fuzzy-matches a chip selects the chip.
- Free-text input on a `free_text_allowed: false` question returns
  `awaiting_clarification`.
## branch-snapshot.ts

```ts
type FreezeBranchSnapshotArgs = {
  branch: Branch;
  branchVersion: BranchVersion;
  capturedChips: CapturedChip[];
  scoreResult: ScoreLeadResult;  // from score-lead.ts
  branchIncomplete: boolean;     // true for partial-branch leads (FR-011a)
};

export function freezeBranchSnapshot(
  args: FreezeBranchSnapshotArgs
): BranchSnapshot;
```

**Behaviour**:

- Pure function. Materializes a `BranchSnapshot` from the live branch
  config + captured visitor inputs + scorer output.
- The returned snapshot is written to `leads.branch_snapshot_json` at
  finalization. Once written, it is immutable.
- Includes denormalized fields (`case_type_slug`, `sub_type_slug`,
  `version_number`) for fast filtering and human-readable rendering
  in the dashboard.

**Test contract** (`branch-snapshot.test.ts`):

- Snapshot's `questions_snapshot` matches the version's
  `questions_json` exactly.
- `captured_chips` order matches question position order, even when
  the visitor's chip-tap order differed.
- `branch_incomplete` is true iff fewer than `questions.length`
  questions were answered.
- Snapshot is JSON-serializable round-trip identical (no Date objects,
  no functions).

## score-lead-partial.ts

```ts
type ScoreLeadPartialArgs = {
  branchVersion: BranchVersion;
  capturedChips: CapturedChip[];   // may be empty
  requestType: RequestType;        // 'self' | 'family_friend'
};

type ScoreLeadPartialResult = ScoreLeadResult & {
  branch_incomplete: true;
};

export function scoreLeadPartial(
  args: ScoreLeadPartialArgs
): ScoreLeadPartialResult;
```

**Behaviour**:

- Wraps the existing `scoreLead` from spec 015.
- Always sets `branch_incomplete: true` on the result.
- Empty `capturedChips` is valid input — returns score 0 with
  classification from the lowest threshold band.

**Test contract** (`score-lead-partial.test.ts`):

- Empty chips → score 0, classification matches lowest threshold band.
- Partial chips (e.g., 3 of 8 questions answered) → numeric score
  computed from those chips only.
## Integration with the SOP advancer

The existing `packages/api/src/lib/sop/advancer.ts` is extended at the
post-Step-6 transition point. Pseudocode:

```ts
// After Step 6 (contact) satisfies per FR-002
if (sopState.step6_contact.status === 'satisfied') {
  const lookup = await lookupBranch({
    firmId, caseTypeSlug, subTypeSlug
  }, { db });

  if (lookup.branch === null) {
    // FR-007 default-only path
    emitLog('branch_skipped', { reason: 'no_branch_configured' /* etc */ });
    return finalizeDefaultOnly(sopState);
  }

  // FR-008 branch fires
  emitLog('branch_started', {
    branch_id: lookup.branch.id,
    branch_version_id: lookup.version.id
  });

  sopState.branch_state = {
    branch_id: lookup.branch.id,
    branch_version_id: lookup.version.id,
    current_question_index: 0,
    captured: []
  };
  return { nextStep: 'branch_running', branchVersion: lookup.version };
}

// On every subsequent visitor turn while branch_running:
const result = advanceBranch({
  branchState: sopState.branch_state,
  branchVersion,
  userMessage
});
emitLog('branch_question_answered', {
  question_id: result.question.id,
  chip_slugs: result.capturedChips
});

if (result.type === 'finalize') {
  const score = scoreLead({ branchVersion, capturedChips: result.capturedChips });
  const snapshot = freezeBranchSnapshot({
    branch, branchVersion,
    capturedChips: result.capturedChips,
    scoreResult: score,
    branchIncomplete: false
  });
  emitLog('branch_completed', { lead_score: score.score, classification: score.classification, reasons: score.reasons });
  return finalizeWithBranch(sopState, snapshot, score);
}
```

## Logging contract (FR-033)

Five new structured-log event types are emitted by the runtime. PII
rules: chip *slugs* only (never labels), no free-text content.

| Event | Required fields |
|---|---|
| `branch_started` | `firm_id`, `session_id`, `case_type_slug`, `sub_type_slug`, `branch_id`, `branch_version_id` |
| `branch_question_answered` | + `question_id`, `chip_slugs[]`, `is_free_text` |
| `branch_completed` | + `lead_score`, `classification`, `reasons[]` |
| `branch_skipped` | + `reason` (`"no_branch_configured" \| "branch_inactive" \| "branch_zero_questions"`) |
| `branch_incomplete_finalized` | + `lead_score`, `classification`, `reasons[]`, `chips_captured_count`, `chips_total_count` |

