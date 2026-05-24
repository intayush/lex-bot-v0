import { useCallback, useRef, useState } from 'react';

/**
 * Widget-side preflight phrase tracking (011-preflight-phrase T013).
 *
 * Wires the widget to the POST /api/chat/preflight route. Fires a
 * cancellable fetch when the visitor sends a message; exposes the
 * resolved phrase via `phrase` so ChatPanel can swap the typing
 * indicator's content. Closes the rare race where the main agent
 * starts streaming BEFORE the preflight resolves via a `clear()`
 * function paired with a per-turn `clearedTurnIds` set.
 *
 * Failure modes (every one falls back silently to dots):
 *   - Server returns 4xx / 5xx → silent no-op
 *   - Network error → silent no-op
 *   - Client 1000ms timeout → abort + silent no-op
 *   - Body parse fails → silent no-op
 *   - Resolved phrase but `clear()` was already called → discarded (race fix)
 *
 * Source of truth: contracts/preflight-hook-contract.md.
 */

export interface UsePreflightPhraseOptions {
  /**
   * Base URL of the chat API. The hook calls `${apiUrl}/preflight`. The
   * widget's existing `apiUrl` prop already points at `.../api/chat`, so
   * passing it directly resolves to `.../api/chat/preflight` — exactly
   * where the route handler lives.
   */
  apiUrl: string;
  /** API key forwarded as the `x-api-key` header. */
  apiKey: string;
  /** Optional session id forwarded as the `x-session-id` header. */
  sessionId?: string;
}

export interface UsePreflightPhraseReturn {
  /** Latest preflight phrase, or null. Reset on every `start()` and `clear()`. */
  phrase: string | null;
  /** Call when the visitor sends a message — fires the preflight in the background. */
  start: (message: string, pendingStepSlug: string | null) => void;
  /** Call when the agent's first response token has streamed (cancels in-flight, clears phrase). */
  clear: () => void;
}

/** Client-side hard ceiling for the preflight fetch.
 *
 * Sits just above the server's 1500ms budget so the server's structured
 * 503 wins in normal failure cases; this exists for stuck connections.
 * Updated 2026-05-24 alongside the server bump from 800ms→1500ms after
 * live latency measurement of gemini-2.5-flash-lite warm-up calls. */
const CLIENT_TIMEOUT_MS = 2000;

export function usePreflightPhrase(opts: UsePreflightPhraseOptions): UsePreflightPhraseReturn {
  const [phrase, setPhrase] = useState<string | null>(null);

  // Refs so they survive renders without retriggering effects.
  const turnIdRef = useRef<number>(0);
  const clearedTurnIdsRef = useRef<Set<number>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelInFlight = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const start = useCallback(
    (message: string, pendingStepSlug: string | null) => {
      // Cancel anything still in flight from a prior turn.
      cancelInFlight();

      // Bump turnId; capture it for the closure so the resolve callback
      // can check whether it's still current.
      turnIdRef.current += 1;
      const myTurnId = turnIdRef.current;

      // Clear any stale phrase from the prior turn.
      setPhrase(null);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Client-side hard timeout — server has its own 800ms budget; this is
      // a belt-and-suspenders fallback for stuck connections.
      timeoutRef.current = setTimeout(() => {
        controller.abort();
      }, CLIENT_TIMEOUT_MS);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
      };
      if (opts.sessionId) {
        headers['x-session-id'] = opts.sessionId;
      }

      // Build the URL: `${apiUrl}/preflight` — caller is responsible for
      // passing the right base.
      const url = `${opts.apiUrl.replace(/\/$/, '')}/preflight`;

      // Fire-and-forget. We deliberately do NOT await; the caller's render
      // pipeline continues and the main /api/chat call proceeds in parallel.
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message, pendingStepSlug }),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (timeoutRef.current !== null) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          if (!res.ok) return; // silent no-op on 4xx/5xx
          let body: unknown;
          try {
            body = await res.json();
          } catch {
            return; // silent no-op on malformed JSON
          }
          if (
            typeof body !== 'object'
            || body === null
            || typeof (body as { phrase?: unknown }).phrase !== 'string'
          ) {
            return; // shape mismatch — silent no-op
          }
          // Race fix R5: only setPhrase if our turn is still current AND
          // it hasn't been cleared.
          if (
            turnIdRef.current === myTurnId
            && !clearedTurnIdsRef.current.has(myTurnId)
          ) {
            setPhrase((body as { phrase: string }).phrase);
          }
        })
        .catch(() => {
          // AbortError + network errors land here — silent no-op.
        });
    },
    [cancelInFlight, opts.apiKey, opts.apiUrl, opts.sessionId],
  );

  const clear = useCallback(() => {
    clearedTurnIdsRef.current.add(turnIdRef.current);
    cancelInFlight();
    setPhrase(null);
  }, [cancelInFlight]);

  return { phrase, start, clear };
}
