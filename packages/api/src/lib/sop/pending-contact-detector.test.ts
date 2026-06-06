/**
 * Spec 016 US3 T026 — pending-contact detector tests.
 *
 * `detectPendingContact` is a NEW helper (separate from
 * `detectSkippedSteps`) that scans every visitor message for
 * volunteered email/phone/name patterns and returns a ContactFormPayload
 * (or null). The chat route stashes the result into
 * `sopState.pending_contact` so when the runtime reaches Step 6 the
 * advancer can satisfy the step from the stash + a confirmation prompt
 * (FR-005a, R5).
 *
 * The detector NEVER advances a step itself — it only stashes. Step 6
 * advancement remains the responsibility of the contact-form short-
 * circuit in `advancer.ts`.
 */

import { describe, expect, it } from 'vitest';
import { detectPendingContact } from './pending-contact-detector';

describe('detectPendingContact — returns null when no contact info present', () => {
  it('returns null on empty message', () => {
    expect(detectPendingContact('')).toBeNull();
    expect(detectPendingContact('   ')).toBeNull();
  });

  it('returns null when message has no email or phone', () => {
    expect(detectPendingContact('I had a car accident')).toBeNull();
    expect(detectPendingContact('Pittsburgh, PA')).toBeNull();
    expect(detectPendingContact('Today')).toBeNull();
  });
});

describe('detectPendingContact — stashes volunteered fields', () => {
  it('stashes an email when only an email is mentioned', () => {
    expect(detectPendingContact('You can reach me at jane@example.com')).toEqual({
      name: null,
      contact_email: 'jane@example.com',
      contact_phone: null,
    });
  });

  it('stashes a phone when only a phone is mentioned', () => {
    expect(detectPendingContact('Call me at 555-867-5309')).toEqual({
      name: null,
      contact_email: null,
      contact_phone: '555-867-5309',
    });
  });

  it('stashes both email and phone when both appear in one message', () => {
    expect(
      detectPendingContact('jane@example.com or 555-867-5309 works'),
    ).toEqual({
      name: null,
      contact_email: 'jane@example.com',
      contact_phone: '555-867-5309',
    });
  });

  it('stashes name + email when the visitor self-identifies', () => {
    expect(
      detectPendingContact("I'm Jane Doe, jane@example.com"),
    ).toEqual({
      name: 'Jane Doe',
      contact_email: 'jane@example.com',
      contact_phone: null,
    });
  });

  it('handles "my email is …" / "my phone is …" patterns', () => {
    expect(
      detectPendingContact('my email is jane@example.com and my phone is 555-867-5309'),
    ).toEqual({
      name: null,
      contact_email: 'jane@example.com',
      contact_phone: '555-867-5309',
    });
  });
});

describe('detectPendingContact — defensive', () => {
  it('returns null when only a name is mentioned (no reachable channel)', () => {
    expect(detectPendingContact('This is Jane Doe')).toBeNull();
  });

  it('returns null when the email is malformed', () => {
    expect(detectPendingContact('reach me at jane@')).toBeNull();
  });
});
