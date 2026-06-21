import { useChat } from '@ai-sdk/react';
import { useRef, useEffect, useState, useMemo } from 'react';
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
import type { SOPStateHeaderPayload } from '@legal-chatbot/shared';
import { RestartIcon, ExpandIcon, CollapseIcon, CloseIcon } from '../assets/icons';

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

function clearSessionId() {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('lc_session_id');
    sessionStorage.removeItem('lc_sop_state');
  }
}

interface WidgetTheme {
  /** Stable preset id ('default' | 'sunset' | …). Display-only. */
  id: string;
  /**
   * Paintable background — solid color OR CSS gradient (any
   * background-image-compatible value). Applied as
   * `--lc-primary-bg` on the wrapper.
   */
  primary_bg: string;
  /**
   * Solid color for borders and foreground text. Applied as
   * `--lc-primary-color` on the wrapper.
   */
  primary_color: string;
}

interface WidgetConfig {
  chatbot_name: string;
  greeting_message: string;
  in_scope_case_types: string[];
  phone: string;
  /** SOP structure when the account has a published SOP, else null. */
  sop?: WidgetSOP | null;
  /** Case-type catalog with sub-types (010-sop-workflow T033). */
  case_types?: WidgetCaseType[];
  /**
   * Optional firm-configured visual theme. Null when the firm hasn't
   * customised colors — the widget falls back to the indigo defaults
   * declared in panel.css.
   */
  theme?: WidgetTheme | null;
}

interface RestoredSession {
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
  sopState: SOPStateHeaderPayload | null;
}

/**
 * Outer shell: fetches history for an existing session before mounting
 * the inner panel. This ensures useChat receives initialMessages only
 * once (the hook ignores changes to initialMessages after first render).
 *
 * Flow:
 *   - No stored session ID → mount ChatPanelInner immediately with empty history
 *   - Stored session ID → fetch /api/chat/history, then mount inner with restored messages
 *   - 404 from server (session expired) → clear sessionStorage, mount fresh
 */
export function ChatPanel(props: ChatPanelProps) {
  const { apiKey, apiUrl } = props;
  const [restored, setRestored] = useState<RestoredSession | null>(null);
  const [historyReady, setHistoryReady] = useState(false);

  useEffect(() => {
    const storedSessionId = getSessionId();
    if (!storedSessionId) {
      setHistoryReady(true);
      return;
    }

    const baseUrl = apiUrl.replace(/\/api\/chat\/?$/, '');
    fetch(`${baseUrl}/api/chat/history`, {
      headers: {
        'x-api-key': apiKey,
        'x-session-id': storedSessionId,
      },
    })
      .then((res) => {
        if (res.status === 404) {
          // Session expired on server — start fresh.
          clearSessionId();
          return null;
        }
        if (!res.ok) return null;
        return res.json() as Promise<RestoredSession>;
      })
      .then((data) => {
        if (data && data.messages.length > 0) {
          setRestored(data);
        }
        setHistoryReady(true);
      })
      .catch(() => {
        // Network error — start fresh rather than blocking the widget.
        setHistoryReady(true);
      });
  // Run once on mount. apiUrl/apiKey are stable for the widget's lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!historyReady) {
    // Minimal loading state — keeps the panel shell present but empty
    // so the user sees the panel open immediately.
    return (
      <ChatPanelInner
        {...props}
        initialMessages={[]}
        restoredSopState={null}
        isLoadingHistory={true}
      />
    );
  }

  return (
    <ChatPanelInner
      {...props}
      initialMessages={restored?.messages ?? []}
      restoredSopState={restored?.sopState ?? null}
      isLoadingHistory={false}
    />
  );
}

interface ChatPanelInnerProps extends ChatPanelProps {
  initialMessages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
  restoredSopState: SOPStateHeaderPayload | null;
  isLoadingHistory: boolean;
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
function ChatPanelInner({
  apiKey,
  apiUrl,
  onCloseRequest,
  onClosed,
  mode = 'floating',
  extraHeaders,
  initialMessages,
  restoredSopState,
  isLoadingHistory,
}: ChatPanelInnerProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
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

  const { sopState: liveSopState, onResponse: onSOPResponse } = useSOPState(restoredSopState);
  const sopState = liveSopState;
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

  const { messages, setMessages, input, handleInputChange, handleSubmit, isLoading, error, append } = useChat({
    api: apiUrl,
    fetch: sessionAwareFetch,
    initialMessages,
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

  // When sopState is null (fresh session, no chat turn yet), derive the
  // initial pending step from the SOP config directly so chips appear
  // alongside the greeting without needing a round-trip first.
  const initialPendingStepSlug = useMemo(() => {
    if (sopState !== null) return null;  // server state takes over once a turn fires
    if (!widgetConfig?.sop?.steps?.length) return null;
    const first = [...widgetConfig.sop.steps].sort((a, b) => a.position - b.position)[0];
    return first?.slug ?? null;
  }, [sopState, widgetConfig?.sop]);

  const activeChips = useMemo(
    () =>
      computeActiveChips({
        sop: widgetConfig?.sop ?? null,
        caseTypes: widgetConfig?.case_types ?? [],
        capturedCaseTypeSlug: sopState?.captured_case_type_slug ?? null,
        pendingStepSlug: sopState?.pending_step_slug ?? initialPendingStepSlug,
        isFinalized: sopState?.is_finalized ?? false,
        branchActiveChips: sopState?.branch_active_chips ?? null,
      }),
    [widgetConfig, sopState, initialPendingStepSlug],
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

  // Undo: pop the last [user, assistant] message pair from local state.
  // Client-side only — server session retains full history.
  function handleUndo() {
    setMessages((prev) => prev.length >= 2 ? prev.slice(0, -2) : prev);
  }

  // The Composer's chips prop is a flat list of strings rather than the
  // ChipSpec object that <Chips> consumes. We pass the raw labels via
  // Composer (which renders its own chip buttons), AND keep <Chips>
  // available for the trailing slot when SOP-driven chips need richer
  // rendering (e.g. selected state, shimmer).
  const chipLabels = useMemo<string[] | null>(() => {
    if (!activeChips || activeChips.length === 0) return null;
    return activeChips.map((c) => c.label);
  }, [activeChips]);

  // Derived: show chips/contact-form trailing slot when either:
  // (a) the assistant just spoke (normal mid-SOP state), OR
  // (b) no messages yet but we have chips ready (greeting screen).
  const showSOPTrailing =
    !isLoading
    && !isLoadingHistory
    && (
      (messages.length > 0 && messages[messages.length - 1]?.role === 'assistant')
      || (messages.length === 0 && activeChips.length > 0)
    );

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

  // Greeting node — render only after `/api/config` resolves so we
  // don't briefly flash the hardcoded fallback message before the
  // firm-configured `greeting_message` + practice-area chips arrive.
  // Mirrors the spec-016 chip-list-flash fix in `QuickReplies.tsx`,
  // which gates the chip row on `options` being defined for the same
  // reason. When widgetConfig is null the greeting slot stays empty;
  // MessageList renders an empty conversation area, then re-renders
  // with the full greeting once the config payload lands (single paint,
  // no transient fallback).
  //
  // When history is restored, suppress the greeting so it doesn't appear
  // above the existing conversation.
  const greetingNode = widgetConfig && messages.length === 0 ? (
    <>
      {/* Large bold heading — matches reference design */}
      <div
        style={{
          fontSize: '22px',
          fontWeight: 700,
          color: '#111827',
          lineHeight: '1.3',
          marginBottom: '8px',
          padding: '0 4px',
        }}
      >
        {widgetConfig.greeting_message}
      </div>
      {/* Bot avatar + timestamp row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: '#F3F4F6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          👻
        </div>
        <span style={{ fontSize: '12px', color: '#9CA3AF' }}>a few seconds ago</span>
      </div>
    </>
  ) : undefined;

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

  const toolbarBtnStyle: React.CSSProperties = {
    width: 'var(--lc-toolbar-icon-size, 36px)',
    height: 'var(--lc-toolbar-icon-size, 36px)',
    borderRadius: '50%',
    border: '1px solid #E5E7EB',
    background: 'transparent',
    color: '#6B7280',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'background 0.15s',
  };

  return (
    <PanelShell
      isOpen={isOpen}
      mode={mode}
      onClosed={onClosed}
      onCloseRequest={requestClose}
      ariaLabel={`Chat with ${widgetConfig?.chatbot_name ?? 'LexBot'}`}
      isExpanded={isExpanded}
    >
      {/* 1. Header — transparent with floating toolbar top-right */}
      <div
        style={{
          position: 'relative',
          flexShrink: 0,
          height: '60px',
          background: '#ffffff',
        }}
      >
        {mode === 'floating' && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              display: 'flex',
              gap: '6px',
            }}
          >
            <button
              onClick={() => {
                // Reset: clear session and reload
                clearSessionId();
                window.location.reload();
              }}
              aria-label="Restart chat"
              style={toolbarBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#F3F4F6'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <RestartIcon />
            </button>
            <button
              onClick={() => setIsExpanded((v) => !v)}
              aria-label={isExpanded ? 'Collapse chat' : 'Expand chat'}
              style={toolbarBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#F3F4F6'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
            </button>
            <button
              onClick={requestClose}
              aria-label="Close chat"
              style={toolbarBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#F3F4F6'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <CloseIcon />
            </button>
          </div>
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
        onUndo={handleUndo}
        isLoading={isLoading}
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
        disabled={isLoading || isLoadingHistory}
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
