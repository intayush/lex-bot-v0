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

export function composeSopBlock(
  sopState: SOPState,
  sopConfig: SOPConfiguration,
  goodbyePhrases: readonly string[],
  /**
   * When true, the off-SOP detour detector flagged the CURRENT visitor
   * message as unrelated to the pending step. The block adds a directive
   * section nudging the agent to answer + re-prompt deterministically
   * rather than relying on the generic "if unrelated..." rule alone
   * (010-sop-workflow T045).
   */
  isOffTopicNow: boolean = false,
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

  if (sopState.is_finalized) {
    lines.push(...composeFinalizedSection(sopState));
    lines.push('');
    lines.push(...composeGoodbyeRule(goodbyePhrases));
    return lines.join('\n');
  }

  // Steps in display order.
  const orderedConfigSteps = [...sopConfig.steps].sort((a, b) => a.position - b.position);

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
    // All steps complete (or skipped) but not finalized → tool prompt.
    lines.push('### Next action');
    lines.push('');
    lines.push(
      'All SOP steps are complete. Call the `analyzeAndFollowUp` tool ' +
      'to either generate 2-5 follow-up questions tailored to the matter ' +
      'or signal that the lead is ready to finalize.',
    );
    lines.push('');
  } else {
    lines.push('### Current pending step');
    lines.push('');
    lines.push(`Ask the visitor: "${earliestPending.question_text}"`);
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

    if (isOffTopicNow) {
      lines.push('### Detour required NOW');
      lines.push('');
      lines.push(
        'The visitor\'s CURRENT message is off-topic relative to the pending ' +
        'SOP step. Do this:\n' +
        '  1. Answer their question briefly within your guardrail boundaries.\n' +
        '  2. End your response by asking the pending step\'s question ' +
        `verbatim: "${earliestPending.question_text}"\n` +
        'Do NOT skip step 2.',
      );
      lines.push('');
    }

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
