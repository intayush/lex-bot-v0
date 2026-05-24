/**
 * Tests for `classifyMessage` (011-preflight-phrase rev2).
 *
 * The classifier takes the visitor's message + an optional pendingStepSlug
 * and returns either a tailored phrase OR null. Null falls back to the
 * dots typing indicator. We never return a generic "One moment" phrase
 * because pretending to tailor when we can't feels worse than honest dots.
 *
 * Source of truth: 011-preflight-phrase rev2 — rolled the LLM-driven
 * preflight (failed in production with 5-10x design latency) for an
 * instant client-side keyword + SOP-step classifier.
 */
import { describe, it, expect } from 'vitest';
import { classifyMessage } from './classifyMessage';

describe('classifyMessage — pendingStepSlug-driven', () => {
  it('returns a case_type phrase when the SOP is asking for it', () => {
    expect(classifyMessage('whatever', 'case_type')).toBe('Noting your case type');
  });

  it('returns a sub_type phrase when the SOP is asking for it', () => {
    expect(classifyMessage('first offense', 'sub_type')).toBe('Recording the type');
  });

  it('returns a where phrase', () => {
    expect(classifyMessage('5th and Main', 'where')).toBe('Noting the location');
  });

  it('returns a what phrase', () => {
    expect(classifyMessage('I was pulled over', 'what')).toBe('Noting what happened');
  });

  it('returns a when phrase', () => {
    expect(classifyMessage('yesterday', 'when')).toBe('Noting the timing');
  });

  it('returns a contact phrase', () => {
    expect(classifyMessage('My name is Jane', 'contact')).toBe('Recording your details');
  });

  it('pendingStepSlug takes precedence over keyword matching', () => {
    // Even though the message contains "DUI", the pendingStepSlug is
    // 'where' so we use the location phrase.
    expect(classifyMessage('the DUI happened on 5th and Main', 'where')).toBe('Noting the location');
  });
});

describe('classifyMessage — keyword fallback (no pending step)', () => {
  it('matches DUI keywords', () => {
    expect(classifyMessage('I had a DUI', null)).toBe('Looking into your DUI matter');
    expect(classifyMessage('drunk driving charge', null)).toBe('Looking into your DUI matter');
  });

  it('matches family-law keywords', () => {
    expect(classifyMessage('I need a divorce lawyer', null)).toBe('Looking into your family matter');
    expect(classifyMessage('child custody case', null)).toBe('Looking into your family matter');
  });

  it('matches injury / accident keywords', () => {
    expect(classifyMessage('I was injured in a car accident', null)).toBe('Looking into your injury matter');
    expect(classifyMessage("I'm hurt and need help", null)).toBe('Looking into your injury matter');
  });

  it('matches criminal keywords', () => {
    expect(classifyMessage('charged with theft', null)).toBe('Looking into your criminal matter');
    expect(classifyMessage('assault case', null)).toBe('Looking into your criminal matter');
  });

  it('matches estate-planning keywords', () => {
    expect(classifyMessage('I need a will drafted', null)).toBe('Looking into your estate matter');
    expect(classifyMessage('setting up a trust', null)).toBe('Looking into your estate matter');
  });

  it('matches office-hours questions', () => {
    expect(classifyMessage('what are your office hours?', null)).toBe('Checking office hours');
    expect(classifyMessage('when are you open?', null)).toBe('Checking office hours');
  });

  it('matches phone / contact questions', () => {
    expect(classifyMessage('what is your phone number?', null)).toBe('Checking contact info');
    expect(classifyMessage('how do I reach you?', null)).toBe('Checking contact info');
  });

  it('matches goodbye phrases', () => {
    expect(classifyMessage('thanks!', null)).toBe('Wrapping up');
    expect(classifyMessage('thank you', null)).toBe('Wrapping up');
    expect(classifyMessage('bye', null)).toBe('Wrapping up');
  });

  it('matches generic help intent', () => {
    expect(classifyMessage('I need a lawyer', null)).toBe('Finding the right person');
    expect(classifyMessage('looking for legal help', null)).toBe('Finding the right person');
  });
});

describe('classifyMessage — null fallback', () => {
  it('returns null when message is empty', () => {
    expect(classifyMessage('', null)).toBe(null);
    expect(classifyMessage('   ', null)).toBe(null);
  });

  it('returns null for messages with no recognizable keywords AND no pending step', () => {
    expect(classifyMessage('asdfqwerty', null)).toBe(null);
    expect(classifyMessage('hmm not sure', null)).toBe(null);
  });

  it('returns null for very short noise', () => {
    expect(classifyMessage('ok', null)).toBe(null);
    expect(classifyMessage('a', null)).toBe(null);
  });
});

describe('classifyMessage — case-insensitivity', () => {
  it('matches keywords regardless of case', () => {
    expect(classifyMessage('I had a DUI', null)).toBe('Looking into your DUI matter');
    expect(classifyMessage('I had a dui', null)).toBe('Looking into your DUI matter');
    expect(classifyMessage('I HAD A DUI', null)).toBe('Looking into your DUI matter');
  });
});

describe('classifyMessage — word-boundary matching', () => {
  it('does NOT match keywords inside other words', () => {
    // "duis" should not match "dui" (substring inside another word)
    expect(classifyMessage('iduistring', null)).toBe(null);
    // "thanksgiving" should not trigger goodbye
    expect(classifyMessage('thanksgiving plans', null)).toBe(null);
  });
});
