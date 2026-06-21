import { forwardRef } from 'react';

interface ChatBubbleProps {
  isOpen: boolean;
  onClick: () => void;
  showTooltip?: boolean;
}

/**
 * 023-widget-redesign — redesigned launcher bubble.
 * Ghost avatar on a grey circle with a green online dot and an
 * optional "Need help?" tooltip. Behaviour unchanged from spec 017.
 */
export const ChatBubble = forwardRef<HTMLButtonElement, ChatBubbleProps>(
  function ChatBubble({ isOpen, onClick, showTooltip = false }, ref) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9998,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        {/* "Need help?" tooltip — speech bubble to the left */}
        {showTooltip && !isOpen && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
              padding: '8px 14px',
              fontSize: '13px',
              color: '#1F2937',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
              // Speech bubble tail on the right
              position: 'relative',
            }}
          >
            Need help?
            <span
              style={{
                position: 'absolute',
                right: '-6px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: 0,
                height: 0,
                borderTop: '6px solid transparent',
                borderBottom: '6px solid transparent',
                borderLeft: '6px solid #ffffff',
              }}
            />
          </div>
        )}

        {/* Launcher button — grey circle with ghost avatar */}
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            ref={ref}
            onClick={onClick}
            aria-label={isOpen ? 'Close chat' : 'Open chat'}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: '#F3F4F6',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              fontSize: '26px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.16)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
            }}
          >
            {isOpen ? '✕' : '👻'}
          </button>

          {/* Green online dot */}
          {!isOpen && (
            <span
              style={{
                position: 'absolute',
                bottom: '2px',
                right: '2px',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#22C55E',
                border: '2px solid #ffffff',
              }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    );
  },
);
