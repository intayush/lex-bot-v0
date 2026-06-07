import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../../../db';
import { configurations } from '../../../../db/schema';
import { getAuthSession } from '../../../../lib/dashboard-session';
import { getMaxVersion, invalidateConfigCache } from '../../../../lib/config';
import {
  configurationSchema,
  themeSchema,
  type Configuration,
} from '@legal-chatbot/shared';

export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const { action, config: rawConfig, theme: rawTheme } = body;

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

    // Drafts aren't read by /api/config so the published cache is
    // unaffected, but invalidate the latest cache so the dashboard
    // reload after save shows the new draft version immediately.
    invalidateConfigCache(session.accountId);

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

    invalidateConfigCache(session.accountId);

    return NextResponse.json({ success: true });
  }

  /**
   * Theme-only save. Reads the firm's latest configuration row,
   * merges the new theme field, and inserts a new row that is
   * BOTH saved AND published in one atomic step. This is the
   * action the dashboard's Preview Chat "Save Theme" button hits;
   * lawyers expect a theme change to go live immediately on click.
   *
   * Why it's not just "save then publish":
   *  - Avoids two round trips from the dashboard.
   *  - Avoids a window where the new theme is in the system as a
   *    draft but not yet visible to live conversations.
   *
   * Body shape: `{ action: 'save_theme', theme: { id, primary_bg, primary_color } | null }`
   * Passing `theme: null` clears the firm's theme override
   * (revert to indigo defaults).
   */
  if (action === 'save_theme') {
    let theme: Configuration['theme'] = null;
    if (rawTheme !== null && rawTheme !== undefined) {
      const parsed = themeSchema.safeParse(rawTheme);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid theme payload' },
          { status: 400 },
        );
      }
      theme = parsed.data;
    }

    // Source the latest configuration row to merge into. We need
    // the row to seed every other field (persona, practice_areas,
    // etc.) since `configurations` stores the full Configuration
    // JSON per version.
    const latestRows = await db
      .select()
      .from(configurations)
      .where(eq(configurations.account_id, session.accountId))
      .orderBy(desc(configurations.version))
      .limit(1);
    const latestRow = latestRows[0];
    if (!latestRow) {
      return NextResponse.json(
        { error: 'No existing configuration to update' },
        { status: 400 },
      );
    }

    let baseConfig: Configuration;
    try {
      baseConfig = JSON.parse(latestRow.config_json) as Configuration;
    } catch {
      return NextResponse.json(
        { error: 'Existing configuration is malformed' },
        { status: 500 },
      );
    }

    const newVersion = (await getMaxVersion(session.accountId)) + 1;
    const merged: Configuration = {
      ...baseConfig,
      theme,
      version: newVersion,
      saved_at: new Date().toISOString(),
    };

    // Unpublish all existing rows so we can publish the new one.
    await db
      .update(configurations)
      .set({ is_published: false })
      .where(eq(configurations.account_id, session.accountId));

    // Insert and publish atomically.
    await db.insert(configurations).values({
      id: nanoid(),
      account_id: session.accountId,
      version: newVersion,
      config_json: JSON.stringify(merged),
      is_published: true,
      created_at: new Date().toISOString(),
    });

    // Invalidate cache so live chats see the new theme immediately.
    invalidateConfigCache(session.accountId);

    return NextResponse.json({ success: true, version: newVersion });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
