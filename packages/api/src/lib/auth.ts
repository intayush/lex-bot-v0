import bcrypt from 'bcryptjs';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { DEV_API_KEY } from '@legal-chatbot/shared';

interface AuthResult {
  accountId: string;
  contextStoreUrl: string;
}

export async function verifyApiKey(apiKey: string): Promise<AuthResult | null> {
  const allKeys = await db.select().from(schema.apiKeys);

  for (const row of allKeys) {
    if (row.revoked_at) continue;

    let match = false;
    if (apiKey === DEV_API_KEY) {
      match = await bcrypt.compare(DEV_API_KEY, row.key_hash);
    } else {
      match = await bcrypt.compare(apiKey, row.key_hash);
    }

    if (match) {
      return {
        accountId: row.account_id,
        contextStoreUrl: row.context_store_url,
      };
    }
  }

  return null;
}
