/**
 * Tests for the SOP contact-form helper.
 *
 * Spec 010 model: extracts ContactFormPayload from visitor messages
 * dispatched by the chat-widget contact-form (or natural free-text
 * matching the same regex patterns).
 *
 * Spec 016 Q1 (T025): The partial-gate satisfaction predicate now
 * accepts payloads with NULL name as long as ≥ 1 of (email, phone)
 * is present (FR-002). The two earlier tests that asserted "name
 * required" have been replaced with tests that confirm the new
 * behaviour: name-only is rejected, but email-only and phone-only
 * succeed even without a name.
 */
import { describe, it, expect } from 'vitest';
import { extractContactPayload } from './contact-form';

describe('extractContactPayload — full payloads', () => {
  it('extracts name + email + phone from form-submit format', () => {
    const result = extractContactPayload(
      "My name is Jane Doe, my email is jane@example.com, my phone is 555-867-5309",
    );
    expect(result).toEqual({
      name: 'Jane Doe',
      contact_email: 'jane@example.com',
      contact_phone: '555-867-5309',
    });
  });

  it('extracts name + email when phone is omitted', () => {
    const result = extractContactPayload(
      "My name is Jane, my email is jane@example.com",
    );
    expect(result).toEqual({
      name: 'Jane',
      contact_email: 'jane@example.com',
      contact_phone: null,
    });
  });

  it('extracts name + phone when email is omitted', () => {
    const result = extractContactPayload(
      "My name is Jane Doe, my phone is 555-867-5309",
    );
    expect(result).toEqual({
      name: 'Jane Doe',
      contact_email: null,
      contact_phone: '555-867-5309',
    });
  });

  it('handles "I am" / "I\'m" / "this is" name patterns', () => {
    expect(extractContactPayload("I'm Jane, jane@x.co")).toMatchObject({ name: 'Jane' });
    expect(extractContactPayload("i am jane doe, my phone is 555-867-5309")).toMatchObject({ name: 'jane doe' });
    expect(extractContactPayload("this is Jane Doe, jane@x.co")).toMatchObject({ name: 'Jane Doe' });
  });
});

describe('extractContactPayload — partial-gate (spec 016 Q1)', () => {
  it('accepts email-only payload when name is absent (FR-002)', () => {
    const result = extractContactPayload('jane@example.com');
    expect(result).toEqual({
      name: null,
      contact_email: 'jane@example.com',
      contact_phone: null,
    });
  });

  it('accepts phone-only payload when name is absent (FR-002)', () => {
    const result = extractContactPayload('555-867-5309');
    expect(result).toEqual({
      name: null,
      contact_email: null,
      contact_phone: '555-867-5309',
    });
  });

  it('accepts email + phone without a name', () => {
    const result = extractContactPayload('jane@example.com 555-867-5309');
    expect(result).toEqual({
      name: null,
      contact_email: 'jane@example.com',
      contact_phone: '555-867-5309',
    });
  });
});

describe('extractContactPayload — total refusal (FR-002a)', () => {
  it('returns null when both email AND phone are missing (refusal path)', () => {
    expect(extractContactPayload("My name is Jane")).toBeNull();
  });

  it('returns null when name-only with no email or phone', () => {
    expect(extractContactPayload("Jane Doe")).toBeNull();
  });

  it('returns null on empty message', () => {
    expect(extractContactPayload("")).toBeNull();
    expect(extractContactPayload("   ")).toBeNull();
  });
});
