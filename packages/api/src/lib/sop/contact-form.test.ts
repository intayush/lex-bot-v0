/**
 * Tests for the SOP contact-form helper (010-sop-workflow contact step).
 *
 * Pure-functional. Uses the same regex patterns as partial-lead.ts so
 * the form-submitted message format and natural free-text both work.
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

describe('extractContactPayload — incomplete payloads return null (form re-renders)', () => {
  it('returns null when name is missing', () => {
    expect(extractContactPayload('jane@example.com 555-867-5309')).toBeNull();
  });

  it('returns null when both email AND phone are missing', () => {
    expect(extractContactPayload("My name is Jane")).toBeNull();
  });

  it('returns null on empty message', () => {
    expect(extractContactPayload("")).toBeNull();
    expect(extractContactPayload("   ")).toBeNull();
  });
});
