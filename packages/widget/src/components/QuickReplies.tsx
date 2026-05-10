interface QuickRepliesProps {
  onSelect: (text: string) => void;
  options?: string[];
}

const DEFAULT_OPTIONS = [
  'Personal Injury',
  'Family Law',
  'Estate Planning',
];

const CONSULTATION_OPTION = 'Schedule a Consultation';

export function QuickReplies({ onSelect, options }: QuickRepliesProps) {
  const baseOptions = options && options.length > 0 ? options : DEFAULT_OPTIONS;
  const allOptions = baseOptions.includes(CONSULTATION_OPTION)
    ? baseOptions
    : [...baseOptions, CONSULTATION_OPTION];

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
            borderRadius: '16px',
            border: '1px solid var(--lc-primary-color, #1a365d)',
            backgroundColor: 'transparent',
            color: 'var(--lc-primary-color, #1a365d)',
            fontSize: '13px',
            cursor: 'pointer',
            transition: 'background-color 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--lc-primary-color, #1a365d)';
            e.currentTarget.style.color = 'var(--lc-primary-text, #ffffff)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--lc-primary-color, #1a365d)';
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
