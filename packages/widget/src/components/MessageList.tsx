import { useEffect, useRef } from 'react';

/** Returns true if this index is the most recent user message and there are ≥2 messages. */
function isLastUserMessage(messages: MessageListMessage[], index: number): boolean {
  if (messages.length < 2) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') return i === index;
  }
  return false;
}

// Inline undo SVG to avoid import issues in this component
function UndoIconInline() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2 5H8.5C10.433 5 12 6.567 12 8.5C12 10.433 10.433 12 8.5 12H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 2.5L2 5L4 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/**
 * Spec 017 — MessageList: presentational component for the conversation
 * area. Receives messages from the parent (ChatPanel via @ai-sdk's
 * useChat) and renders them as `data-variant`-keyed cards. Includes the
 * streaming typing indicator with optional preflight phrase.
 *
 * The component does not own scroll behavior — it just auto-scrolls
 * to the bottom when new messages arrive (preserved from pre-spec-017
 * behavior).
 */

export interface MessageListMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface MessageListProps {
  messages: MessageListMessage[];
  preflightPhrase: string | null;
  isStreaming: boolean;
  /** Optional greeting block rendered when messages is empty. */
  greeting?: React.ReactNode;
  /** Optional error banner rendered above the typing indicator. */
  errorBanner?: React.ReactNode;
  /** Optional trailing slot (e.g. SOP chips, contact form). */
  trailing?: React.ReactNode;
  /** Callback to undo the last message pair. When provided, shows undo icon on the last user message. */
  onUndo?: () => void;
  /** Whether the chat is currently loading (disables undo button). */
  isLoading?: boolean;
}

export function MessageList({
  messages,
  preflightPhrase,
  isStreaming,
  greeting,
  errorBanner,
  trailing,
  onUndo,
  isLoading = false,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isStreaming]);

  const showTyping =
    isStreaming && messages[messages.length - 1]?.role !== 'assistant';

  return (
    <div
      style={{
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {messages.length === 0 && greeting}

      {messages.map((m, index) => (
        <div
          key={m.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
            gap: '4px',
          }}
        >
          {m.role === 'user' ? (
            // User bubble: filled blue pill with undo icon to the left
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                justifyContent: 'flex-end',
              }}
            >
              {onUndo && isLastUserMessage(messages, index) && (
                <button
                  type="button"
                  onClick={onUndo}
                  disabled={isLoading}
                  aria-label="Undo last response"
                  style={{
                    width: 'var(--lc-undo-icon-size, 28px)',
                    height: 'var(--lc-undo-icon-size, 28px)',
                    borderRadius: '50%',
                    border: 'none',
                    background: 'transparent',
                    color: '#9CA3AF',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    opacity: isLoading ? 0.4 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background 0.15s',
                    padding: 0,
                  }}
                  onMouseEnter={(e) => { if (!isLoading) e.currentTarget.style.background = '#F3F4F6'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <UndoIconInline />
                </button>
              )}
              <div
                className="lc-message"
                data-variant="user"
                style={{
                  padding: '12px 20px',
                  borderRadius: 'var(--lc-message-radius, 20px)',
                  maxWidth: '75%',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  background: 'var(--lc-primary-bg, #4338ca)',
                  color: 'var(--lc-primary-text, #ffffff)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  border: 'none',
                }}
              >
                {m.content}
              </div>
            </div>
          ) : (
            // Assistant message: plain large text, no bubble
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                maxWidth: '92%',
              }}
            >
              <div
                className="lc-message"
                data-variant="assistant"
                style={{
                  fontSize: '16px',
                  lineHeight: '1.6',
                  color: 'var(--lc-text-primary, #111827)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: 'transparent',
                  padding: 0,
                  border: 'none',
                }}
              >
                {m.content}
              </div>
              {/* Bot avatar + timestamp */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '5px',
                    background: '#F3F4F6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                >
                  👻
                </div>
                <span style={{ fontSize: '11px', color: '#9CA3AF' }}>a few seconds ago</span>
              </div>
            </div>
          )}
          {/* Timestamp below user bubble */}
          {m.role === 'user' && (
            <span style={{ fontSize: '11px', color: '#9CA3AF', textAlign: 'right', paddingRight: '4px' }}>
              a few seconds ago
            </span>
          )}
        </div>
      ))}

      {errorBanner}

      {showTyping && (
        <div
          role="status"
          aria-live="polite"
          data-variant="assistant"
          className="lc-message lc-typing-indicator"
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--lc-message-radius, 16px)',
            maxWidth: '80%',
            fontSize: '14px',
            backgroundColor: 'var(--lc-message-bg-assistant, #f5f1e8)',
            color: 'var(--lc-text-muted, #65604f)',
            border: '1px solid var(--lc-border-subtle, rgba(31,27,22,0.06))',
            alignSelf: 'flex-start',
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

      {trailing}

      <div ref={endRef} />
    </div>
  );
}
