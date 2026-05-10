import { db, schema } from '../db';
import { eq, and, desc } from 'drizzle-orm';
import type { Configuration } from '@legal-chatbot/shared';

export async function getPublishedConfig(accountId: string): Promise<Configuration | null> {
  const rows = await db
    .select()
    .from(schema.configurations)
    .where(
      and(
        eq(schema.configurations.account_id, accountId),
        eq(schema.configurations.is_published, true)
      )
    )
    .orderBy(desc(schema.configurations.version))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return JSON.parse(row.config_json) as Configuration;
}

export async function getLatestConfig(accountId: string): Promise<{ id: string; version: number; isPublished: boolean; config: Configuration } | null> {
  const rows = await db
    .select()
    .from(schema.configurations)
    .where(eq(schema.configurations.account_id, accountId))
    .orderBy(desc(schema.configurations.version))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    isPublished: !!row.is_published,
    config: JSON.parse(row.config_json) as Configuration,
  };
}

export async function getMaxVersion(accountId: string): Promise<number> {
  const rows = await db
    .select({ version: schema.configurations.version })
    .from(schema.configurations)
    .where(eq(schema.configurations.account_id, accountId))
    .orderBy(desc(schema.configurations.version))
    .limit(1);

  return rows[0]?.version ?? 0;
}
