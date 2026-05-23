import { composeSystemPrompt } from './system-prompt.js';
import type { Configuration } from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// Test configuration fixture
// ---------------------------------------------------------------------------
const testConfig: Configuration = {
  version: 1,
  saved_at: '2026-01-01T00:00:00.000Z',
  persona: {
    firm_name: 'Demo Law Firm',
    chatbot_name: 'Sarah',
    greeting_message: 'Hello! How can I help you today?',
    tone: 'friendly',
    language: 'English',
  },
  practice_areas: {
    active: ['Criminal Defense', 'Immigration Law', 'DUI Defense'],
    custom: [],
    out_of_scope_response: "I'm not able to help with that area of law.",
  },
  qualifying_questions: [
    { question: 'What type of legal matter do you need help with?', order: 1, required: true },
    { question: 'When did this issue first arise?', order: 2, required: true },
    { question: 'What is your preferred method of contact?', order: 3, required: false },
  ],
  boundaries: {
    never_say: [
      'Never provide specific legal advice',
      'Never promise case outcomes',
    ],
  },
  escalation: {
    triggers: [
      'User mentions active danger',
      'User asks for a human representative',
    ],
    message: 'Let me connect you with our team right away.',
  },
  contact: {
    phone: '(555) 999-0000',
    email: 'intake@demolaw.com',
    office_hours: [{ day: 'Monday-Friday', open: '9:00 AM', close: '5:00 PM' }],
    after_hours_message: 'We are currently closed.',
  },
  custom_instructions: 'Always mention free consultation.',
};

// ---------------------------------------------------------------------------
// composeSystemPrompt
// ---------------------------------------------------------------------------
describe('composeSystemPrompt', () => {
  const prompt = composeSystemPrompt(testConfig);

  it('contains chatbot name and firm name in opening line', () => {
    const firstLine = prompt.split('\n')[0];
    expect(firstLine).toContain('Sarah');
    expect(firstLine).toContain('Demo Law Firm');
  });

  it('contains tone instruction', () => {
    expect(prompt).toContain('friendly');
  });

  it('contains legal disclaimer about not being a lawyer', () => {
    expect(prompt).toContain('not a lawyer');
    expect(prompt).toContain('legal advice');
  });

  it('lists all practice areas', () => {
    expect(prompt).toContain('Criminal Defense');
    expect(prompt).toContain('Immigration Law');
    expect(prompt).toContain('DUI Defense');
  });

  it('contains out-of-scope response', () => {
    expect(prompt).toContain("I'm not able to help with that area of law.");
  });

  it('lists boundary rules (never say rules)', () => {
    expect(prompt).toContain('Never provide specific legal advice');
    expect(prompt).toContain('Never promise case outcomes');
  });

  it('lists escalation triggers', () => {
    expect(prompt).toContain('User mentions active danger');
    expect(prompt).toContain('User asks for a human representative');
  });

  it('contains escalation message', () => {
    expect(prompt).toContain('Let me connect you with our team right away.');
  });

  it('contains contact phone and email', () => {
    expect(prompt).toContain('(555) 999-0000');
    expect(prompt).toContain('intake@demolaw.com');
  });

  it('lists qualifying questions with order numbers', () => {
    expect(prompt).toContain('1. What type of legal matter do you need help with?');
    expect(prompt).toContain('2. When did this issue first arise?');
    expect(prompt).toContain('3. What is your preferred method of contact?');
  });

  it('marks questions as required/optional', () => {
    expect(prompt).toContain('1. What type of legal matter do you need help with? (required)');
    expect(prompt).toContain('2. When did this issue first arise? (required)');
    expect(prompt).toContain('3. What is your preferred method of contact? (optional)');
  });

  it('contains context search instructions', () => {
    expect(prompt).toContain('searchContext');
  });

  it('contains lead capture instructions', () => {
    expect(prompt).toContain('captureLead');
  });

  it('includes custom instructions when provided', () => {
    expect(prompt).toContain('Always mention free consultation.');
    expect(prompt).toContain('Additional Instructions');
  });

  it('omits custom instructions section when custom_instructions is empty string', () => {
    const configNoCustom: Configuration = {
      ...testConfig,
      custom_instructions: '',
    };
    const promptNoCustom = composeSystemPrompt(configNoCustom);

    expect(promptNoCustom).not.toContain('Additional Instructions');
  });
});

// ---------------------------------------------------------------------------
// 010-sop-workflow T021: optional SOP parameters preserve legacy behavior.
// The full SOP block composition arrives in T030 (Phase 3 US1). This test
// asserts the signature change is backward-compatible.
// ---------------------------------------------------------------------------
describe('composeSystemPrompt — SOP signature (T021, no-op until T030)', () => {
  it('produces identical output when called with no SOP params vs. all undefined', () => {
    const promptDefault = composeSystemPrompt(testConfig);
    const promptUndefined = composeSystemPrompt(testConfig, undefined, undefined, undefined, undefined);
    expect(promptUndefined).toBe(promptDefault);
  });

  it('produces identical output when called with empty goodbyePhrases (legacy branch)', () => {
    // Until T030 wires composeSopBlock, even a populated SOP state should
    // not change the output. This guards against accidental coupling.
    const sopState = {
      sop_configuration_id: 'cfg_x',
      sop_version: 1,
      conversation_anchor_iso: '2026-05-23T10:00:00.000Z',
      steps: [],
      qualified_lead_threshold: 5,
      current_progress: 0,
      is_finalized: false,
      out_of_scope_termination: false,
    } as const;
    const promptDefault = composeSystemPrompt(testConfig);
    const promptWithSop = composeSystemPrompt(testConfig, undefined, sopState, undefined, []);
    expect(promptWithSop).toBe(promptDefault);
  });

  it('still renders the legacy Qualifying Questions block (until T030)', () => {
    const prompt = composeSystemPrompt(testConfig);
    expect(prompt).toContain('## Qualifying Questions');
  });
});
