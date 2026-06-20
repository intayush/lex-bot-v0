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
  out_of_scope_response: "I'm not able to help with that area of law.",
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

  it('includes Practice Areas block (empty when no caseTypes passed)', () => {
    // In-scope areas come from caseTypes, not from config. When no caseTypes
    // are passed the block is present but has no bullet items.
    expect(prompt).toContain('## Practice Areas (In Scope)');
    expect(prompt).not.toContain('Criminal Defense');
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
// 019-remove-practice-areas: case_types is always the in-scope source
// ---------------------------------------------------------------------------

describe('composeSystemPrompt — practice areas (case_types always)', () => {
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

  it('lists only IN-SCOPE case_type labels in position order', () => {
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const cts = buildCaseTypes();
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES, false, cts);

    expect(prompt).toMatch(/^- DUI$/m);
    expect(prompt).toMatch(/^- Personal Injury$/m);
    expect(prompt).not.toMatch(/^- Estate Planning$/m);
  });

  it('produces an empty in-scope block when all case_types are out-of-scope (no legacy fallback)', () => {
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const cts = buildCaseTypes().map((ct) => ({ ...ct, is_in_scope: false }));
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES, false, cts);
    // No in-scope labels — block is present but empty.
    expect(prompt).toMatch(/## Practice Areas \(In Scope\)/);
    expect(prompt).not.toMatch(/^- DUI$/m);
    expect(prompt).not.toMatch(/^- Personal Injury$/m);
  });

  it('produces an empty in-scope block when caseTypes is empty (no legacy fallback)', () => {
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES, false, []);
    expect(prompt).toMatch(/## Practice Areas \(In Scope\)/);
    // Legacy values MUST NOT appear.
    expect(prompt).not.toMatch(/^- Criminal Defense$/m);
  });

  it('out-of-scope deflection text comes from config.out_of_scope_response', () => {
    const sopConfig = buildSampleSOPConfig();
    const sopState = buildSampleSOPState(sopConfig);
    const cts = buildCaseTypes();
    const prompt = composeSystemPrompt(testConfig, undefined, sopState, sopConfig, SAMPLE_GOODBYES, false, cts);
    expect(prompt).toContain(testConfig.out_of_scope_response);
  });
});
