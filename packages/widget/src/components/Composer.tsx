import type { FormEvent, ReactNode } from 'react';

import { ContactForm } from './ContactForm';

/**
 * Spec 017 — Composer: presentational component holding the chips row,
 * input + send button (or contact form), and the persistent disclaimer.
 * The chat orchestrator (ChatPanel) wires the props.
 *
 * The disclaimer is rendered inside the composer (not the message
 * stream) per Constitution Principle VI / FR-020 — it must be
 * permanently visible whenever the panel is open.
 */

export interface ComposerProps {
  /** Chip labels to render above the input. null/[] hides the row. */
  chips: string[] | null;
  /** Called with the chip label when a chip is tapped. */
  onChipSelect?: (label: string) => void;
  /** When set, the input is replaced by the contact form. */
  contactForm?: { onSubmit: (message: string) => void };
  /** Submit handler for the input row form. */
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** Controlled input value. */
  inputValue: string;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Disable input + send while streaming. */
  disabled: boolean;
  /** Optional placeholder override. */
  placeholder?: string;
}

const DISCLAIMER =
  'I am an AI assistant, not a lawyer. Nothing I say constitutes legal advice.';

export function Composer({
  chips,
  onChipSelect,
  contactForm,
  onSubmit,
  inputValue,
  onInputChange,
  disabled,
  placeholder = 'Type your message...',
}: ComposerProps) {
  const showChips = !!chips && chips.length > 0;

  return (
    <div className="lc-composer" style={{ flexShrink: 0 }}>
      {showChips && (
        <div
          data-testid="lc-chip-row"
          role="group"
          aria-label="Choose an option"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '8px 16px 0',
          }}
        >
          {chips!.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChipSelect?.(c)}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--lc-message-radius, 16px)',
                border: '1px solid var(--lc-border-subtle, rgba(31,27,22,0.06))',
                backgroundColor: 'var(--lc-message-bg-assistant, #f5f1e8)',
                color: 'var(--lc-text-primary, #1f1b16)',
                fontSize: '13px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {contactForm ? (
        <div style={{ padding: '12px 16px' }}>
          <ContactForm onSubmit={contactForm.onSubmit} />
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          style={{
            padding: '12px 16px',
            borderTop: showChips
              ? 'none'
              : '1px solid var(--lc-border-subtle, rgba(31,27,22,0.06))',
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            value={inputValue}
            onChange={onInputChange}
            placeholder={placeholder}
            disabled={disabled}
            style={{
              flex: 1,
              padding: '12px 14px',
              borderRadius: '12px',
              border: '1.5px solid #E5E7EB',
              fontSize: '14px',
              outline: 'none',
              fontFamily: 'inherit',
              backgroundColor: '#ffffff',
              color: 'var(--lc-text-primary, #111827)',
              WebkitAppearance: 'none',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--lc-primary-color, #4338ca)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = '#E5E7EB';
            }}
          />
          <button
            type="submit"
            disabled={disabled || !inputValue.trim()}
            aria-label="Send message"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'var(--lc-primary-bg, #4338ca)',
              color: 'var(--lc-primary-text, #ffffff)',
              border: 'none',
              cursor: disabled || !inputValue.trim() ? 'not-allowed' : 'pointer',
              opacity: disabled || !inputValue.trim() ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: '16px',
            }}
          >
            ›
          </button>
        </form>
      )}

      {/* Persistent disclaimer — Constitution VI / FR-020. */}
      <div
        style={{
          padding: '8px 16px env(safe-area-inset-bottom, 8px)',
          fontSize: '11px',
          color: 'var(--lc-text-muted, #9CA3AF)',
          textAlign: 'center',
        }}
      >
        {DISCLAIMER}
      </div>
    </div>
  );
}

// Re-export for type-only use elsewhere.
export type { ReactNode };
