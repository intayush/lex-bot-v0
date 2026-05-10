import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const db = drizzle(sql);

const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');

await migrate(db, { migrationsFolder });
console.log('Migrations complete.');
