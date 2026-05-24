import { useCallback, useState } from 'react';
import { classifyMessage } from './classifyMessage';

/**
 * Widget-side preflight phrase tracking (011-preflight-phrase rev2).
 *
 * Synchronously classifies the visitor's message into a tailored
 * loading-status phrase ("Looking into your DUI matter", "Checking
 * office hours") that swaps the typing-indicator content from the
 * default `● ● ●` dots within ~1ms of Send.
 *
 * Rev2 history: replaces a previous LLM-driven preflight (gemini-
 * 2.5-flash-lite via POST /api/chat/preflight) that hit production
 * latencies of 1300-3500ms — 5-10x the design target. The synchronous
 * classifier is instant, deterministic, free, and never times out.
 *
 * Trade-off: the classifier handles only common message patterns
 * (DUI / family / injury / criminal / estate / office-hours / etc.)
 * plus pending-SOP-step context. Messages that don't match any rule
 * AND have no pending step return null — the widget falls back to
 * dots, which is honest behavior: pretending to tailor when we can't
 * would feel worse.
 *
 * Surface (unchanged from rev1 to keep ChatPanel.tsx wiring stable):
 *   - phrase: string | null   — the current tailored phrase, or null
 *   - start(message, slug)    — call when the visitor sends a message
 *   - clear()                 — call when agent's first token streams
 *
 * Source of truth: contracts/preflight-hook-contract.md (rev2 notes).
 */

export interface UsePreflightPhraseOptions {
  /**
   * Reserved for backward compatibility with rev1's API. The rev2
   * classifier is purely client-side and ignores apiUrl/apiKey.
   * Keeping the option in the type lets ChatPanel.tsx pass them
   * unchanged; future LLM fallback could re-enable.
   */
  apiUrl?: string;
  apiKey?: string;
  sessionId?: string;
}

export interface UsePreflightPhraseReturn {
  phrase: string | null;
  start: (message: string, pendingStepSlug: string | null) => void;
  clear: () => void;
}

export function usePreflightPhrase(_opts: UsePreflightPhraseOptions = {}): UsePreflightPhraseReturn {
  const [phrase, setPhrase] = useState<string | null>(null);

  const start = useCallback((message: string, pendingStepSlug: string | null) => {
    const result = classifyMessage(message, pendingStepSlug);
    setPhrase(result);
  }, []);

  const clear = useCallback(() => {
    setPhrase(null);
  }, []);

  return { phrase, start, clear };
}
