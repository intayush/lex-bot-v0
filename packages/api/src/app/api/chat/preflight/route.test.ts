/**
 * Tests for the preflight route handler (011-preflight-phrase T008 + T009).
 *
 * The route is structured as a thin shell `POST` that delegates to a pure
 * `handlePreflight(request, deps)` function. The deps object exposes the
 * three external collaborators (auth verifier, rate-limit checker, the
 * LLM helper) so tests can stub each one without `vi.mock()` magic.
 *
 * Tests cover:
 *   - 200 happy path (T008)
 *   - 401 missing/invalid x-api-key (T008)
 *   - 400 Zod-invalid body (T008)
 *   - 429 rate-limit exceeded (T008)
 *   - 503 preflight_timeout / preflight_failed / preflight_validation (T008)
 *   - CORS OPTIONS returns 204 with right headers (T008)
 *   - Logging redaction: NO message/phrase content in logs (T009)
 *   - US4 silent-failure response shape stability (T017, brought forward
 *     because it lives in this same describe block)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handlePreflight, type PreflightDeps } from './handler';
import { OPTIONS } from './route';
import {
  PreflightLLMError,
  PreflightValidationError,
} from '../../../../lib/preflight-phrase';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const reqHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  });
  return new Request('http://localhost:3000/api/chat/preflight', {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { message: 'I had a DUI', pendingStepSlug: 'case_type' };
const VALID_HEADERS = { 'x-api-key': 'dev_test_key' };

function makeDeps(overrides: Partial<PreflightDeps> = {}): PreflightDeps {
  return {
    verifyApiKey: vi.fn().mockResolvedValue({
      accountId: 'acct_test',
      contextStoreUrl: 'https://example.invalid',
    }),
    checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 999, resetIn: 86_400_000 }),
    generatePreflightPhrase: vi.fn().mockResolvedValue({ phrase: 'Looking into your DUI matter' }),
    now: () => 1_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 200 happy path
// ---------------------------------------------------------------------------

describe('POST /api/chat/preflight — happy path', () => {
  it('returns 200 with the LLM phrase when all checks pass', async () => {
    const deps = makeDeps();
    const res = await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ phrase: 'Looking into your DUI matter' });

    // The helper was called with the right shape.
    expect(deps.generatePreflightPhrase).toHaveBeenCalledTimes(1);
    const call = (deps.generatePreflightPhrase as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.message).toBe('I had a DUI');
    expect(call.pendingStepSlug).toBe('case_type');
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('forwards CORS headers on the success response', async () => {
    const deps = makeDeps();
    const res = await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('accepts pendingStepSlug=null', async () => {
    const deps = makeDeps();
    const res = await handlePreflight(
      makeRequest({ message: 'hi', pendingStepSlug: null }, VALID_HEADERS),
      deps,
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 401 unauthorized
// ---------------------------------------------------------------------------

describe('POST /api/chat/preflight — 401 unauthorized', () => {
  it('returns 401 when x-api-key header is missing', async () => {
    const deps = makeDeps();
    const res = await handlePreflight(makeRequest(VALID_BODY, {}), deps);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 when x-api-key is invalid', async () => {
    const deps = makeDeps({ verifyApiKey: vi.fn().mockResolvedValue(null) });
    const res = await handlePreflight(
      makeRequest(VALID_BODY, { 'x-api-key': 'bogus' }),
      deps,
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('does not call generatePreflightPhrase when auth fails', async () => {
    const deps = makeDeps({ verifyApiKey: vi.fn().mockResolvedValue(null) });
    await handlePreflight(makeRequest(VALID_BODY, { 'x-api-key': 'bogus' }), deps);
    expect(deps.generatePreflightPhrase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 400 bad request
// ---------------------------------------------------------------------------

describe('POST /api/chat/preflight — 400 bad request', () => {
  it('returns 400 when message is missing', async () => {
    const deps = makeDeps();
    const res = await handlePreflight(
      makeRequest({ pendingStepSlug: null }, VALID_HEADERS),
      deps,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('bad_request');
  });

  it('returns 400 when message is empty string', async () => {
    const deps = makeDeps();
    const res = await handlePreflight(
      makeRequest({ message: '', pendingStepSlug: null }, VALID_HEADERS),
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when message exceeds 2000 chars', async () => {
    const deps = makeDeps();
    const oversize = 'a'.repeat(2001);
    const res = await handlePreflight(
      makeRequest({ message: oversize, pendingStepSlug: null }, VALID_HEADERS),
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when pendingStepSlug fails the slug regex', async () => {
    const deps = makeDeps();
    const res = await handlePreflight(
      makeRequest({ message: 'hi', pendingStepSlug: 'Invalid Slug!' }, VALID_HEADERS),
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is malformed JSON', async () => {
    const deps = makeDeps();
    const malformed = new Request('http://localhost:3000/api/chat/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...VALID_HEADERS },
      body: '{not valid json',
    });
    const res = await handlePreflight(malformed, deps);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 429 rate limited
// ---------------------------------------------------------------------------

describe('POST /api/chat/preflight — 429 rate limited', () => {
  it('returns 429 when checkRateLimit reports allowed=false', async () => {
    const deps = makeDeps({
      checkRateLimit: vi.fn().mockReturnValue({ allowed: false, remaining: 0, resetIn: 60_000 }),
    });
    const res = await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('rate_limited');
  });

  it('forwards Retry-After header on 429', async () => {
    const deps = makeDeps({
      checkRateLimit: vi.fn().mockReturnValue({ allowed: false, remaining: 0, resetIn: 60_000 }),
    });
    const res = await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('does not call generatePreflightPhrase when rate-limited', async () => {
    const deps = makeDeps({
      checkRateLimit: vi.fn().mockReturnValue({ allowed: false, remaining: 0, resetIn: 60_000 }),
    });
    await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);
    expect(deps.generatePreflightPhrase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 503 outcomes
// ---------------------------------------------------------------------------

describe('POST /api/chat/preflight — 503 outcomes', () => {
  it('returns 503 preflight_failed when helper throws PreflightLLMError', async () => {
    const deps = makeDeps({
      generatePreflightPhrase: vi.fn().mockRejectedValue(new PreflightLLMError('LLM down')),
    });
    const res = await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('preflight_failed');
  });

  it('returns 503 preflight_validation when helper throws PreflightValidationError', async () => {
    const deps = makeDeps({
      generatePreflightPhrase: vi.fn().mockRejectedValue(
        new PreflightValidationError('phrase too long'),
      ),
    });
    const res = await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('preflight_validation');
  });

  it('returns 503 preflight_timeout when helper throws AbortError-shaped error', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const deps = makeDeps({
      generatePreflightPhrase: vi.fn().mockRejectedValue(abortError),
    });
    const res = await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('preflight_timeout');
  });
});

// ---------------------------------------------------------------------------
// CORS OPTIONS
// ---------------------------------------------------------------------------

describe('OPTIONS /api/chat/preflight — CORS preflight', () => {
  it('returns 204 with the right CORS headers', async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('x-api-key');
  });
});

// ---------------------------------------------------------------------------
// Logging redaction (T009)
// ---------------------------------------------------------------------------

describe('POST /api/chat/preflight — logging redaction (T009)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function getAllLogPayloads(): unknown[] {
    return [
      ...logSpy.mock.calls.map((c) => c[0]),
      ...errorSpy.mock.calls.map((c) => c[0]),
    ];
  }

  it('emits a structured log entry on the happy path with allowed keys only', async () => {
    const deps = makeDeps();
    await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);

    const payloads = getAllLogPayloads();
    expect(payloads.length).toBeGreaterThan(0);
    // Find the preflight log entry.
    const preflightLog = payloads.find(
      (p) => typeof p === 'object' && p !== null && (p as { event?: string }).event === 'preflight',
    ) as Record<string, unknown> | undefined;
    expect(preflightLog).toBeDefined();

    const allowedKeys = new Set([
      'event', 'account_id', 'session_id', 'duration_ms', 'outcome',
      'pending_step_slug', 'message_token_count', 'phrase_word_count',
    ]);
    const actualKeys = Object.keys(preflightLog!);
    for (const k of actualKeys) {
      expect(allowedKeys.has(k), `unexpected key in log payload: ${k}`).toBe(true);
    }
    expect(preflightLog!.outcome).toBe('ok');
  });

  it('NEVER logs the raw message content', async () => {
    const deps = makeDeps();
    const distinctMessage = 'CONFIDENTIAL_MESSAGE_TOKEN_xyz123';
    await handlePreflight(
      makeRequest({ message: distinctMessage, pendingStepSlug: null }, VALID_HEADERS),
      deps,
    );

    const fullSerialized = JSON.stringify(getAllLogPayloads());
    expect(fullSerialized).not.toContain(distinctMessage);
  });

  it('NEVER logs the phrase content', async () => {
    const distinctPhrase = 'Distinct_Phrase_Token_qrs456';
    const deps = makeDeps({
      generatePreflightPhrase: vi.fn().mockResolvedValue({ phrase: distinctPhrase }),
    });
    await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);

    const fullSerialized = JSON.stringify(getAllLogPayloads());
    expect(fullSerialized).not.toContain(distinctPhrase);
  });

  it('emits outcome=timeout on AbortError path', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const deps = makeDeps({
      generatePreflightPhrase: vi.fn().mockRejectedValue(abortError),
    });
    await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);

    const preflightLog = getAllLogPayloads().find(
      (p) => typeof p === 'object' && p !== null && (p as { event?: string }).event === 'preflight',
    ) as Record<string, unknown> | undefined;
    expect(preflightLog?.outcome).toBe('timeout');
  });

  it('emits outcome=llm_error on PreflightLLMError path', async () => {
    const deps = makeDeps({
      generatePreflightPhrase: vi.fn().mockRejectedValue(new PreflightLLMError('boom')),
    });
    await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);

    const preflightLog = getAllLogPayloads().find(
      (p) => typeof p === 'object' && p !== null && (p as { event?: string }).event === 'preflight',
    ) as Record<string, unknown> | undefined;
    expect(preflightLog?.outcome).toBe('llm_error');
  });
});

// ---------------------------------------------------------------------------
// US4 silent-failure response shape stability (T017, co-located here)
// ---------------------------------------------------------------------------

describe('POST /api/chat/preflight — US4 silent failure response shape', () => {
  it('all 503 responses share the exact same shape (error: string)', async () => {
    const cases: Array<[string, () => PreflightDeps]> = [
      ['preflight_timeout', () => makeDeps({
        generatePreflightPhrase: vi.fn().mockRejectedValue(
          Object.assign(new Error('aborted'), { name: 'AbortError' }),
        ),
      })],
      ['preflight_failed', () => makeDeps({
        generatePreflightPhrase: vi.fn().mockRejectedValue(new PreflightLLMError('x')),
      })],
      ['preflight_validation', () => makeDeps({
        generatePreflightPhrase: vi.fn().mockRejectedValue(new PreflightValidationError('x')),
      })],
    ];
    for (const [expectedError, makeDepsForCase] of cases) {
      const res = await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), makeDepsForCase());
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe(expectedError);
      expect(typeof body.error).toBe('string');
    }
  });

  it('does NOT return 200 with an error field (callers must use status code)', async () => {
    const deps = makeDeps({
      generatePreflightPhrase: vi.fn().mockRejectedValue(new PreflightLLMError('x')),
    });
    const res = await handlePreflight(makeRequest(VALID_BODY, VALID_HEADERS), deps);
    expect(res.status).not.toBe(200);
  });
});
