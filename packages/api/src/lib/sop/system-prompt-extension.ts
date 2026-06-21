/**
 * System-prompt SOP block composer (010-sop-workflow T030).
 *
 * Produces a Markdown block that the chat-API system prompt embeds in
 * place of the legacy "Qualifying Questions" block. Pure-functional, no
 * I/O.
 *
 * Source of truth: contracts/system-prompt-extension-contract.md.
 *
 * The composer handles four state variations:
 *  - All steps pending   → list steps with [ ] checkboxes
 *  - Mid-flow            → mark complete steps with [✓] + truncated value
 *  - All complete, not finalized → instruct analyzeAndFollowUp tool call
 *  - Finalized           → omit step list, instruct continuation behaviour
 *
 * Captured-value display is PII-redacted (Constitution V): emails, phone
 * numbers, and capitalised name patterns are stripped before embedding in
 * the prompt.
 */
import type { SOPConfiguration, SOPState } from '@legal-chatbot/shared';
import { redactPII } from './pii-redactor';

/** Hard ceiling on captured-value length displayed in the system prompt. */
const CAPTURED_VALUE_MAX_LEN = 30;

/**
 * Interpolate `{case_type}` (and future placeholders) in a step's
 * question text using snapshots from the SOP state. The caller is
 * responsible for finding the captured_label off the case_type step;
 * we accept it as a parameter so this helper stays pure.
 *
 * Behavior (014-fix-sop-case-subtypes T019 / FR-006):
 *   - When the captured case-type label is non-null, replace every
 *     occurrence of `{case_type}` with the label.
 *   - When the label is null (Step 1 not yet captured OR snapshot was
 *     never set), leave the placeholder intact. The legacy behavior
 *     was for the LLM to substitute the captured slug; preserving the
 *     placeholder keeps that fallback path working unchanged.
 */
function interpolateQuestionText(
  questionText: string,
  capturedCaseTypeLabel: string | null,
): string {
  if (capturedCaseTypeLabel === null) return questionText;
  return questionText.replace(/\{case_type\}/g, capturedCaseTypeLabel);
}

/**
 * Compose the SOP block for the chat-API system prompt.
 *
 * The `isOffTopicNow` parameter has been removed (021-chat-api-latency T015).
 * The static "### Off-SOP detour rule" block below handles all detour
 * scenarios; the dynamic per-turn directive caused token-budget overhead and
 * has been retired.
 */
export function composeSopBlock(
  sopState: SOPState,
  sopConfig: SOPConfiguration,
  goodbyePhrases: readonly string[],
): string {
  const lines: string[] = [];

  lines.push('## SOP State');
  lines.push('');
  lines.push(
    'You are following a Standard Operating Procedure (SOP) to capture ' +
    'lead-qualification information. Track which steps have been answered ' +
    'and direct the conversation toward the next pending step.',
  );
  lines.push('');
  lines.push(
    'IMPORTANT: The SOP step list below is the SOURCE OF TRUTH for what ' +
    'the visitor has told you. When you paraphrase the matter back to the ' +
    'visitor (e.g., "What kind of DUI matter is this?") use ONLY values ' +
    'marked complete in the step list. Do NOT substitute a different ' +
    'case_type or sub_type that the visitor mentioned in passing — only ' +
    'the captured values are confirmed answers. If the visitor wants to ' +
    'correct an earlier answer they will use explicit correction language ' +
    '("actually", "I meant", "wait, no") and the SOP runtime will update ' +
    'the step list accordingly.',
  );
  lines.push('');

  // Spec 016 US2: when a configured branch is in flight, the SOP is
  // technically `is_finalized=true` (Step 6 satisfied) but the
  // conversation is NOT actually done — the branch is asking
  // additional questions. Skip the "Finalized" prompt section in
  // that case. The branchPromptDirective (appended by the chat
  // route) supersedes it with a per-turn directive that tells the
  // agent which branch question to ask next.
  const branchInFlight = sopState.is_finalized && sopState.branch_state != null;

  if (sopState.is_finalized && !branchInFlight) {
    lines.push(...composeFinalizedSection(sopState));
    lines.push('');
    lines.push(...composeGoodbyeRule(goodbyePhrases));
    return lines.join('\n');
  }

  // Steps in display order.
  const orderedConfigSteps = [...sopConfig.steps].sort((a, b) => a.position - b.position);

  // 014-fix-sop-case-subtypes T019: read the captured case-type label
  // off the SOP state once so we can interpolate `{case_type}` into
  // any step's question text. Null when Step 1 is not yet complete or
  // when the snapshot was never set (legacy state).
  const capturedCaseTypeLabel =
    sopState.steps.find((s) => s.slug === 'case_type')?.captured_label ?? null;

  // ---- Step list ----
  lines.push('### Steps (in order)');
  lines.push('');
  orderedConfigSteps.forEach((cfgStep, idx) => {
    const stateStep = sopState.steps.find((s) => s.step_id === cfgStep.id);
    const checkbox = stateStep?.status === 'complete' ? '[✓]' : '[ ]';
    const valueSuffix = stateStep?.status === 'complete' && stateStep.captured_value
      ? ` — "${truncateAndRedact(stateStep.captured_value)}"`
      : stateStep?.status === 'skipped'
        ? ' (skipped)'
        : '';
    lines.push(`${idx + 1}. ${checkbox} ${cfgStep.slug}${valueSuffix}`);
  });
  lines.push('');

  // ---- Current pending step OR all-complete signal ----
  const earliestPending = findEarliestPending(sopState, orderedConfigSteps);
  if (earliestPending === null) {
    // All steps complete (or skipped) but not finalized.
    // Spec 016 FR-035: the previous AI follow-up tool has been removed.
    // The agent should call `captureLead` directly with the captured
    // SOP values; per FR-007, default-only flows finalize here, and
    // configured-branch flows are dispatched by the SOP advancer
    // (server-side state-machine transition) rather than via an
    // agent-tool indirection.
    lines.push('### Next action');
    lines.push('');
    lines.push(
      'All SOP steps are complete. Call the `captureLead` tool with ' +
      'the captured SOP values (case type, contact info, brief ' +
      'description from the where/what/when fields, and your best ' +
      'classification estimate). The server will route to the ' +
      'configured branch (if any) or finalize the lead directly.',
    );
    lines.push('');
  } else {
    lines.push('### Current pending step');
    lines.push('');
    lines.push(`Ask the visitor: "${interpolateQuestionText(earliestPending.question_text, capturedCaseTypeLabel)}"`);
    if (earliestPending.chip_source) {
      lines.push('Chips will be rendered by the widget; the visitor may also free-text.');
    } else if (!earliestPending.accepts_free_text) {
      lines.push('This step accepts chip selection only.');
    } else {
      lines.push('This step accepts free-text answers; no chips.');
    }
    lines.push('');

    lines.push('### Skip detection');
    lines.push('');
    lines.push(
      'If the visitor\'s next message answers MULTIPLE pending steps in ' +
      'one response, mark all answered steps as captured and ask only the ' +
      'EARLIEST pending unanswered step next.',
    );
    lines.push('');

    lines.push('### Off-SOP detour rule');
    lines.push('');
    lines.push(
      'If the visitor\'s next message is unrelated to the current pending ' +
      'step (e.g., asks about office hours), answer their question first ' +
      'within your guardrail boundaries, THEN end your response by asking ' +
      'the current pending step\'s question.',
    );
    lines.push('');
  }

  lines.push(...composeGoodbyeRule(goodbyePhrases));

  // 021-chat-api-latency: moved from system-prompt.ts static prefix so the
  // incidentDate nudge is only present when SOP is active (this function is
  // only called when sopActive=true). The static prefix no longer needs to be
  // conditional on sopActive.
  lines.push('');
  lines.push(
    '- IMPORTANT: When the SOP "when" step has a captured value (visible in the SOP State block above), pass that exact value as `incidentDate` — NOT a phrase paraphrased from the conversation. The captured value is already in YYYY-MM-DD form when the system was able to resolve it.',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function composeFinalizedSection(sopState: SOPState): string[] {
  const lines: string[] = [];
  if (sopState.out_of_scope_termination) {
    lines.push('### Out-of-scope termination');
    lines.push('');
    lines.push(
      'The visitor selected an out-of-scope case type. Use the configured ' +
      'out-of-scope deflection message. Continue answering further ' +
      'questions about other matters within your guardrail boundaries. ' +
      'End every response with an open re-prompt: "Is there anything else ' +
      'I can help you with?" — unless the visitor explicitly says goodbye.',
    );
  } else {
    lines.push('### SOP complete');
    lines.push('');
    lines.push(
      'SOP complete. Continue answering visitor questions within ' +
      'guardrails. End every response with an open re-prompt: "Is there ' +
      'anything else I can help you with?" — unless the visitor explicitly ' +
      'says goodbye.',
    );
  }
  return lines;
}

function composeGoodbyeRule(goodbyePhrases: readonly string[]): string[] {
  const phraseList = goodbyePhrases.map((p) => `"${p}"`).join(', ');
  return [
    '### Goodbye behaviour',
    '',
    `You MUST NOT bid goodbye unless the visitor has explicitly said one of: ${phraseList}. ` +
    'Otherwise every response ends with the next pending SOP step OR ' +
    '(when SOP is finalized) an open re-prompt.',
  ];
}

function findEarliestPending(
  sopState: SOPState,
  orderedConfigSteps: SOPConfiguration['steps'],
): SOPConfiguration['steps'][number] | null {
  for (const cfgStep of orderedConfigSteps) {
    const stateStep = sopState.steps.find((s) => s.step_id === cfgStep.id);
    if (stateStep && stateStep.status === 'pending') {
      return cfgStep;
    }
  }
  return null;
}

function truncateAndRedact(value: string): string {
  const redacted = redactPII(value);
  if (redacted.length <= CAPTURED_VALUE_MAX_LEN) return redacted;
  return redacted.slice(0, CAPTURED_VALUE_MAX_LEN) + '…';
}
