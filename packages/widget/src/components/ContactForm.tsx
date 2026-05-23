/**
 * Contact-info input form (010-sop-workflow contact step).
 *
 * Rendered inside the chat panel when the visitor's pending SOP step is
 * a contact_form step (default SOP step 6). Captures name + email +
 * phone. Submit is disabled until name AND (email OR phone) are filled.
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

export function ContactForm({ onSubmit }: ContactFormProps): ReactElement {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Visitor must give name AND at least one of email/phone.
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const trimmedPhone = phone.trim();
  const hasContact = trimmedEmail.length > 0 || trimmedPhone.length > 0;
  const canSubmit = trimmedName.length > 0 && hasContact;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    // Build a sentence the partial-lead regex can extract reliably.
    const parts: string[] = [`My name is ${trimmedName}`];
    if (trimmedEmail) parts.push(`my email is ${trimmedEmail}`);
    if (trimmedPhone) parts.push(`my phone is ${trimmedPhone}`);
    const message = parts.join(', ');
    onSubmit(message);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid #cbd5e0',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    backgroundColor: '#ffffff',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 500,
    color: '#4a5568',
    marginBottom: '4px',
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Contact information"
      style={{
        backgroundColor: 'var(--lc-bubble-bot, #f0f4f8)',
        padding: '14px',
        borderRadius: '12px 12px 12px 4px',
        marginTop: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxWidth: '85%',
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
          placeholder="jane@example.com"
          style={inputStyle}
        />
      </div>
      <div>
        <label htmlFor="lc-contact-phone" style={labelStyle}>Phone</label>
        <input
          id="lc-contact-phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 867-5309"
          style={inputStyle}
        />
      </div>
      <div style={{ fontSize: '11px', color: '#718096', lineHeight: 1.4 }}>
        Provide at least one of email or phone so we can follow up.
      </div>
      <button
        type="submit"
        disabled={!canSubmit}
        style={{
          padding: '10px 16px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: canSubmit
            ? 'var(--lc-primary-color, #1a365d)'
            : '#cbd5e0',
          color: 'var(--lc-primary-text, #ffffff)',
          fontSize: '14px',
          fontWeight: 500,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          opacity: canSubmit ? 1 : 0.7,
          transition: 'background-color 0.15s, opacity 0.15s',
          fontFamily: 'inherit',
        }}
      >
        Submit
      </button>
    </form>
  );
}
