import { useChat } from '@ai-sdk/react';
import { useRef, useEffect, useState, useMemo } from 'react';
import { QuickReplies } from './QuickReplies';
import { Chips } from './Chips';
import { ContactForm } from './ContactForm';
import { ProgressBar } from './ProgressBar';
import { useSOPState } from '../hooks/useSOPState';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePreflightPhrase } from '../hooks/usePreflightPhrase';
import {
  computeActiveChips,
  type WidgetSOP,
  type WidgetCaseType,
} from '../hooks/computeActiveChips';

interface ChatPanelProps {
  apiKey: string;
  apiUrl: string;
  onClose: () => void;
}

type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => {
    if (typeof window === 'undefined') return 'desktop';
    if (window.innerWidth < 768) return 'mobile';
    if (window.innerWidth < 1024) return 'tablet';
    return 'desktop';
  });

  useEffect(() => {
    function handle() {
      if (window.innerWidth < 768) setBp('mobile');
      else if (window.innerWidth < 1024) setBp('tablet');
      else setBp('desktop');
    }
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  return bp;
}

function getSessionId(): string | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  return sessionStorage.getItem('lc_session_id') || undefined;
}

function saveSessionId(id: string) {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('lc_session_id', id);
  }
}

interface WidgetConfig {
  chatbot_name: string;
  greeting_message: string;
  practice_areas: string[];
  phone: string;
  /** SOP structure when the account has a published SOP, else null. */
  sop?: WidgetSOP | null;
  /** Case-type catalog with sub-types (010-sop-workflow T033). */
  case_types?: WidgetCaseType[];
}

export function ChatPanel({ apiKey, apiUrl, onClose }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const breakpoint = useBreakpoint();
  const [widgetConfig, setWidgetConfig] = useState<WidgetConfig | null>(null);

  useEffect(() => {
    const baseUrl = apiUrl.replace(/\/api\/chat\/?$/, '');
    const configUrl = `${baseUrl}/api/config`;
    fetch(configUrl, {
      headers: { 'x-api-key': apiKey },
    })
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => {
        if (data) setWidgetConfig(data);
      })
      .catch(() => {
        // Silently fall back to defaults
      });
  }, [apiUrl, apiKey]);

  const { sopState, onResponse: onSOPResponse } = useSOPState();
  const reducedMotion = useReducedMotion();

  // 011-preflight-phrase rev2: query-tailored loading status phrase
  // that swaps the typing-indicator content from `● ● ●` to e.g.
  // "✨ Looking into your DUI matter…" within ~1ms of Send.
  //
  // Rev2 history: the original LLM-driven preflight (POST /api/chat/preflight
  // → gemini-2.5-flash-lite) hit production latencies of 1300-3500ms,
  // 5-10x the design target. Rolled to a synchronous client-side
  // keyword + SOP-step classifier — instant, deterministic, free.
  // Messages that don't match any rule AND have no pending step return
  // null; the widget falls back to dots (honest "we don't know" state).
  const { phrase: preflightPhrase, start: startPreflight, clear: clearPreflight } = usePreflightPhrase();

  // Custom fetch that reads the session id from sessionStorage at REQUEST
  // time rather than at component-mount time. Critical for multi-turn
  // conversations: the first fetch returns a new session id (which we
  // save in onResponse below); subsequent fetches must include that id
  // so the server resumes the same session. The previous useMemo-captured
  // headers approach never re-read sessionStorage, so every turn created
  // a fresh server-side session.
  const sessionAwareFetch: typeof fetch = (input, init) => {
    const id = getSessionId();
    const headers = new Headers(init?.headers);
    if (id && !headers.has('x-session-id')) {
      headers.set('x-session-id', id);
    }
    return fetch(input, { ...init, headers });
  };

  const { messages, input, handleInputChange, handleSubmit, isLoading, error, append } = useChat({
    api: apiUrl,
    fetch: sessionAwareFetch,
    headers: {
      'x-api-key': apiKey,
    },
    onResponse(response) {
      const newSessionId = response.headers.get('x-session-id');
      if (newSessionId) {
        saveSessionId(newSessionId);
      }
      // 010-sop-workflow T037: forward the same Response to the SOP
      // hook so it can read x-sop-state and update progress + chips.
      onSOPResponse(response);
    },
  });

  // 010-sop-workflow T037: compute the chip row for the current pending
  // SOP step. Empty array when SOP isn't active or pending step is
  // free-text only — Chips returns null in that case so no row renders.
  const activeChips = useMemo(
    () =>
      computeActiveChips({
        sop: widgetConfig?.sop ?? null,
        caseTypes: widgetConfig?.case_types ?? [],
        capturedCaseTypeSlug: sopState?.captured_case_type_slug ?? null,
        pendingStepSlug: sopState?.pending_step_slug ?? null,
        isFinalized: sopState?.is_finalized ?? false,
      }),
    [widgetConfig, sopState],
  );

  // 010-sop-workflow contact step: when the pending SOP step is a
  // contact_form step, render <ContactForm> instead of chips. The form
  // dispatches a well-formed message that the advancer's contact-form
  // short-circuit captures.
  const pendingStepIsContactForm = useMemo(() => {
    if (!widgetConfig?.sop || !sopState?.pending_step_slug || sopState.is_finalized) {
      return false;
    }
    const step = widgetConfig.sop.steps.find((s) => s.slug === sopState.pending_step_slug);
    return step?.chip_source === 'contact_form';
  }, [widgetConfig, sopState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 011-preflight-phrase T014: clear the preflight phrase as soon as the
  // assistant's first token has streamed. The streaming bubble takes over
  // the visual real estate; keeping the phrase up after the agent starts
  // talking would feel broken.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && typeof last.content === 'string' && last.content.length > 0) {
      clearPreflight();
    }
  }, [messages, clearPreflight]);

  const panelStyle = useMemo((): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'fixed',
      backgroundColor: 'var(--lc-background, #ffffff)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 9999,
      fontFamily: 'var(--lc-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
    };

    if (breakpoint === 'mobile') {
      return {
        ...base,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 0,
      };
    }

    if (breakpoint === 'tablet') {
      return {
        ...base,
        top: 0,
        right: 0,
        bottom: 0,
        width: '380px',
        borderRadius: 0,
        boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.1)',
      };
    }

    return {
      ...base,
      bottom: '100px',
      right: '24px',
      width: '400px',
      height: '600px',
      borderRadius: 'var(--lc-border-radius, 12px)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
    };
  }, [breakpoint]);

  return (
    <div style={panelStyle}>
      {/* SOP progress bar — pinned at the very top across all breakpoints
          per contracts/progress-bar-contract.md. Returns null when
          total === 0 (no SOP active for the account). */}
      <ProgressBar
        current={sopState?.current ?? 0}
        total={sopState?.total ?? 0}
        reducedMotion={reducedMotion}
      />

      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: 'var(--lc-primary-color, #1a365d)',
          color: 'var(--lc-primary-text, #ffffff)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: '16px' }}>{widgetConfig?.chatbot_name ?? 'Sarah'}</div>
          <div style={{ fontSize: '12px', opacity: 0.8 }}>Virtual Assistant</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close chat"
          style={{
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: '20px',
            padding: '8px',
            minWidth: '44px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {messages.length === 0 && (
          <>
            <div
              style={{
                backgroundColor: 'var(--lc-bubble-bot, #f0f4f8)',
                padding: '12px 16px',
                borderRadius: '12px 12px 12px 4px',
                maxWidth: '85%',
                fontSize: '14px',
                lineHeight: '1.5',
                color: '#1a202c',
              }}
            >
              {widgetConfig?.greeting_message ?? "Hi! I'm Sarah, a virtual assistant for Smith & Associates. How can I help you today?"}
            </div>
            <QuickReplies
              onSelect={(text) => {
                const message = `I need help with ${text}`;
                startPreflight(message, sopState?.pending_step_slug ?? null);
                append({ role: 'user', content: message });
              }}
              options={widgetConfig?.practice_areas}
            />
          </>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              display: 'flex',
              justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                borderRadius:
                  message.role === 'user'
                    ? '12px 12px 4px 12px'
                    : '12px 12px 12px 4px',
                maxWidth: '85%',
                fontSize: '14px',
                lineHeight: '1.5',
                backgroundColor:
                  message.role === 'user'
                    ? 'var(--lc-bubble-user, #1a365d)'
                    : 'var(--lc-bubble-bot, #f0f4f8)',
                color: message.role === 'user' ? '#ffffff' : '#1a202c',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {message.content}
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: '12px 16px',
              borderRadius: '12px 12px 12px 4px',
              maxWidth: '85%',
              fontSize: '14px',
              backgroundColor: 'var(--lc-bubble-bot, #f0f4f8)',
              color: '#718096',
            }}
          >
            {preflightPhrase ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span aria-hidden="true">✨</span>
                <span>{preflightPhrase}…</span>
              </span>
            ) : (
              <span className="lc-typing">● ● ●</span>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              backgroundColor: '#fff5f5',
              color: '#c53030',
              border: '1px solid #fed7d7',
            }}
          >
            Something went wrong. Please try again or call {widgetConfig?.phone ?? '(555) 123-4567'}.
          </div>
        )}

        {/* 010-sop-workflow T037: SOP chip row, rendered after the
            latest assistant message when the pending SOP step has chips
            and we're not mid-stream. Sending a chip-derived user message
            triggers the existing useChat flow. */}
        {!isLoading
          && messages.length > 0
          && messages[messages.length - 1]?.role === 'assistant'
          && (
            <Chips
              chips={activeChips}
              onSelect={(label) => {
                startPreflight(label, sopState?.pending_step_slug ?? null);
                append({ role: 'user', content: label });
              }}
              ariaLabel="Choose an option"
            />
          )}

        {/* 010-sop-workflow contact step: form rendered when the pending
            SOP step's chip_source='contact_form'. The form captures
            name + email/phone with browser-native validation; on submit
            it dispatches a human-readable sentence that the advancer's
            contact-form short-circuit parses. */}
        {!isLoading
          && messages.length > 0
          && messages[messages.length - 1]?.role === 'assistant'
          && pendingStepIsContactForm
          && (
            <ContactForm
              onSubmit={(message) => {
                startPreflight(message, sopState?.pending_step_slug ?? null);
                append({ role: 'user', content: message });
              }}
            />
          )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          // 011-preflight-phrase T014: fire preflight in parallel with the
          // useChat submit so a tailored phrase can replace the typing
          // dots before the agent's first token streams.
          if (input.trim()) {
            startPreflight(input, sopState?.pending_step_slug ?? null);
          }
          handleSubmit(e);
        }}
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Type your message..."
          disabled={isLoading}
          autoFocus
          style={{
            flex: 1,
            padding: '12px 14px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            fontSize: '16px',
            outline: 'none',
            fontFamily: 'inherit',
            WebkitAppearance: 'none',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--lc-primary-color, #1a365d)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '#e2e8f0';
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          aria-label="Send message"
          style={{
            padding: '12px 18px',
            borderRadius: '8px',
            backgroundColor: 'var(--lc-primary-color, #1a365d)',
            color: 'var(--lc-primary-text, #ffffff)',
            border: 'none',
            cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 500,
            opacity: isLoading || !input.trim() ? 0.5 : 1,
            minWidth: '44px',
            minHeight: '44px',
          }}
        >
          Send
        </button>
      </form>

      {/* Disclaimer */}
      <div
        style={{
          padding: '8px 16px',
          fontSize: '11px',
          color: '#a0aec0',
          textAlign: 'center',
          borderTop: '1px solid #f0f4f8',
          flexShrink: 0,
        }}
      >
        AI assistant — not legal advice
      </div>
    </div>
  );
}
