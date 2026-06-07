import { useEffect, useRef } from 'react';

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
}

export function MessageList({
  messages,
  preflightPhrase,
  isStreaming,
  greeting,
  errorBanner,
  trailing,
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

      {messages.map((m) => (
        <div
          key={m.id}
          style={{
            display: 'flex',
            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
          }}
        >
          <div
            className="lc-message"
            data-variant={m.role === 'user' ? 'user' : 'assistant'}
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--lc-message-radius, 16px)',
              maxWidth: '80%',
              fontSize: '14px',
              lineHeight: '1.5',
              // Use `background` (shorthand) so the primary surface accepts
              // either a solid color OR a gradient via --lc-primary-bg.
              // `backgroundColor` cannot hold a gradient value.
              background:
                m.role === 'user'
                  ? 'var(--lc-primary-bg, #4338ca)'
                  : 'var(--lc-message-bg-assistant, #f5f1e8)',
              color:
                m.role === 'user'
                  ? 'var(--lc-primary-text, #ffffff)'
                  : 'var(--lc-text-primary, #1f1b16)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              border:
                m.role === 'user'
                  ? 'none'
                  : '1px solid var(--lc-border-subtle, rgba(31,27,22,0.06))',
            }}
          >
            {m.content}
          </div>
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
