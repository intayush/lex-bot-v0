/**
 * Contact-info input form (010-sop-workflow contact step).
 *
 * Rendered inside the chat panel when the visitor's pending SOP step is
 * a contact_form step (default SOP step 6). Captures name + email +
 * phone. Submit is disabled until name AND (valid email OR valid US phone)
 * are filled.
 *
 * On submit, dispatches a human-readable message via the `onSubmit` prop
 * — the existing useChat flow handles the rest. The advancer's
 * contact-form short-circuit detects the pending contact step and
 * extracts the structured payload via regex (same patterns as
 * partial-lead.ts).
 */
import type { ReactElement } from 'react';
import { useState } from 'react';

interface ContactFormProps {
  /** Called with a human-readable submit message. */
  onSubmit: (message: string) => void;
}

/** Basic email format: something@something.something */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * US phone validation. Accepts the common formats a visitor might type:
 *   10 digits bare: 4155551234
 *   With dashes: 415-555-1234
 *   With dots: 415.555.1234
 *   With spaces: 415 555 1234
 *   With parens: (415) 555-1234
 *   With +1 country code: +1 415 555 1234 / +14155551234
 */
function isValidUSPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  // Strip leading country code 1 if present (resulting in 10 digits)
  const normalized = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
  return normalized.length === 10;
}

/** Format a 10-digit string as (XXX) XXX-XXXX for display */
function formatUSPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const d = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
  if (d.length === 0) return value;
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

export function ContactForm({ onSubmit }: ContactFormProps): ReactElement {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const trimmedPhone = phone.trim();

  const emailFilled = trimmedEmail.length > 0;
  const phoneFilled = trimmedPhone.length > 0;
  const emailValid = !emailFilled || isValidEmail(trimmedEmail);
  const phoneValid = !phoneFilled || isValidUSPhone(trimmedPhone);

  const hasValidContact =
    (emailFilled && isValidEmail(trimmedEmail)) ||
    (phoneFilled && isValidUSPhone(trimmedPhone));

  const canSubmit = trimmedName.length > 0 && hasValidContact && emailValid && phoneValid;

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Allow the user to type freely; only format when it looks like digits
    const digits = raw.replace(/\D/g, '');
    if (digits.length <= 11) {
      setPhone(formatUSPhone(raw));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const parts: string[] = [`My name is ${trimmedName}`];
    if (trimmedEmail) parts.push(`my email is ${trimmedEmail}`);
    if (trimmedPhone) parts.push(`my phone is ${trimmedPhone}`);
    onSubmit(parts.join(', '));
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '12px',
    border: '1.5px solid #E5E7EB',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    backgroundColor: '#ffffff',
    color: 'var(--lc-text-primary, #111827)',
    boxSizing: 'border-box',
  };

  const errorStyle: React.CSSProperties = {
    fontSize: '11px',
    color: '#EF4444',
    marginTop: '3px',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--lc-text-muted, #9CA3AF)',
    marginBottom: '4px',
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Contact information"
      style={{
        backgroundColor: '#F9FAFB',
        padding: '14px',
        borderRadius: '16px',
        marginTop: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxWidth: '85%',
        border: '1px solid #E5E7EB',
      }}
    >
      <div>
        <label htmlFor="lc-contact-name" style={labelStyle}>Name *</label>
        <input
          id="lc-contact-name"
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Doe"
          style={inputStyle}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--lc-primary-color, #4338ca)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = '#E5E7EB'; }}
        />
      </div>

      <div>
        <label htmlFor="lc-contact-email" style={labelStyle}>Email</label>
        <input
          id="lc-contact-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTouched(true)}
          placeholder="jane@example.com"
          style={{
            ...inputStyle,
            borderColor: emailTouched && emailFilled && !emailValid ? '#EF4444' : '#E5E7EB',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--lc-primary-color, #4338ca)'; }}
        />
        {emailTouched && emailFilled && !emailValid && (
          <div style={errorStyle}>Please enter a valid email address.</div>
        )}
      </div>

      <div>
        <label htmlFor="lc-contact-phone" style={labelStyle}>Phone</label>
        <input
          id="lc-contact-phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={handlePhoneChange}
          onBlur={() => setPhoneTouched(true)}
          placeholder="(555) 867-5309"
          style={{
            ...inputStyle,
            borderColor: phoneTouched && phoneFilled && !phoneValid ? '#EF4444' : '#E5E7EB',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--lc-primary-color, #4338ca)'; }}
        />
        {phoneTouched && phoneFilled && !phoneValid && (
          <div style={errorStyle}>Please enter a valid 10-digit US phone number.</div>
        )}
      </div>

      <div style={{ fontSize: '11px', color: 'var(--lc-text-muted, #9CA3AF)', lineHeight: 1.4 }}>
        Provide at least one of email or phone so we can follow up.
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        style={{
          padding: '10px 16px',
          borderRadius: '12px',
          border: 'none',
          background: canSubmit ? 'var(--lc-primary-bg, #4338ca)' : 'rgba(0,0,0,0.08)',
          color: canSubmit ? 'var(--lc-primary-text, #ffffff)' : '#9CA3AF',
          fontSize: '14px',
          fontWeight: 500,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          transition: 'background 0.15s, opacity 0.15s',
          fontFamily: 'inherit',
        }}
      >
        Submit
      </button>
    </form>
  );
}
