/**
 * CORS header contract test.
 *
 * The Lex Bot widget runs on third-party domains (any law firm's site) and
 * reads response headers from the chat API. Per Constitution IV the chat
 * API uses `Access-Control-Allow-Origin: *`, but each header the widget
 * needs to read MUST be enumerated in `Access-Control-Expose-Headers`.
 *
 * 010-sop-workflow added `x-sop-state` (compact SOP state payload). This
 * test guards against accidental removal.
 */
import { describe, it, expect } from 'vitest';
import { corsHeaders } from './cors';

describe('corsHeaders', () => {
  it('exposes x-session-id (existing contract)', () => {
    expect(corsHeaders['Access-Control-Expose-Headers']).toContain('x-session-id');
  });

  it('exposes x-sop-state (010-sop-workflow contract)', () => {
    expect(corsHeaders['Access-Control-Expose-Headers']).toContain('x-sop-state');
  });

  it('uses wildcard origin (Constitution IV — chat API is public)', () => {
    expect(corsHeaders['Access-Control-Allow-Origin']).toBe('*');
  });

  it('allows POST and OPTIONS only', () => {
    expect(corsHeaders['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
  });
});
