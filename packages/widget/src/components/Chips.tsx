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
            borderRadius: 'var(--lc-message-radius, 16px)',
            // The border stays on --lc-primary-color (must be a solid
            // color; CSS borders cannot be gradients without
            // background-clip tricks). The background uses the gradient-
            // capable --lc-primary-bg via the `background` shorthand.
            border: '1px solid var(--lc-primary-color, #4338ca)',
            background: 'transparent',
            color: 'var(--lc-primary-color, #4338ca)',
            fontSize: '13px',
            cursor: 'pointer',
            // background transitions only animate solid-color changes
            // (CSS does not animate gradients). When --lc-primary-bg is
            // a gradient the hover swap is instant; with a solid color
            // it smoothly fades. Acceptable trade-off for gradient
            // support.
            transition: 'background-color 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background =
              'var(--lc-primary-bg, #4338ca)';
            e.currentTarget.style.color =
              'var(--lc-primary-text, #ffffff)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color =
              'var(--lc-primary-color, #4338ca)';
          }}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}