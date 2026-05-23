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
      aria-label={ariaLabel ?? 'Quick reply options'}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        marginTop: '8px',
      }}
    >
      {chips.map((chip) => (
        <button
          key={chip.slug}
          type="button"
          aria-label={chip.label}
          onClick={() => onSelect(chip.label)}
          style={{
            padding: '8px 14px',
            borderRadius: '16px',
            border: '1px solid var(--lc-primary-color, #1a365d)',
            backgroundColor: 'transparent',
            color: 'var(--lc-primary-color, #1a365d)',
            fontSize: '13px',
            cursor: 'pointer',
            transition: 'background-color 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor =
              'var(--lc-primary-color, #1a365d)';
            e.currentTarget.style.color =
              'var(--lc-primary-text, #ffffff)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color =
              'var(--lc-primary-color, #1a365d)';
          }}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}