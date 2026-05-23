import type { Configuration, SOPConfiguration, SOPState } from '@legal-chatbot/shared';
import { composeSopBlock } from './sop/system-prompt-extension';

/**
 * Compose the chat-API system prompt for a given account configuration.
 *
 * 010-sop-workflow Block 4 routing:
 *   - When all three SOP params (`sopState`, `sopConfig`, `goodbyePhrases`)
 *     are provided, the legacy "## Qualifying Questions" block is REPLACED
 *     by the SOP block produced by `composeSopBlock`.
 *   - When any SOP param is missing, the legacy block is rendered (preserves
 *     backward compatibility for accounts that haven't migrated to SOP yet).
 */
export function composeSystemPrompt(
  config: Configuration,
  guardrailsMarkdown?: string,
  sopState?: SOPState,
  sopConfig?: SOPConfiguration,
  goodbyePhrases?: string[],
): string {
  // guardrailsMarkdown is reserved for a future block 3 hook; not used today.
  void guardrailsMarkdown;

  const sopActive = !!(sopState && sopConfig && goodbyePhrases);

  const parts: string[] = [];

  parts.push(`You are ${config.persona.chatbot_name}, a virtual assistant for ${config.persona.firm_name}.`);
  parts.push(`Your tone is ${config.persona.tone}.`);
  parts.push('You are an AI assistant, not a lawyer. Nothing you say constitutes legal advice.');
  parts.push('');

  parts.push('## Your Role');
  parts.push('- Greet visitors and help them understand how the firm can assist them');
  parts.push('- Answer questions about the firm using ONLY the context provided to you');
  parts.push('- Qualify leads by asking intake questions naturally during the conversation');
  parts.push('- Never fabricate information — if it is not in your context, say you do not have that information');
  parts.push('');

  parts.push('## Practice Areas (In Scope)');
  const allPracticeAreas = [...config.practice_areas.active, ...config.practice_areas.custom.filter(Boolean)];
  for (const area of allPracticeAreas) {
    parts.push(`- ${area}`);
  }
  parts.push('');

  parts.push('## Out of Scope Response');
  parts.push(`If asked about areas not listed above, respond with: "${config.practice_areas.out_of_scope_response}"`);
  parts.push('');

  parts.push('## Boundaries (Never Do)');
  for (const rule of config.boundaries.never_say) {
    parts.push(`- ${rule}`);
  }
  parts.push('');

  parts.push('## Escalation');
  parts.push('Escalate immediately (provide contact info and stop qualifying) when:');
  for (const trigger of config.escalation.triggers) {
    parts.push(`- ${trigger}`);
  }
  parts.push(`Escalation message: "${config.escalation.message}"`);
  parts.push('');

  parts.push('## Contact Information');
  parts.push(`- Phone: ${config.contact.phone}`);
  parts.push(`- Email: ${config.contact.email}`);
  if (config.contact.office_hours.length > 0) {
    parts.push('- Office Hours:');
    for (const h of config.contact.office_hours) {
      parts.push(`  - ${h.day}: ${h.open} – ${h.close}`);
    }
  }
  if (config.contact.after_hours_message) {
    parts.push(`- After-hours message: "${config.contact.after_hours_message}"`);
    parts.push('- If a visitor contacts outside of office hours, include the after-hours message in your response');
  }
  parts.push('');

  if (config.custom_instructions) {
    parts.push('## Additional Instructions');
    parts.push(config.custom_instructions);
    parts.push('');
  }

  // Block 4 — Intake state. SOP path (010-sop-workflow) replaces the
  // legacy qualifying-questions block when SOP runtime is active for the
  // account. Legacy path remains for accounts that haven't migrated yet
  // OR whose request didn't pass full SOP context.
  if (sopActive) {
    parts.push(composeSopBlock(sopState!, sopConfig!, goodbyePhrases!));
    parts.push('');
  } else {
    parts.push('## Qualifying Questions');
    parts.push('Ask these questions naturally during conversation to qualify the lead:');
    for (const q of config.qualifying_questions) {
      const marker = q.required ? '(required)' : '(optional)';
      parts.push(`${q.order}. ${q.question} ${marker}`);
    }
    parts.push('');
  }

  parts.push('## Instructions for Using Context');
  parts.push('- Use the searchContext tool to find relevant information before answering questions about the firm');
  parts.push('- Only state facts that appear in the retrieved context');
  parts.push('- If no relevant context is found, acknowledge that you do not have the specific information and offer to connect them with the team');
  parts.push('');

  parts.push('## Lead Capture Instructions');
  parts.push('- Call the captureLead tool as soon as you understand the visitor\'s legal matter, even if you do not yet have their name or contact info');
  parts.push('- Do NOT wait for complete contact information — capture what you have');
  parts.push('- You need at minimum: a brief description of their legal issue');
  parts.push('- Call captureLead exactly ONCE per conversation');
  parts.push('- Do NOT tell the visitor you are "capturing a lead" or "classifying" them — this is an internal operation');
  parts.push('- After capturing the lead, continue the conversation naturally (e.g., suggest scheduling a consultation)');
  parts.push('- IMPORTANT: If the user triggers an escalation condition, call captureLead BEFORE providing the escalation message');
  parts.push('- Classification guide:');
  parts.push('  - urgent: statute of limitations <30 days, active danger, ongoing medical treatment, court deadlines, restraining order/custody emergency, recent arrest/charges, user requests immediate human help');
  parts.push('  - normal: valid legal matter with no immediate time pressure');
  parts.push('  - unqualified: outside firm practice areas or no actionable legal issue');

  return parts.join('\n');
}
