/**
 * Tests for the case-types diff helper used by `/api/dashboard/sop/case-types`.
 *
 * The dashboard sends a full case-types list (with nested sub-types) and the
 * route must reconcile against the existing rows for the account:
 *   - Insert new entries (slug not in existing).
 *   - Update existing entries (matching slug; label/position/is_in_scope drift).
 *   - Delete entries not in the incoming list (cascade-delete sub_types).
 *   - Same diff applied per case-type to its sub-types.
 *
 * Pure function: takes existing rows + incoming list, returns a plan
 * `{ caseTypeInserts, caseTypeUpdates, caseTypeDeletes, subTypeInserts, ... }`.
 * The Route Handler turns the plan into Drizzle ops inside a transaction.
 */
import { describe, it, expect } from 'vitest';
import {
  diffCaseTypes,
  type CaseTypeRow,
  type SubTypeRow,
  type CaseTypeIncoming,
} from './case-types-diff';

const existingCaseType = (overrides: Partial<CaseTypeRow> = {}): CaseTypeRow => ({
  id: 'ct_existing',
  slug: 'dui',
  label: 'DUI',
  position: 1,
  is_in_scope: true,
  ...overrides,
});

const existingSubType = (overrides: Partial<SubTypeRow> = {}): SubTypeRow => ({
  id: 'st_existing',
  case_type_id: 'ct_existing',
  slug: 'first_offense',
  label: 'First Offense',
  position: 1,
  ...overrides,
});

const incomingCaseType = (overrides: Partial<CaseTypeIncoming> = {}): CaseTypeIncoming => ({
  slug: 'dui',
  label: 'DUI',
  position: 1,
  is_in_scope: true,
  sub_types: [],
  ...overrides,
});

describe('diffCaseTypes', () => {
  it('inserts when no existing case-types', () => {
    const plan = diffCaseTypes({
      existing: [],
      existingSubTypes: [],
      incoming: [incomingCaseType({ slug: 'dui' })],
    });
    expect(plan.caseTypeInserts).toHaveLength(1);
    expect(plan.caseTypeInserts[0]?.slug).toBe('dui');
    expect(plan.caseTypeUpdates).toHaveLength(0);
    expect(plan.caseTypeDeletes).toHaveLength(0);
  });

  it('updates when an existing case-type slug matches', () => {
    const existing = [existingCaseType({ id: 'ct_1', slug: 'dui', label: 'DUI', position: 1, is_in_scope: true })];
    const plan = diffCaseTypes({
      existing,
      existingSubTypes: [],
      incoming: [incomingCaseType({ slug: 'dui', label: 'DUI Cases', position: 1, is_in_scope: true })],
    });
    expect(plan.caseTypeUpdates).toHaveLength(1);
    expect(plan.caseTypeUpdates[0]?.id).toBe('ct_1');
    expect(plan.caseTypeUpdates[0]?.label).toBe('DUI Cases');
    expect(plan.caseTypeInserts).toHaveLength(0);
    expect(plan.caseTypeDeletes).toHaveLength(0);
  });

  it('skips no-op updates (label/position/is_in_scope unchanged)', () => {
    const existing = [existingCaseType({ id: 'ct_1', slug: 'dui', label: 'DUI', position: 1, is_in_scope: true })];
    const plan = diffCaseTypes({
      existing,
      existingSubTypes: [],
      incoming: [incomingCaseType({ slug: 'dui', label: 'DUI', position: 1, is_in_scope: true })],
    });
    expect(plan.caseTypeUpdates).toHaveLength(0);
  });

  it('deletes when an existing slug is missing from incoming', () => {
    const existing = [
      existingCaseType({ id: 'ct_1', slug: 'dui' }),
      existingCaseType({ id: 'ct_2', slug: 'family_law', label: 'Family Law' }),
    ];
    const plan = diffCaseTypes({
      existing,
      existingSubTypes: [],
      incoming: [incomingCaseType({ slug: 'dui' })],
    });
    expect(plan.caseTypeDeletes).toHaveLength(1);
    expect(plan.caseTypeDeletes[0]?.id).toBe('ct_2');
  });

  it('handles mixed inserts/updates/deletes in one diff', () => {
    const existing = [
      existingCaseType({ id: 'ct_keep', slug: 'dui', position: 1 }),
      existingCaseType({ id: 'ct_drop', slug: 'family_law', position: 2 }),
    ];
    const plan = diffCaseTypes({
      existing,
      existingSubTypes: [],
      incoming: [
        incomingCaseType({ slug: 'dui', label: 'DUI Updated', position: 1 }),
        incomingCaseType({ slug: 'criminal_defense', label: 'Criminal Defense', position: 2 }),
      ],
    });
    expect(plan.caseTypeInserts).toHaveLength(1);
    expect(plan.caseTypeInserts[0]?.slug).toBe('criminal_defense');
    expect(plan.caseTypeUpdates).toHaveLength(1);
    expect(plan.caseTypeUpdates[0]?.id).toBe('ct_keep');
    expect(plan.caseTypeUpdates[0]?.label).toBe('DUI Updated');
    expect(plan.caseTypeDeletes).toHaveLength(1);
    expect(plan.caseTypeDeletes[0]?.id).toBe('ct_drop');
  });

  it('inserts sub-types under a newly-inserted case-type', () => {
    const plan = diffCaseTypes({
      existing: [],
      existingSubTypes: [],
      incoming: [
        incomingCaseType({
          slug: 'dui',
          sub_types: [
            { slug: 'first_offense', label: 'First Offense', position: 1 },
            { slug: 'repeat', label: 'Repeat', position: 2 },
          ],
        }),
      ],
    });
    // The sub-type inserts are tagged with parent_slug because the parent
    // case-type id won't exist until the transaction inserts it.
    expect(plan.subTypeInsertsForNewParents).toHaveLength(2);
    expect(plan.subTypeInsertsForNewParents[0]?.parent_slug).toBe('dui');
    expect(plan.subTypeInsertsForNewParents[0]?.slug).toBe('first_offense');
  });

  it('inserts/updates/deletes sub-types under an existing case-type', () => {
    const existing = [existingCaseType({ id: 'ct_dui', slug: 'dui' })];
    const existingSubTypes: SubTypeRow[] = [
      existingSubType({ id: 'st_keep', case_type_id: 'ct_dui', slug: 'first_offense', label: 'First Offense', position: 1 }),
      existingSubType({ id: 'st_drop', case_type_id: 'ct_dui', slug: 'old_one', label: 'Old', position: 2 }),
    ];
    const plan = diffCaseTypes({
      existing,
      existingSubTypes,
      incoming: [
        incomingCaseType({
          slug: 'dui',
          sub_types: [
            { slug: 'first_offense', label: 'First Offense Renamed', position: 1 },
            { slug: 'repeat', label: 'Repeat', position: 2 },
          ],
        }),
      ],
    });
    // Update the renamed one.
    expect(plan.subTypeUpdates).toHaveLength(1);
    expect(plan.subTypeUpdates[0]?.id).toBe('st_keep');
    expect(plan.subTypeUpdates[0]?.label).toBe('First Offense Renamed');
    // Insert the new one under existing ct_dui.
    expect(plan.subTypeInsertsForExistingParents).toHaveLength(1);
    expect(plan.subTypeInsertsForExistingParents[0]?.case_type_id).toBe('ct_dui');
    expect(plan.subTypeInsertsForExistingParents[0]?.slug).toBe('repeat');
    // Delete the missing one.
    expect(plan.subTypeDeletes).toHaveLength(1);
    expect(plan.subTypeDeletes[0]?.id).toBe('st_drop');
  });

  it('deletes all sub-types under a case-type that is being deleted', () => {
    const existing = [existingCaseType({ id: 'ct_drop', slug: 'family_law' })];
    const existingSubTypes: SubTypeRow[] = [
      existingSubType({ id: 'st_a', case_type_id: 'ct_drop', slug: 'divorce' }),
      existingSubType({ id: 'st_b', case_type_id: 'ct_drop', slug: 'custody' }),
    ];
    const plan = diffCaseTypes({
      existing,
      existingSubTypes,
      incoming: [],
    });
    expect(plan.caseTypeDeletes).toHaveLength(1);
    expect(plan.subTypeDeletes).toHaveLength(2);
  });

  it('rejects duplicate slugs in incoming case-types', () => {
    const result = () =>
      diffCaseTypes({
        existing: [],
        existingSubTypes: [],
        incoming: [
          incomingCaseType({ slug: 'dui' }),
          incomingCaseType({ slug: 'dui' }),
        ],
      });
    expect(result).toThrow(/duplicate.*slug/i);
  });

  it('rejects duplicate sub-type slugs within a case-type', () => {
    const result = () =>
      diffCaseTypes({
        existing: [],
        existingSubTypes: [],
        incoming: [
          incomingCaseType({
            slug: 'dui',
            sub_types: [
              { slug: 'first_offense', label: 'A', position: 1 },
              { slug: 'first_offense', label: 'B', position: 2 },
            ],
          }),
        ],
      });
    expect(result).toThrow(/duplicate.*sub.*slug/i);
  });

  it('allows same sub-type slug across different case-types', () => {
    // Sub-type slugs are only unique-per-case-type; two different case
    // types can both have 'theft' for example.
    const plan = diffCaseTypes({
      existing: [],
      existingSubTypes: [],
      incoming: [
        incomingCaseType({
          slug: 'criminal_defense',
          sub_types: [{ slug: 'theft', label: 'Theft', position: 1 }],
        }),
        incomingCaseType({
          slug: 'civil',
          sub_types: [{ slug: 'theft', label: 'Civil Theft', position: 1 }],
        }),
      ],
    });
    expect(plan.subTypeInsertsForNewParents).toHaveLength(2);
  });
});
