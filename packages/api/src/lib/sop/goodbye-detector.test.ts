/**
 * Unit tests for the goodbye-phrase matcher used by the branch
 * orchestrator to suppress further branch-question presentation
 * after the visitor signals the conversation is over.
 */
import { describe, expect, it } from 'vitest';
import { isGoodbyeMessage } from './goodbye-detector';

const DEFAULT_PHRASES = [
  'bye',
  'goodbye',
  'thanks',
  'thank you',
  'good night',
  'see you',
  'that\u2019s all',
] as const;

describe('isGoodbyeMessage', () => {
  it('returns false on empty message', () => {
    expect(isGoodbyeMessage('', DEFAULT_PHRASES)).toBe(false);
  });

  it('returns false on empty phrase list', () => {
    expect(isGoodbyeMessage('bye', [])).toBe(false);
  });

  it('matches a single-word goodbye', () => {
    expect(isGoodbyeMessage('bye', DEFAULT_PHRASES)).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isGoodbyeMessage('Goodbye', DEFAULT_PHRASES)).toBe(true);
    expect(isGoodbyeMessage('THANKS', DEFAULT_PHRASES)).toBe(true);
  });

  it('matches a multi-word phrase', () => {
    expect(isGoodbyeMessage('thank you', DEFAULT_PHRASES)).toBe(true);
    expect(isGoodbyeMessage('Good night!', DEFAULT_PHRASES)).toBe(true);
  });

  it('matches when the phrase is bordered by punctuation', () => {
    expect(isGoodbyeMessage('thanks!', DEFAULT_PHRASES)).toBe(true);
    expect(isGoodbyeMessage('ok, bye.', DEFAULT_PHRASES)).toBe(true);
    expect(isGoodbyeMessage('"bye"', DEFAULT_PHRASES)).toBe(true);
  });

  it('matches the smart-apostrophe seed phrase against straight-quote input', () => {
    // The seed phrase is `that\u2019s all` (curly apostrophe). The
    // matcher must treat straight-quote input as equivalent.
    expect(isGoodbyeMessage("that's all", DEFAULT_PHRASES)).toBe(true);
    expect(isGoodbyeMessage('That\u2019s all for now', DEFAULT_PHRASES)).toBe(true);
  });

  it('does NOT match across word boundaries (no false positives)', () => {
    // `bye` must not match inside `byelaw`.
    expect(isGoodbyeMessage('byelaw', DEFAULT_PHRASES)).toBe(false);
    // `thanks` must not match inside `thanksgiving`.
    expect(isGoodbyeMessage('thanksgiving', DEFAULT_PHRASES)).toBe(false);
  });

  it('matches when the goodbye is part of a larger sentence', () => {
    expect(
      isGoodbyeMessage('Ok thanks for your help', DEFAULT_PHRASES),
    ).toBe(true);
  });

  it('does NOT match a non-goodbye message', () => {
    expect(isGoodbyeMessage('I had a car accident', DEFAULT_PHRASES)).toBe(false);
    expect(isGoodbyeMessage('Myself', DEFAULT_PHRASES)).toBe(false);
    expect(isGoodbyeMessage('Yes', DEFAULT_PHRASES)).toBe(false);
  });
});
