/**
 * Spec 015 T019 — `captureLead` LLM tool parameter schema.
 *
 * Asserts the tool's `classification` field accepts the new 4-value
 * vocabulary and rejects the legacy 3-value vocabulary. Per
 * `contracts/lead-classification-enum.md §Producers` item 2.
 */
import { describe, expect, it } from 'vitest';

import { captureLeadToolParams } from './tool-params.js';

describe('captureLeadToolParams.classification — 4-value enum (spec 015)', () => {
  function parse(value: unknown) {
    return captureLeadToolParams.shape.classification.safeParse(value);
  }

  it.each(['HOT', 'WARM', 'COLD', 'SPAM'])('accepts %s', (value) => {
    const result = parse(value);
    expect(result.success).toBe(true);
  });

  it.each(['urgent', 'normal', 'unqualified'])(
    'rejects legacy value %s',
    (value) => {
      const result = parse(value);
      expect(result.success).toBe(false);
    },
  );

  it.each([null, undefined, '', 'hot', 'HOTT', 42])(
    'rejects malformed value %p',
    (value) => {
      const result = parse(value);
      expect(result.success).toBe(false);
    },
  );
});
