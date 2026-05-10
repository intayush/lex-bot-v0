'use server';

import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '../../../db';
import { configurations } from '../../../db/schema';
import { getAuthSession } from '../../../lib/dashboard-session';
import { getMaxVersion } from '../../../lib/config';
import { configurationSchema, type Configuration } from '@legal-chatbot/shared';

export async function saveConfig(_prev: { error?: string; success?: boolean } | null, formData: FormData) {
  const session = await getAuthSession();
  if (!session.accountId) return { error: 'Not authenticated' };

  const raw = formData.get('config') as string;
  if (!raw) return { error: 'No configuration data provided' };

  let config: Configuration;
  try {
    const parsed = JSON.parse(raw);
    config = configurationSchema.parse(parsed);
  } catch (e: any) {
    // For drafts, allow partial validation — store as-is if JSON is valid
    try {
      config = JSON.parse(raw) as Configuration;
    } catch {
      return { error: `Invalid JSON: ${e.message}` };
    }
  }

  const newVersion = (await getMaxVersion(session.accountId)) + 1;
  config.version = newVersion;
  config.saved_at = new Date().toISOString();

  await db.insert(configurations).values({
    id: nanoid(),
    account_id: session.accountId,
    version: newVersion,
    config_json: JSON.stringify(config),
    is_published: false,
    created_at: new Date().toISOString(),
  });

  revalidatePath('/dashboard/config');
  return { success: true };
}

export async function publishConfig() {
  const session = await getAuthSession();
  if (!session.accountId) return { error: 'Not authenticated' };

  // Unpublish all existing
  await db.update(configurations)
    .set({ is_published: false })
    .where(eq(configurations.account_id, session.accountId));

  // Get latest version and publish it
  const allConfigs = await db
    .select()
    .from(configurations)
    .where(eq(configurations.account_id, session.accountId))
    .orderBy(configurations.version);

  const latest = allConfigs[allConfigs.length - 1];

  if (!latest) return { error: 'No configuration to publish' };

  await db.update(configurations)
    .set({ is_published: true })
    .where(and(eq(configurations.id, latest.id)));

  revalidatePath('/dashboard/config');
  return { success: true };
}
