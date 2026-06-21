import { useCallback, useState } from 'react';
import type { SOPStateHeaderPayload } from '@legal-chatbot/shared';
import { sopStateHeaderPayloadSchema } from '@legal-chatbot/shared';

const STORAGE_KEY = 'lc_sop_state';

/**
 * Widget-side SOP state tracking (010-sop-workflow T034).
 *
 * Reads the `x-sop-state` response header on every chat-API response and
 * exposes the compact SOP state payload to the widget UI (progress bar,
 * chips). Falls back to the last-known value when a header is missing
 * (e.g. legacy account with no SOP, or a 401/429 response).
 *
 * Persists to sessionStorage so the bar/chips survive page reloads
 * (matching the existing `x-session-id` resumption behavior in
 * ChatPanel).
 *
 * Usage:
 *   const { sopState, onResponse } = useSOPState();
 *   useChat({ ..., onResponse });
 */
export interface UseSOPStateReturn {
  /** Latest SOP state payload, or null when no SOP is active. */
  sopState: SOPStateHeaderPayload | null;
  /** Wire this into useChat({ onResponse }). */
  onResponse: (response: Response) => void;
}

function readPersisted(): SOPStateHeaderPayload | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return sopStateHeaderPayloadSchema.parse(JSON.parse(raw));
  } catch {
    // Corrupted persisted state; clear and start fresh.
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function persist(payload: SOPStateHeaderPayload | null): void {
  if (typeof sessionStorage === 'undefined') return;
  if (payload === null) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/**
 * @param seedState — optional initial value from a history restore fetch.
 *   When provided, it takes precedence over any sessionStorage value so
 *   the server-authoritative SOP state is used. The sessionStorage value
 *   is still updated on the next /api/chat response.
 */
export function useSOPState(seedState?: SOPStateHeaderPayload | null): UseSOPStateReturn {
  const [sopState, setSOPState] = useState<SOPStateHeaderPayload | null>(() => {
    if (seedState !== undefined) return seedState;
    return readPersisted();
  });

  const onResponse = useCallback((response: Response) => {
    const headerValue = response.headers.get('x-sop-state');
    if (!headerValue) {
      // Missing header → keep last-known value (FR-038-equivalent: bar
      // hidden / chips empty handled by consumer when sopState is null).
      return;
    }
    try {
      const parsed = sopStateHeaderPayloadSchema.parse(JSON.parse(headerValue));
      setSOPState(parsed);
      persist(parsed);
    } catch {
      // Malformed header — server contract violated. Don't update state;
      // last-known value stays in place. The widget remains stable.
    }
  }, []);

  return { sopState, onResponse };
}