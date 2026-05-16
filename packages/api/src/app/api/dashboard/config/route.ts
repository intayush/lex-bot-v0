import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db } from '../../../../db';
import { configurations } from '../../../../db/schema';
import { getAuthSession } from '../../../../lib/dashboard-session';
import { getMaxVersion } from '../../../../lib/config';
import { configurationSchema, type Configuration } from '@legal-chatbot/shared';

export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const { action, config: rawConfig } = body;

  if (action === 'save') {
    if (!rawConfig) {
      return NextResponse.json({ error: 'No configuration data provided' }, { status: 400 });
    }

    let config: Configuration;
    try {
      config = configurationSchema.parse(rawConfig);
    } catch {
      // For drafts, allow partial validation — store as-is if valid object
      config = rawConfig as Configuration;
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

    return NextResponse.json({ success: true });
  }

  if (action === 'publish') {
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

    if (!latest) {
      return NextResponse.json({ error: 'No configuration to publish' }, { status: 400 });
    }

    await db.update(configurations)
      .set({ is_published: true })
      .where(and(eq(configurations.id, latest.id)));

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
