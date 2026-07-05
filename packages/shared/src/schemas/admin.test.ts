import { describe, it, expect } from 'vitest';
import { wizardSubmissionSchema, REQUIRED_WIZARD_SECTIONS } from './admin.js';

describe('wizardSubmissionSchema (redesigned)', () => {
  it('accepts firmIdentity with domain + email', () => {
    const r = wizardSubmissionSchema.safeParse({
      firmIdentity: { firmName: 'Acme', chatbotName: 'Ace', email: 'a@acme.law', domain: 'acme.law' },
      caseTypeSelection: [{ caseTypeSlug: 'dui', subTypeSlugs: ['first_offense'] }],
      attorneys: [],
    });
    expect(r.success).toBe(true);
  });
  it('required sections are firmIdentity + caseTypeSelection', () => {
    expect(REQUIRED_WIZARD_SECTIONS).toEqual(['firmIdentity', 'caseTypeSelection']);
  });
  it('rejects an invalid email', () => {
    const r = wizardSubmissionSchema.safeParse({ firmIdentity: { firmName: 'A', chatbotName: 'B', email: 'nope', domain: 'x.com' } });
    expect(r.success).toBe(false);
  });
});
