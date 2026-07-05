vi.mock('../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../db/test-schema.js');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});
vi.mock('../db/schema.js', async () => await import('../db/test-schema.js'));

import { describe, it, expect, beforeEach } from 'vitest';
import { createAttorney, getAttorneysForSubType } from './attorneys.js';
import { db, schema } from '../db/index.js';

const { __sqlite: sqlite } = (await import('../db/index.js')) as unknown as { __sqlite: import('better-sqlite3').Database };

const MIGRATION_SQL = `
CREATE TABLE accounts (id text PRIMARY KEY, email text NOT NULL, password_hash text NOT NULL, firm_name text, created_at text NOT NULL, status text DEFAULT 'active' NOT NULL, onboarding_status text DEFAULT 'live' NOT NULL, deleted_at text, domain text, onboarding_draft_json text);
CREATE TABLE attorneys (id text PRIMARY KEY, account_id text NOT NULL, name text NOT NULL, email text NOT NULL, mobile text, created_at text NOT NULL, updated_at text NOT NULL);
CREATE TABLE attorney_case_type_assignments (id text PRIMARY KEY, attorney_id text NOT NULL, account_id text NOT NULL, case_type_slug text NOT NULL, sub_type_slug text, created_at text NOT NULL);
`;

beforeEach(() => {
  sqlite.exec(`DROP TABLE IF EXISTS attorney_case_type_assignments`);
  sqlite.exec(`DROP TABLE IF EXISTS attorneys`);
  sqlite.exec(`DROP TABLE IF EXISTS accounts`);
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
  sqlite.exec(`INSERT INTO accounts (id,email,password_hash,firm_name,created_at) VALUES ('a1','x@y.com','h','F','2026-07-05T00:00:00.000Z')`);
});

describe('sub-type attorney assignment', () => {
  it('routes to sub-type-assigned attorney', async () => {
    await createAttorney('a1', { name: 'Sub Lawyer', email: 's@f.com', assignments: [{ caseTypeSlug: 'personal_injury', subTypeSlug: 'car_accident' }] });
    const found = await getAttorneysForSubType('a1', 'personal_injury', 'car_accident');
    expect(found.map((a) => a.name)).toEqual(['Sub Lawyer']);
  });

  it('falls back to case-type-assigned attorney when no sub-type match', async () => {
    await createAttorney('a1', { name: 'Case Lawyer', email: 'c@f.com', assignments: [{ caseTypeSlug: 'personal_injury', subTypeSlug: null }] });
    const found = await getAttorneysForSubType('a1', 'personal_injury', 'slip_fall');
    expect(found.map((a) => a.name)).toEqual(['Case Lawyer']);
  });
});
