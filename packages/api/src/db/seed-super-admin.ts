/**
 * 027-platform-admin-console — seed a development super-admin.
 *
 * Idempotent: no-op if a super-admin with the given email already exists.
 * Run: `pnpm --filter @legal-chatbot/api db:seed-super-admin`
 *
 * Credentials come from env (ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD) or fall
 * back to dev defaults. NEVER use the dev defaults in production.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const db = drizzle(sql, { schema });

export async function seedSuperAdmin(
  email = process.env.ADMIN_SEED_EMAIL ?? 'admin@lexbot.dev',
  password = process.env.ADMIN_SEED_PASSWORD ?? 'admin-dev-password',
): Promise<void> {
  const existing = await db
    .select()
    .from(schema.superAdmins)
    .where(eq(schema.superAdmins.email, email));
  if (existing.length > 0) {
    console.log(`[seed-super-admin] ${email} already exists — skipping.`);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await db.insert(schema.superAdmins).values({
    id: nanoid(),
    email,
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
  });
  console.log(`[seed-super-admin] created super-admin ${email}.`);
}

// Run when invoked directly.
seedSuperAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-super-admin] failed:', err);
    process.exit(1);
  });
