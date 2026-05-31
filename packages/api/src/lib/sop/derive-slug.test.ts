/**
 * Tests for deriveSlugFromLabel (014-fix-sop-case-subtypes T007).
 */
import { describe, it, expect } from 'vitest';
import { deriveSlugFromLabel, SlugDerivationError } from './derive-slug';

describe('deriveSlugFromLabel — happy paths', () => {
  it('derives standard two-word label', () => {
    expect(deriveSlugFromLabel('First Offense')).toBe('first_offense');
  });

  it('derives multi-word label', () => {
    expect(deriveSlugFromLabel('DUI with Injury')).toBe('dui_with_injury');
    expect(deriveSlugFromLabel('Workplace Accident')).toBe('workplace_accident');
  });

  it('trims leading/trailing whitespace', () => {
    expect(deriveSlugFromLabel('  Workplace Accident  ')).toBe('workplace_accident');
  });

  it('collapses internal whitespace runs to single underscore', () => {
    expect(deriveSlugFromLabel('First    Offense')).toBe('first_offense');
    expect(deriveSlugFromLabel('First\tOffense')).toBe('first_offense');
  });

  it('replaces punctuation with underscore', () => {
    expect(deriveSlugFromLabel('Slip & Fall')).toBe('slip_fall');
    expect(deriveSlugFromLabel("Driver's License")).toBe('driver_s_license');
    expect(deriveSlugFromLabel('Personal/Injury')).toBe('personal_injury');
  });

  it('folds accented characters to ASCII', () => {
    expect(deriveSlugFromLabel('Café')).toBe('cafe');
    expect(deriveSlugFromLabel("Café d'Été")).toBe('cafe_d_ete');
    expect(deriveSlugFromLabel('Naïve')).toBe('naive');
  });

  it('preserves digits when not leading', () => {
    expect(deriveSlugFromLabel('Section 8 Housing')).toBe('section_8_housing');
    expect(deriveSlugFromLabel('Class A Felony')).toBe('class_a_felony');
  });
});

describe('deriveSlugFromLabel — leading digits stripped', () => {
  it('strips leading digits', () => {
    expect(deriveSlugFromLabel('123 Workplace Accident')).toBe('workplace_accident');
    expect(deriveSlugFromLabel('1st Offense')).toBe('st_offense');
  });
});

describe('deriveSlugFromLabel — error paths', () => {
  it('throws on empty label', () => {
    expect(() => deriveSlugFromLabel('')).toThrow(SlugDerivationError);
  });

  it('throws on whitespace-only label', () => {
    expect(() => deriveSlugFromLabel('   ')).toThrow(SlugDerivationError);
    expect(() => deriveSlugFromLabel('\t\n')).toThrow(SlugDerivationError);
  });

  it('throws when label has no alpha-numeric content', () => {
    expect(() => deriveSlugFromLabel('!!!')).toThrow(SlugDerivationError);
    expect(() => deriveSlugFromLabel('---')).toThrow(SlugDerivationError);
    expect(() => deriveSlugFromLabel('___')).toThrow(SlugDerivationError);
  });

  it('throws when only leading digits remain (no alpha after strip)', () => {
    expect(() => deriveSlugFromLabel('123')).toThrow(SlugDerivationError);
    expect(() => deriveSlugFromLabel('42 9000')).toThrow(SlugDerivationError);
  });

  it('SlugDerivationError carries the original label', () => {
    try {
      deriveSlugFromLabel('!!!');
    } catch (e) {
      expect(e).toBeInstanceOf(SlugDerivationError);
      expect((e as SlugDerivationError).label).toBe('!!!');
    }
  });
});
