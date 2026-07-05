/**
 * Client-safe copy of the default case-type/sub-type matrix used by the
 * onboarding wizard. Slugs/labels MUST match the server DEFAULT_CASE_TYPES in
 * packages/api/src/db/seed-defaults/sop.ts (kept in sync by the parity test in
 * packages/api).
 */
export interface MatrixSubType { slug: string; label: string; position: number }
export interface MatrixCaseType { slug: string; label: string; position: number; subTypes: readonly MatrixSubType[] }

export const DEFAULT_CASE_TYPE_MATRIX: readonly MatrixCaseType[] = [
  { slug: 'dui', label: 'DUI', position: 1, subTypes: [
    { slug: 'first_offense', label: 'First Offense', position: 1 },
    { slug: 'repeat_offense', label: 'Repeat Offense', position: 2 },
    { slug: 'dui_with_injury', label: 'DUI with Injury', position: 3 },
    { slug: 'dui_with_property', label: 'DUI with Property Damage', position: 4 },
  ] },
  { slug: 'criminal_defense', label: 'Criminal Defense', position: 2, subTypes: [
    { slug: 'theft', label: 'Theft', position: 1 },
    { slug: 'assault', label: 'Assault', position: 2 },
    { slug: 'fraud', label: 'Fraud', position: 3 },
    { slug: 'gun_charge', label: 'Gun Charge', position: 4 },
  ] },
  { slug: 'personal_injury', label: 'Personal Injury', position: 3, subTypes: [
    { slug: 'car_accident', label: 'Car Accident', position: 1 },
    { slug: 'slip_fall', label: 'Slip and Fall', position: 2 },
    { slug: 'medical_malpractice', label: 'Medical Malpractice', position: 3 },
    { slug: 'dog_bite', label: 'Dog Bite', position: 4 },
  ] },
  { slug: 'family_law', label: 'Family Law', position: 4, subTypes: [
    { slug: 'divorce', label: 'Divorce', position: 1 },
    { slug: 'custody', label: 'Custody', position: 2 },
    { slug: 'adoption', label: 'Adoption', position: 3 },
  ] },
  { slug: 'drug_crime', label: 'Drug Crime', position: 5, subTypes: [
    { slug: 'possession', label: 'Possession', position: 1 },
    { slug: 'distribution', label: 'Distribution', position: 2 },
    { slug: 'trafficking', label: 'Trafficking', position: 3 },
  ] },
  { slug: 'estate_planning', label: 'Estate Planning', position: 6, subTypes: [
    { slug: 'will', label: 'Will', position: 1 },
    { slug: 'trust', label: 'Trust', position: 2 },
    { slug: 'probate', label: 'Probate', position: 3 },
  ] },
];
