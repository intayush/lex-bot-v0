/**
 * Preflight route handler (011-preflight-phrase T012).
 *
 * Endpoint: POST /api/chat/preflight
 *
 * Generates a tailored 3-7 word loading status phrase for the visitor's
 * latest message, in parallel with the main agent stream. The widget's
 * `usePreflightPhrase` hook fires this call concurrently with the
 * `/api/chat` stream and swaps the typing-indicator content when the
 * phrase arrives.
 *
 * The route is a thin shell: auth → rate-limit → Zod-parse → 800ms-budget
 * call to `generatePreflightPhrase` → 200 / 503. Real work is in
 * `lib/preflight-phrase.ts`.
 *
 * Tests live at `route.test.ts` and stub `verifyApiKey` / `checkRateLimit`
 * / `generatePreflightPhrase` via the `PreflightDeps` interface so the
 * test file never needs `vi.mock()` magic.
 *
 * Source of truth: contracts/preflight-route-contract.md.
 */

import { NextResponse } from 'next/server';
import { verifyApiKey } from '../../../../lib/auth';
import { checkRateLimit } from '../../../../lib/rate-limit';
import {
  generatePreflightPhrase,
  PreflightLLMError,
  PreflightValidationError,
  type GeneratePreflightPhraseInput,
  type GeneratePreflightPhraseResult,
} from '../../../../lib/preflight-phrase';
import { preflightRequestSchema } from '@legal-chatbot/shared';
import { corsHeaders } from '../cors';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Server-side hard budget for the LLM call. See research.md R3.
 *
 * Updated 2026-05-24: bumped from 800ms to 1500ms after live measurement
 * showed gemini-2.5-flash-lite warm-up calls landing at ~1000-1100ms
 * even for short prompts. The original 800ms came from research-time
 * estimates; production observation moves the budget out. The widget's
 * client-side timeout is 2000ms (sits just above this server budget). */
const PREFLIGHT_TIMEOUT_MS = 1500;

// ---------------------------------------------------------------------------
// Dependency injection seam (for tests)
// ---------------------------------------------------------------------------

/**
 * Collaborators the route handler depends on. The exported `POST` wires
 * the production implementations; tests pass mocks via `handlePreflight`.
 *
 * Keeping this on a typed interface (rather than `vi.mock()` magic) makes
 * the contract between handler and collaborators explicit and lets us
 * exercise every branch without DB or LLM round-trips.
 */
export interface PreflightDeps {
  verifyApiKey: typeof verifyApiKey;
  checkRateLimit: typeof checkRateLimit;
  generatePreflightPhrase: (
    input: GeneratePreflightPhraseInput,
  ) => Promise<GeneratePreflightPhraseResult>;
  /** Injectable clock for deterministic duration_ms in tests. */
  now: () => number;
}

const PRODUCTION_DEPS: PreflightDeps = {
  verifyApiKey,
  checkRateLimit,
  generatePreflightPhrase,
  now: () => Date.now(),
};

// ---------------------------------------------------------------------------
// Logging payload (Constitution V — privacy-redacted, metadata only)
// ---------------------------------------------------------------------------

type PreflightOutcome =
  | 'ok'
  | 'timeout'
  | 'llm_error'
  | 'validation_error'
  | 'rate_limited'
  | 'unauthenticated'
  | 'bad_request';

interface PreflightLogPayload {
  event: 'preflight';
  account_id: string;
  session_id?: string;
  duration_ms: number;
  outcome: PreflightOutcome;
  pending_step_slug: string | null;
  message_token_count: number;
  phrase_word_count?: number;
}

/**
 * Approximate token count from character length. The exact value doesn't
 * need to match the model's tokenizer — we only use it for cost dashboards
 * + log payload metadata. char_count / 4 is the common shortcut.
 */
function approxTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function emitLog(payload: PreflightLogPayload): void {
  if (payload.outcome === 'ok') {
    console.info(payload);
  } else {
    console.error(payload);
  }
}

// ---------------------------------------------------------------------------
// Pure handler (testable)
// ---------------------------------------------------------------------------

export async function handlePreflight(
  req: Request,
  deps: PreflightDeps,
): Promise<Response> {
  const t0 = deps.now();

  // We capture these as we go so the log payload is consistent even when
  // we early-return on a failure.
  let accountId = 'unknown';
  let sessionId: string | undefined;
  let pendingStepSlug: string | null = null;
  let messageTokenCount = 0;

  // --- Auth ----------------------------------------------------------------
  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    emitLog({
      event: 'preflight',
      account_id: accountId,
      duration_ms: deps.now() - t0,
      outcome: 'unauthenticated',
      pending_step_slug: null,
      message_token_count: 0,
    });
    return NextResponse.json(
      { error: 'unauthorized', message: 'Missing API key' },
      { status: 401, headers: corsHeaders },
    );
  }
  const auth = await deps.verifyApiKey(apiKey);
  if (!auth) {
    emitLog({
      event: 'preflight',
      account_id: accountId,
      duration_ms: deps.now() - t0,
      outcome: 'unauthenticated',
      pending_step_slug: null,
      message_token_count: 0,
    });
    return NextResponse.json(
      { error: 'unauthorized', message: 'Invalid API key' },
      { status: 401, headers: corsHeaders },
    );
  }
  accountId = auth.accountId;
  sessionId = req.headers.get('x-session-id') ?? undefined;

  // --- Rate limit ----------------------------------------------------------
  const rl = deps.checkRateLimit(auth.accountId);
  if (!rl.allowed) {
    emitLog({
      event: 'preflight',
      account_id: accountId,
      session_id: sessionId,
      duration_ms: deps.now() - t0,
      outcome: 'rate_limited',
      pending_step_slug: null,
      message_token_count: 0,
    });
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many requests. Please try again shortly.' },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(Math.ceil(rl.resetIn / 1000)),
        },
      },
    );
  }

  // --- Body parse + Zod ----------------------------------------------------
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    emitLog({
      event: 'preflight',
      account_id: accountId,
      session_id: sessionId,
      duration_ms: deps.now() - t0,
      outcome: 'bad_request',
      pending_step_slug: null,
      message_token_count: 0,
    });
    return NextResponse.json(
      { error: 'bad_request', message: 'Invalid JSON body.' },
      { status: 400, headers: corsHeaders },
    );
  }
  const parsed = preflightRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    emitLog({
      event: 'preflight',
      account_id: accountId,
      session_id: sessionId,
      duration_ms: deps.now() - t0,
      outcome: 'bad_request',
      pending_step_slug: null,
      message_token_count: 0,
    });
    return NextResponse.json(
      {
        error: 'bad_request',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      },
      { status: 400, headers: corsHeaders },
    );
  }
  pendingStepSlug = parsed.data.pendingStepSlug;
  messageTokenCount = approxTokenCount(parsed.data.message);

  // --- LLM call with 800ms server-side budget ------------------------------
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    const result = await deps.generatePreflightPhrase({
      message: parsed.data.message,
      pendingStepSlug,
      abortSignal: ac.signal,
    });
    clearTimeout(timer);

    emitLog({
      event: 'preflight',
      account_id: accountId,
      session_id: sessionId,
      duration_ms: deps.now() - t0,
      outcome: 'ok',
      pending_step_slug: pendingStepSlug,
      message_token_count: messageTokenCount,
      phrase_word_count: result.phrase.split(/\s+/).length,
    });

    return NextResponse.json(
      { phrase: result.phrase },
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    clearTimeout(timer);

    // Map error subclasses to outcome strings + 503 error tags.
    let outcome: PreflightOutcome;
    let errorTag: 'preflight_timeout' | 'preflight_failed' | 'preflight_validation';
    if (err instanceof Error && err.name === 'AbortError') {
      outcome = 'timeout';
      errorTag = 'preflight_timeout';
    } else if (err instanceof PreflightValidationError) {
      outcome = 'validation_error';
      errorTag = 'preflight_validation';
    } else if (err instanceof PreflightLLMError) {
      outcome = 'llm_error';
      errorTag = 'preflight_failed';
    } else {
      // Defensive: any other thrown value falls into llm_error.
      outcome = 'llm_error';
      errorTag = 'preflight_failed';
    }

    emitLog({
      event: 'preflight',
      account_id: accountId,
      session_id: sessionId,
      duration_ms: deps.now() - t0,
      outcome,
      pending_step_slug: pendingStepSlug,
      message_token_count: messageTokenCount,
    });

    return NextResponse.json({ error: errorTag }, { status: 503, headers: corsHeaders });
  }
}

// ---------------------------------------------------------------------------
// Next.js Route Handler exports
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  return handlePreflight(req, PRODUCTION_DEPS);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders });
}
