import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import path from 'path';

import { runMultiBranchSopDataMigration } from './migrations/0004-multi-branch-sop';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const db = drizzle(sql);

const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');

await migrate(db, { migrationsFolder });
console.log('Drizzle migrations complete.');

// Spec 016 — Multi-Branch SOP data migration (Phase B of 0004).
// Idempotent: re-running is a no-op once branches exist.
const results = await runMultiBranchSopDataMigration({
  // Type-cast: the shared migration helper is typed against the
  // production `db` instance; here we pass the same instance.
  db: db as unknown as typeof import('./index').db,
});
const inserted = results.filter((r) => r.outcome === 'inserted').length;
const skipped = results.filter((r) => r.outcome === 'skipped_already_present').length;
console.log(
  `Multi-branch SOP data migration: ${inserted} inserted, ${skipped} skipped (already present).`,
);
console.log('Migrations complete.');
