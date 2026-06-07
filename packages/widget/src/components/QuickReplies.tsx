interface QuickRepliesProps {
  onSelect: (text: string) => void;
  options?: string[];
}

const CONSULTATION_OPTION = 'Schedule a Consultation';

export function QuickReplies({ onSelect, options }: QuickRepliesProps) {
  // Spec 016 chip-list-flash fix: render nothing while the widget
  // config is still loading (`options` undefined) or when the firm
  // has no configured practice_areas (empty array). Without this
  // guard we briefly showed a hard-coded 3-item fallback that
  // swapped to the real list once `/api/config` resolved — a
  // visible glitch on every widget open.
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
            border: '1px solid var(--lc-primary-color, #4338ca)',
            backgroundColor: 'transparent',
            color: 'var(--lc-primary-color, #4338ca)',
            fontSize: '13px',
            cursor: 'pointer',
            transition: 'background-color 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--lc-primary-color, #4338ca)';
            e.currentTarget.style.color = 'var(--lc-primary-text, #ffffff)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--lc-primary-color, #4338ca)';
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
