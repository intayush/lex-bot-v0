import { forwardRef } from 'react';

interface ChatBubbleProps {
  isOpen: boolean;
  onClick: () => void;
}

/**
 * Spec 017 — restyled bubble using the warm-indigo accent. Behavior is
 * unchanged from spec 010+; only the default colors and the soft warm
 * shadow are updated to match the new design tokens.
 *
 * The component accepts a forwarded ref so the parent (`ChatWidget`)
 * can move focus back to the bubble after the panel finishes closing
 * (Spec 017 FR-007 / a11y focus return).
 */
export const ChatBubble = forwardRef<HTMLButtonElement, ChatBubbleProps>(
  function ChatBubble({ isOpen, onClick }, ref) {
    return (
      <button
        ref={ref}
        onClick={onClick}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          // `background` shorthand so the bubble accepts a gradient via
          // --lc-primary-bg. `backgroundColor` cannot hold a gradient.
          background: 'var(--lc-primary-bg, #4338ca)',
          color: 'var(--lc-primary-text, #ffffff)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 8px 24px rgba(20, 16, 8, 0.16)',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          zIndex: 9998,
          fontSize: '24px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
          e.currentTarget.style.boxShadow = '0 10px 28px rgba(20, 16, 8, 0.22)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 8px 24px rgba(20, 16, 8, 0.16)';
        }}
      >
        {isOpen ? '✕' : '💬'}
      </button>
    );
  },
);
