/**
 * 027 US2 — pure-function unit tests for wizard→draft mapping (T025).
 * No DB: exercises buildDraftFromWizard + missingRequiredSections + generateApiKey.
 */
import { describe, it, expect } from 'vitest';
import { configurationSchema, type WizardSubmission } from '@legal-chatbot/shared';
import {
  buildDraftFromWizard,
  missingRequiredSections,
  generateApiKey,
} from './tenant-provisioning.js';

const NOW = '2026-07-05T10:00:00.000Z';

const sub: WizardSubmission = {
  firmIdentity: { firmName: 'Acme Law', chatbotName: 'Ace', email: 'info@acme.law', domain: 'acme.law' },
  caseTypeSelection: [{ caseTypeSlug: 'dui', subTypeSlugs: ['first_offense'] }],
  attorneys: [],
};

describe('buildDraftFromWizard — T025', () => {
  it('maps to a valid configuration with default greeting/tone/contact', () => {
    const draft = buildDraftFromWizard(sub, NOW);
    expect(configurationSchema.safeParse(draft).success).toBe(true);
    expect((draft.persona as { chatbot_name: string }).chatbot_name).toBe('Ace');
    expect((draft.persona as { tone: string }).tone).toBe('friendly'); // defaulted
    expect((draft.persona as { greeting_message: string }).greeting_message.length).toBeGreaterThan(0);
  });

  it('fills sensible defaults when optional sections are omitted', () => {
    const draft = buildDraftFromWizard({ attorneys: [] }, NOW);
    const parsed = configurationSchema.safeParse(draft);
    expect(parsed.success).toBe(true);
    // Persona tone defaults to friendly when not provided.
    expect((draft.persona as { tone: string }).tone).toBe('friendly');
  });
});

describe('missingRequiredSections — T025 (FR-012)', () => {
  it('returns empty when all required sections present', () => {
    expect(missingRequiredSections(sub)).toEqual([]);
  });

  it('flags missing firmIdentity and empty caseTypeSelection', () => {
    expect(missingRequiredSections({ attorneys: [] })).toEqual(expect.arrayContaining(['firmIdentity', 'caseTypeSelection']));
    expect(missingRequiredSections({ ...sub, caseTypeSelection: [] })).toEqual(['caseTypeSelection']);
  });

  it('treats an all-empty-subTypeSlugs caseTypeSelection as missing', () => {
    const missing = missingRequiredSections({ ...sub, caseTypeSelection: [{ caseTypeSlug: 'dui', subTypeSlugs: [] }] });
    expect(missing).toEqual(['caseTypeSelection']);
  });
});

describe('generateApiKey — T025', () => {
  it('returns a plaintext key and a distinct bcrypt hash', async () => {
    const { plaintext, keyHash } = await generateApiKey();
    expect(plaintext).toMatch(/^lk_/);
    expect(keyHash).not.toBe(plaintext);
    expect(keyHash.startsWith('$2')).toBe(true); // bcrypt hash prefix
  });
});
