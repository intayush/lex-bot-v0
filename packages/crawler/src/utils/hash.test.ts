import { hashContent } from './hash.js';

describe('hashContent', () => {
  it('returns a 12-character hex string', () => {
    const hash = hashContent('hello world');
    expect(hash).toHaveLength(12);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic (same input produces same hash)', () => {
    const hash1 = hashContent('test content');
    const hash2 = hashContent('test content');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different input', () => {
    const hash1 = hashContent('content A');
    const hash2 = hashContent('content B');
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty string', () => {
    const hash = hashContent('');
    expect(hash).toHaveLength(12);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });
});
