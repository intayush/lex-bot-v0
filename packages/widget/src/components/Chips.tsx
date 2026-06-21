/**
 * Chip buttons rendered after an assistant message when an SOP step has
 * a chip-driven question (010-sop-workflow T035).
 *
 * Presentational only — the consumer (ChatPanel) computes the active
 * chip list from the per-account /api/config payload + the per-turn
 * SOP state header. On tap, the chip's label is dispatched as a
 * user message so the existing useChat flow handles it; the server
 * matches against the slug.
 */
import type { Chip } from '@legal-chatbot/shared';

// Inline radio-circle SVG — open circle matching the reference design
function RadioCircle() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  );
}

interface ChipsProps {
  chips: Chip[];
  onSelect: (label: string) => void;
  /** Optional ARIA label describing the chip group's purpose. */
  ariaLabel?: string;
}

export function Chips({ chips, onSelect, ariaLabel }: ChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? 'Choose an option'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        marginTop: '12px',
      }}
    >
      {chips.map((chip) => (
        <button
          key={chip.slug}
          type="button"
          aria-label={chip.label}
          onClick={() => onSelect(chip.label)}
          style={{
            padding: '12px 20px 12px 14px',
            borderRadius: '24px',
            border: '2px solid var(--lc-primary-color, #4338ca)',
            background: 'transparent',
            color: 'var(--lc-primary-color, #4338ca)',
            fontSize: '14px',
            cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            textAlign: 'left',
            alignSelf: 'flex-start',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--lc-primary-bg, #4338ca)';
            e.currentTarget.style.color = 'var(--lc-primary-text, #ffffff)';
            e.currentTarget.style.borderColor = 'var(--lc-primary-color, #4338ca)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--lc-primary-color, #4338ca)';
            e.currentTarget.style.borderColor = 'var(--lc-primary-color, #4338ca)';
          }}
        >
          <RadioCircle />
          {chip.label}
        </button>
      ))}
    </div>
  );
}