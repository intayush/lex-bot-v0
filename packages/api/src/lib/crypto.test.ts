import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './crypto.js';

describe('crypto (AES-256-GCM)', () => {
  it('round-trips plaintext', () => {
    const plaintext = 'sk-ant-super-secret-key-1234567890';
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same-input');
    expect(decrypt(b)).toBe('same-input');
  });

  it('detects tampering via the auth tag', () => {
    const ciphertext = encrypt('tamper-me');
    const parts = ciphertext.split(':');
    // Flip a byte in the ciphertext segment.
    const body = Buffer.from(parts[2], 'base64');
    body[0] = body[0] ^ 0xff;
    parts[2] = body.toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('rejects malformed input', () => {
    expect(() => decrypt('not-a-valid-blob')).toThrow();
  });

  it('handles empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });
});
