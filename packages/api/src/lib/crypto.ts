/**
 * 027-platform-admin-console — AES-256-GCM encryption for per-tenant LLM
 * provider API keys (Constitution V/VIII, FR-016).
 *
 * Keys must be RECOVERABLE (replayed to the provider at chat time), so this is
 * encryption, not hashing. Uses Node's built-in `crypto` — no native binary
 * dependency (Constitution IV). Format: `iv:authTag:ciphertext`, all base64.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEncryptionKey } from './env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length

/** Encrypt plaintext → `iv:authTag:ciphertext` (base64 segments). */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** Decrypt an `iv:authTag:ciphertext` blob. Throws on tampering/malformed. */
export function decrypt(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format');
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  if (iv.length !== IV_BYTES) {
    throw new Error('Invalid IV length');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
