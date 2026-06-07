import { useChat } from '@ai-sdk/react';
import { useRef, useEffect, useState, useMemo } from 'react';
import { QuickReplies } from './QuickReplies';
import { Chips } from './Chips';
import { ProgressBar } from './ProgressBar';
import { PanelShell } from './PanelShell';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
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
  /** Called when the user requests close (header X, Escape, scrim). */
  onCloseRequest: () => void;
  /** Called after the close animation completes (parent unmounts). */
  onClosed: () => void;
  /**
   * Spec 017 + dashboard preview parity. `'embedded'` renders the
   * panel inline inside its parent's flow (no fixed positioning,
   * no animation, no scroll-lock, role="region" instead of dialog).
   * Defaults to `'floating'` for the production widget. See
   * `PanelShell` JSDoc for the full mode contract.
   */
  mode?: 'floating' | 'embedded';
  /**
   * Extra headers merged into BOTH the /api/config fetch and the
   * /api/chat useChat call. The dashboard preview uses this to inject
   * `x-preview: true` so the server returns the latest (unpublished)
   * SOP / config draft. Embedding firms typically don't need this.
   */
  extraHeaders?: Record<string, string>;
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

/**
 * Spec 017 — `ChatPanel` is the chatbot orchestrator. It owns:
 *   - the AI SDK `useChat` (messages, streaming, send)
 *   - `useSOPState` + `usePreflightPhrase` + the SOP-step computation
 *   - the `widgetConfig` fetch from /api/config
 *   - the session-id `sessionStorage` round-trip via `sessionAwareFetch`
 *
 * The visual surface is delegated to:
 *   - `PanelShell` (positioning, glass, animation, scroll-lock, ARIA)
 *   - `MessageList` (the conversation-area surface)
 *   - `Composer` (chips + input/contact-form + disclaimer)
 *
 * ChatPanel itself stays a thin orchestrator: it computes derived
 * state (active chips, contact-form pending) and passes everything
 * down as props.
 */
export function ChatPanel({
  apiKey,
  apiUrl,
  onCloseRequest,
  onClosed,
  mode = 'floating',
  extraHeaders,
}: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [widgetConfig, setWidgetConfig] = useState<WidgetConfig | null>(null);

  useEffect(() => {
    const baseUrl = apiUrl.replace(/\/api\/chat\/?$/, '');
    const configUrl = `${baseUrl}/api/config`;
    fetch(configUrl, {
      headers: {
        'x-api-key': apiKey,
        ...(extraHeaders ?? {}),
      },
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
    // extraHeaders intentionally NOT in deps: refetching when the parent
    // passes a new object reference each render would loop. Embedded
    // hosts should keep the headers stable (memoize at the call site).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, apiKey]);

  const { sopState, onResponse: onSOPResponse } = useSOPState();
  const reducedMotion = useReducedMotion();

  const { phrase: preflightPhrase, start: startPreflight, clear: clearPreflight } = usePreflightPhrase();

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
      ...(extraHeaders ?? {}),
    },
    onResponse(response) {
      const newSessionId = response.headers.get('x-session-id');
      if (newSessionId) {
        saveSessionId(newSessionId);
      }
      onSOPResponse(response);
    },
  });

  const activeChips = useMemo(
    () =>
      computeActiveChips({
        sop: widgetConfig?.sop ?? null,
        caseTypes: widgetConfig?.case_types ?? [],
        capturedCaseTypeSlug: sopState?.captured_case_type_slug ?? null,
        pendingStepSlug: sopState?.pending_step_slug ?? null,
        isFinalized: sopState?.is_finalized ?? false,
        branchActiveChips: sopState?.branch_active_chips ?? null,
      }),
    [widgetConfig, sopState],
  );

  const pendingStepIsContactForm = useMemo(() => {
    if (!widgetConfig?.sop || !sopState?.pending_step_slug || sopState.is_finalized) {
      return false;
    }
    const step = widgetConfig.sop.steps.find((s) => s.slug === sopState.pending_step_slug);
    return step?.chip_source === 'contact_form';
  }, [widgetConfig, sopState]);

  // Clear preflight phrase as soon as the assistant's first token streams.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && typeof last.content === 'string' && last.content.length > 0) {
      clearPreflight();
    }
  }, [messages, clearPreflight]);

  // Single source of truth for "user wants to close": flips the local
  // isOpen (which drives PanelShell.isOpen) AND signals the parent
  // (ChatWidget) so it can flip its own isOpen state in sync. Used by
  // the header X, by Escape (via PanelShell), and by the mobile scrim
  // (also via PanelShell). Without this unified handler, the header X
  // only updated local state and the parent re-mounted ChatPanel via
  // its `if (isOpen && !isMounted) setIsMounted(true)` auto-mount
  // effect — visible as the panel staying open after clicking X.
  const requestClose = () => {
    setIsOpen(false);
    onCloseRequest();
  };

  // The Composer's chips prop is a flat list of strings rather than the
  // ChipSpec object that <Chips> consumes. We pass the raw labels via
  // Composer (which renders its own chip buttons), AND keep <Chips>
  // available for the trailing slot when SOP-driven chips need richer
  // rendering (e.g. selected state, shimmer).
  const chipLabels = useMemo<string[] | null>(() => {
    if (!activeChips || activeChips.length === 0) return null;
    return activeChips.map((c) => c.label);
  }, [activeChips]);

  // Derived: is the assistant the most recent speaker AND not still
  // streaming? Used to gate the chip + contact-form trailing slots.
  const showSOPTrailing =
    !isLoading
    && messages.length > 0
    && messages[messages.length - 1]?.role === 'assistant';

  // SOP chips render in the conversation trailing slot (NOT the
  // composer chips row) so they're visually anchored to the most
  // recent assistant message — the existing pre-spec-017 behavior.
  const trailingNode = (
    <>
      {showSOPTrailing && (
        <Chips
          chips={activeChips}
          onSelect={(label) => {
            startPreflight(label, sopState?.pending_step_slug ?? null);
            append({ role: 'user', content: label });
          }}
          ariaLabel="Choose an option"
        />
      )}
    </>
  );

  // Hide composer's own chip row — we use the trailing slot for SOP chips.
  const composerChips = null;

  const greetingNode = (
    <>
      <div
        className="lc-message"
        data-variant="assistant"
        style={{
          backgroundColor: 'var(--lc-message-bg-assistant, #f5f1e8)',
          padding: '12px 16px',
          borderRadius: 'var(--lc-message-radius, 16px)',
          maxWidth: '85%',
          fontSize: '14px',
          lineHeight: '1.5',
          color: 'var(--lc-text-primary, #1f1b16)',
          border: '1px solid var(--lc-border-subtle, rgba(31,27,22,0.06))',
        }}
      >
        {widgetConfig?.greeting_message ?? "Hi! I'm LexBot, a virtual assistant. How can I help you today?"}
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
  );

  const errorBanner = error ? (
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
  ) : null;

  return (
    <PanelShell
      isOpen={isOpen}
      mode={mode}
      onClosed={onClosed}
      onCloseRequest={requestClose}
      ariaLabel={`Chat with ${widgetConfig?.chatbot_name ?? 'LexBot'}`}
    >
      {/* 1. Header */}
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: 'var(--lc-primary-color, #4338ca)',
          color: 'var(--lc-primary-text, #ffffff)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: '16px' }}>{widgetConfig?.chatbot_name ?? 'LexBot'}</div>
          <div style={{ fontSize: '12px', opacity: 0.8 }}>Virtual Assistant</div>
        </div>
        {mode === 'floating' && (
          <button
            onClick={requestClose}
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
        )}
      </div>

      {/* 2. Messages region */}
      <MessageList
        messages={messages.map((m) => ({
          id: m.id,
          role: m.role === 'user' ? 'user' : 'assistant',
          content: typeof m.content === 'string' ? m.content : '',
        }))}
        preflightPhrase={preflightPhrase}
        isStreaming={isLoading}
        greeting={greetingNode}
        errorBanner={errorBanner}
        trailing={
          <>
            {trailingNode}
            {showSOPTrailing && pendingStepIsContactForm && (
              // ContactForm rendered as trailing slot when the pending
              // step is contact_form. Composer's contactForm prop is
              // for a future pattern where the form replaces the input
              // entirely; keeping it here in the trailing slot
              // preserves pre-017 placement.
              <ContactFormTrailing
                onSubmit={(message) => {
                  startPreflight(message, sopState?.pending_step_slug ?? null);
                  append({ role: 'user', content: message });
                }}
              />
            )}
          </>
        }
      />

      {/* 3. Progress bar (renders null when total === 0) */}
      <div style={{ padding: '0 16px', flexShrink: 0 }}>
        <ProgressBar
          current={sopState?.current ?? 0}
          total={sopState?.total ?? 0}
          reducedMotion={reducedMotion}
        />
      </div>

      {/* 4. Composer */}
      <Composer
        chips={composerChips}
        onSubmit={(e) => {
          if (input.trim()) {
            startPreflight(input, sopState?.pending_step_slug ?? null);
          }
          handleSubmit(e);
        }}
        inputValue={input}
        onInputChange={handleInputChange}
        disabled={isLoading}
      />
    </PanelShell>
  );
}

// Local helper: ContactForm rendered as a trailing slot in MessageList
// (anchored to the most recent assistant message). Imported here to
// avoid circular import noise between Composer and ContactForm.
import { ContactForm } from './ContactForm';

function ContactFormTrailing({ onSubmit }: { onSubmit: (message: string) => void }) {
  return <ContactForm onSubmit={onSubmit} />;
}
