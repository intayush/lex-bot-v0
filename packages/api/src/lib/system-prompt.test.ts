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
// 010-sop-workflow T021 + T030: optional SOP parameters drive Block 4.
//
// When all three SOP params are provided AND the published SOP exists,
// composeSystemPrompt MUST replace the legacy "## Qualifying Questions"
// block with the SOP block. When any SOP param is missing, the legacy
// block remains (backward compat for accounts that haven't migrated).
//
// This block was originally a no-op-until-T030 placeholder; rewritten
// after the verification pass (2026-05-23) revealed the legacy block was
// leaking into the SOP-active prompt.
// ---------------------------------------------------------------------------

import type { SOPConfiguration, SOPState } from '@legal-chatbot/shared';

const ANCHOR = '2026-05-23T10:00:00.000Z';

function buildSampleSOPConfig(): SOPConfiguration {
  return {
    id: 'cfg_test',
    account_id: 'acct_test',
    version: 1,
    qualified_lead_threshold: 5,
    is_published: true,
    derived_from_legacy: false,
    created_at: ANCHOR,
    steps: [
      {
        id: 'step_1',
        sop_configuration_id: 'cfg_test',
        position: 1,
        slug: 'case_type',
        question_text: 'What kind of legal matter can we help you with?',
        chip_source: 'case_types',
        inline_chips_json: null,
        accepts_free_text: true,
        is_required: true,
        counts_toward_threshold: true,
        is_default: true,
        skip_condition_json: null,
      },
      {
        id: 'step_2',
        sop_configuration_id: 'cfg_test',
        position: 2,
        slug: 'where',
        question_text: 'Where did this happen?',
        chip_source: null,
        inline_chips_json: null,
        accepts_free_text: true,
        is_required: true,
        counts_toward_threshold: true,
        is_default: true,
        skip_condition_json: null,
      },
    ],
  };
}

function buildSampleSOPState(sopConfig: SOPConfiguration): SOPState {
  return {
    sop_configuration_id: sopConfig.id,
    sop_version: sopConfig.version,
    conversation_anchor_iso: ANCHOR,
    steps: sopConfig.steps.map((s) => ({
      step_id: s.id,
      slug: s.slug,
      status: 'pending' as const,
      captured_value: null,
      captured_at: null,
      inferred: false,
    })),
    qualified_lead_threshold: sopConfig.qualified_lead_threshold,
    current_progress: 0,
    is_finalized: false,
    out_of_scope_termination: false,
  };
}

const SAMPLE_GOODBYES = ['bye', 'goodbye', 'thanks'];

describe('composeSystemPrompt — legacy path (no SOP)', () => {
  it('produces identical output when called with no SOP params vs. all undefined', () => {
    const promptDefault = composeSystemPrompt(testConfig);
    const promptUndefined = composeSystemPrompt(testConfig, undefined, undefined, undefined, undefined);
    expect(promptUndefined).toBe(promptDefault);
  });

  it('renders the legacy Qualifying Questions block when no SOP params are provided', () => {
    const prompt = composeSystemPrompt(testConfig);
    expect(prompt).toContain('## Qualifying Questions');
  });

  it('renders the legacy Qualifying Questions block when only some SOP params are provided', () => {
    // Defensive: the SOP path requires ALL three params (state + config +
    // phrases). Missing any one falls back to legacy. Without this, the
    // route handler accidentally activating partial SOP would produce a
    // broken prompt.
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);

    // sopState only — no config
    const promptStateOnly = composeSystemPrompt(testConfig, undefined, sopState, undefined, SAMPLE_GOODBYES);
    expect(promptStateOnly).toContain('## Qualifying Questions');

    // sopConfig only — no state
    const promptConfigOnly = composeSystemPrompt(testConfig, undefined, undefined, sopConfig, SAMPLE_GOODBYES);
    expect(promptConfigOnly).toContain('## Qualifying Questions');
  });
});

describe('composeSystemPrompt — SOP path (T030 wiring)', () => {
  it('REPLACES the legacy Qualifying Questions block with the SOP block when SOP is active', () => {
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES);
    // The legacy block MUST NOT be present.
    expect(prompt).not.toContain('## Qualifying Questions');
    // The SOP block MUST be present.
    expect(prompt).toContain('## SOP State');
  });

  it('embeds the pending step\'s question text from the SOP block', () => {
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES);
    expect(prompt).toContain('What kind of legal matter can we help you with?');
  });

  it('embeds the goodbye phrase list (FR-029)', () => {
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES);
    expect(prompt).toContain('"bye"');
    expect(prompt).toContain('"goodbye"');
  });

  it('does NOT include legacy qualifying-questions content even if config has them populated', () => {
    // The legacy testConfig has 3 qualifying_questions defined. The SOP
    // path MUST NOT leak any of them into the prompt — that was the bug
    // verified live on 2026-05-23.
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES);
    for (const q of testConfig.qualifying_questions) {
      expect(prompt).not.toContain(q.question);
    }
  });

  it('instructs the agent to use the SOP-captured when value as incidentDate (when SOP active)', () => {
    // 2026-05-23 verification surfaced that the LLM was passing verbatim
    // phrases like "last night" as incidentDate even when the SOP runtime
    // had captured an ISO date. The system prompt now nudges the agent
    // to read from the SOP block.
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES);
    expect(prompt).toContain('incidentDate');
    expect(prompt).toMatch(/SOP "when" step has a captured value/i);
  });

  it('does NOT include the SOP-incidentDate nudge in the legacy path', () => {
    const prompt = composeSystemPrompt(testConfig);
    expect(prompt).not.toMatch(/SOP "when" step has a captured value/i);
  });
});

// ---------------------------------------------------------------------------
// 010-sop-workflow: practice-areas single-source-of-truth
// (post-2026-05-23 fix for the case_types vs config.practice_areas conflict)
// ---------------------------------------------------------------------------

describe('composeSystemPrompt — practice areas (case_types when SOP active)', () => {
  function buildCaseTypes(): import('@legal-chatbot/shared').CaseType[] {
    return [
      {
        id: 'ct_1', account_id: 'acct_test',
        slug: 'dui', label: 'DUI', position: 1,
        is_in_scope: true, created_at: ANCHOR, sub_types: [],
      },
      {
        id: 'ct_2', account_id: 'acct_test',
        slug: 'personal_injury', label: 'Personal Injury', position: 2,
        is_in_scope: true, created_at: ANCHOR, sub_types: [],
      },
      {
        id: 'ct_3', account_id: 'acct_test',
        slug: 'estate_planning', label: 'Estate Planning', position: 3,
        is_in_scope: false, created_at: ANCHOR, sub_types: [],
      },
    ];
  }

  it('SOP path with case_types lists IN-SCOPE labels (not legacy practice_areas)', () => {
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const cts = buildCaseTypes();
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES, false, cts);

    expect(prompt).toMatch(/^- DUI$/m);
    expect(prompt).toMatch(/^- Personal Injury$/m);
    // Out-of-scope case_type MUST NOT be listed.
    expect(prompt).not.toMatch(/^- Estate Planning$/m);
    // Legacy values from testConfig (e.g. "Immigration Law") MUST NOT be there.
    expect(prompt).not.toMatch(/^- Immigration Law$/m);
  });

  it('SOP path with empty case_types falls back to legacy practice_areas', () => {
    // Defensive: SOP active but no case_types provided. Don't show an
    // empty in-scope list.
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES, false, []);
    // testConfig.practice_areas.active starts with "Criminal Defense".
    expect(prompt).toMatch(/^- Criminal Defense$/m);
  });

  it('SOP path with all case_types out-of-scope falls back to legacy', () => {
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const cts = buildCaseTypes().map((ct) => ({ ...ct, is_in_scope: false }));
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES, false, cts);
    // Falls back to legacy because all case_types are out-of-scope.
    expect(prompt).toMatch(/^- Criminal Defense$/m);
  });

  it('legacy path (no SOP) uses config.practice_areas regardless of caseTypes param', () => {
    const cts = buildCaseTypes();
    const prompt = composeSystemPrompt(testConfig, undefined, undefined, undefined, undefined, false, cts);
    // case_types-derived labels MUST NOT appear; legacy MUST appear.
    expect(prompt).not.toMatch(/^- DUI$/m); // case_types fixture label
    expect(prompt).toMatch(/^- DUI Defense$/m); // testConfig value
  });

  it('out-of-scope deflection text remains from config.practice_areas regardless of in-scope source', () => {
    // The deflection message comes from config; only the in-scope LIST
    // changes between legacy and SOP paths.
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const cts = buildCaseTypes();
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES, false, cts);
    expect(prompt).toContain(testConfig.practice_areas.out_of_scope_response);
  });
});
