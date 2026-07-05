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

const fullSubmission: WizardSubmission = {
  firmIdentity: {
    firmName: 'Acme Law',
    chatbotName: 'Ace',
    greetingMessage: 'Hi from Acme!',
    language: 'English',
  },
  caseTypes: [{ slug: 'dui', label: 'DUI', subTypes: [{ slug: 'first', label: 'First Offense' }] }],
  persona: { tone: 'formal' },
  contact: { phone: '555-1234', email: 'info@acme.law', officeHours: [], afterHoursMessage: 'Closed' },
  escalation: { triggers: ['emergency'], message: 'Call 911' },
};

describe('buildDraftFromWizard — T025', () => {
  it('maps wizard answers into a valid configurationSchema shape', () => {
    const draft = buildDraftFromWizard(fullSubmission, NOW);
    const parsed = configurationSchema.safeParse(draft);
    expect(parsed.success).toBe(true);
    expect(draft.persona).toMatchObject({ firm_name: 'Acme Law', chatbot_name: 'Ace', tone: 'formal' });
  });

  it('fills sensible defaults when optional sections are omitted', () => {
    const draft = buildDraftFromWizard({ firmIdentity: fullSubmission.firmIdentity }, NOW);
    const parsed = configurationSchema.safeParse(draft);
    expect(parsed.success).toBe(true);
    // Persona tone defaults to friendly when not provided.
    expect((draft.persona as { tone: string }).tone).toBe('friendly');
  });
});

describe('missingRequiredSections — T025 (FR-012)', () => {
  it('returns empty when all required sections present', () => {
    expect(missingRequiredSections(fullSubmission)).toEqual([]);
  });

  it('flags missing firmIdentity / caseTypes / contact', () => {
    const missing = missingRequiredSections({ persona: { tone: 'neutral' } });
    expect(missing).toContain('firmIdentity');
    expect(missing).toContain('caseTypes');
    expect(missing).toContain('contact');
  });

  it('treats an empty caseTypes array as missing', () => {
    const missing = missingRequiredSections({ ...fullSubmission, caseTypes: [] });
    expect(missing).toEqual(['caseTypes']);
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
