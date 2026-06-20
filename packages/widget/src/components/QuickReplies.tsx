interface QuickRepliesProps {
  onSelect: (text: string) => void;
  options?: string[];
}

const CONSULTATION_OPTION = 'Schedule a Consultation';

export function QuickReplies({ onSelect, options }: QuickRepliesProps) {
  // Spec 016 chip-list-flash fix: render nothing while the widget
  // config is still loading (`options` undefined) or when the firm
  // has no in_scope_case_types (empty array). Without this guard
  // we briefly showed a hard-coded 3-item fallback that swapped to
  // the real list once `/api/config` resolved — a visible glitch
  // on every widget open.
  if (!options || options.length === 0) {
    return null;
  }

  const allOptions = options.includes(CONSULTATION_OPTION)
    ? options
    : [...options, CONSULTATION_OPTION];

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        marginTop: '8px',
      }}
    >
      {allOptions.map((text) => (
        <button
          key={text}
          onClick={() => onSelect(text)}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--lc-message-radius, 16px)',
            // Border stays on --lc-primary-color (solid). Background
            // uses --lc-primary-bg via `background` shorthand so a
            // gradient paints on hover.
            border: '1px solid var(--lc-primary-color, #4338ca)',
            background: 'transparent',
            color: 'var(--lc-primary-color, #4338ca)',
            fontSize: '13px',
            cursor: 'pointer',
            transition: 'background-color 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--lc-primary-bg, #4338ca)';
            e.currentTarget.style.color = 'var(--lc-primary-text, #ffffff)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--lc-primary-color, #4338ca)';
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
