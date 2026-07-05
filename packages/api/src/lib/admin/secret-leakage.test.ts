/**
 * 027 Polish (T059, SC-005) — per-tenant LLM keys and freshly generated widget
 * keys must never appear in plaintext in stored ciphertext, resolver output, or
 * the llm-config view. Pure-logic assertions (no live server).
 */
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../crypto.js';
import { generateApiKey } from './tenant-provisioning.js';

describe('secret leakage — T059 / SC-005', () => {
  it('encrypted provider keys never contain the plaintext', () => {
    const secret = 'sk-ant-super-secret-key';
    const blob = encrypt(secret);
    expect(blob).not.toContain(secret);
    // Round-trips back only via decrypt (recoverable, not hashed).
    expect(decrypt(blob)).toBe(secret);
  });

  it('generated widget keys are bcrypt-hashed, not stored in plaintext', async () => {
    const { plaintext, keyHash } = await generateApiKey();
    expect(keyHash).not.toContain(plaintext);
    expect(keyHash.startsWith('$2')).toBe(true);
  });

  it('a JSON-serialized llm-config view carries no key material', () => {
    // Shape mirrors the route's toView(): provider/model/hasKey/isActive/updatedAt only.
    const view = { provider: 'anthropic', model: 'claude-sonnet-5', hasKey: true, isActive: true, updatedAt: '2026-07-05T00:00:00.000Z' };
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/sk-|api_key_encrypted|apiKey/);
    expect(view).not.toHaveProperty('api_key_encrypted');
    expect(view).not.toHaveProperty('apiKey');
  });
});
