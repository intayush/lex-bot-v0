# Research: Remove Practice Areas — Consolidate on Case Types (019)

**Branch**: `019-remove-practice-areas`
**Date**: 2026-06-20
**Source spec**: `specs/019-remove-practice-areas/spec.md`

---

## R1 — Full inventory of `practice_areas` read/write sites

**Decision**: The following files read or write `practice_areas` and must be touched by this feature:

| File | Role | Change needed |
|------|------|---------------|
| `packages/shared/src/schemas/configuration.ts` | Defines `practiceAreasSchema` and includes it in `configurationSchema` | Make `practice_areas` optional; add top-level `out_of_scope_response` field |
| `packages/api/src/app/dashboard/config/config-form.tsx` | Renders the Practice Areas tab, writes `config.practice_areas` | Remove `PracticeAreasSection` component; add standalone Out-of-scope field; remove tab from tabs array |
| `packages/api/src/app/api/dashboard/config/route.ts` | Reads `configurationSchema.parse(rawConfig)` | No direct change needed — the schema change makes `practice_areas` optional; existing saves keep working |
| `packages/api/src/app/api/config/route.ts` | Returns `practice_areas: [...active, ...custom]` + `case_types[]` | Replace `practice_areas` key with `in_scope_case_types` derived from `case_types` |
| `packages/api/src/lib/system-prompt.ts` | `computeInScopeAreas()` fallback reads `config.practice_areas.active + custom`; `out_of_scope_response` read from `config.practice_areas.out_of_scope_response` | Remove legacy fallback in `computeInScopeAreas`; update `out_of_scope_response` read path |
| `packages/api/src/lib/system-prompt.test.ts` | Tests the legacy fallback and `out_of_scope_response` path | Update test fixtures; remove legacy fallback test; update out-of-scope response test |
| `packages/api/src/db/seed.ts` | Seeds `practice_areas` sub-object | Update to write `out_of_scope_response` at top level; keep `practice_areas` dummy for schema compat |
| `packages/widget/src/components/ChatPanel.tsx` | `WidgetConfig.practice_areas: string[]` prop; passes to `<QuickReplies>` | Rename prop to `in_scope_case_types`; update all usages |
| `packages/widget/src/components/ChatWidget.tsx` | Fetches `/api/config` and stores response in `WidgetConfig` state | Update type to use `in_scope_case_types` |
| `packages/widget/src/components/ChatPanel.test.tsx` | Test fixtures use `practice_areas: []` (5 locations) | Rename all to `in_scope_case_types` |
| `packages/widget/src/components/ChatWidget.test.tsx` | Test fixture uses `practice_areas: []` | Rename to `in_scope_case_types` |
| `packages/widget/src/components/QuickReplies.test.tsx` | Comment says "firm with no practice_areas" | Update comment only |

**Rationale**: Complete inventory prevents silent runtime breaks from stale field reads.

---

## R2 — Configuration schema migration strategy

**Decision**: Two-phase schema change with read-time migration.

**Phase A — Schema change in `configuration.ts`**:
- Remove `practice_areas` from the required fields in `configurationSchema`; make it `z.object({...}).optional()` so old stored rows still parse without error.
- Add `out_of_scope_response: z.string().default('')` as a top-level field on `configurationSchema` (or within `guardrails` group — research below picks top-level for simplicity).
- `practiceAreasSchema` itself can be kept as a type export for reference but should not be imported in new code.

**Phase B — Read-time migration**:
- In the configuration loading utility (`packages/api/src/lib/config.ts`) — or wherever the JSON is parsed from the DB — apply a migration shim: if the parsed config has no top-level `out_of_scope_response` (or it is empty/undefined) AND `practice_areas.out_of_scope_response` is non-empty, copy the nested value to the top level before returning.
- This shim ensures existing accounts seamlessly continue to show their deflection text in the system prompt after deploy, without any DB migration.

**No database migration script needed**: `configurations.config_json` is a plain text column. The Zod schema parses it; making `practice_areas` optional means old rows with the key still parse. New rows written by the updated form will have `out_of_scope_response` at the top level and no `practice_areas` key.

**Alternatives considered**:
- One-time DB migration script to rewrite all `config_json` rows: rejected — introduces irreversible DB writes with no rollback, more risk than the read-time shim.
- Keep `out_of_scope_response` nested inside `practice_areas` but just stop rendering the rest of the section: rejected — the field would still be coupled to the `practice_areas` object, which must validate with `active: z.array(z.string()).min(1)`. That constraint would fail on new saves that omit the practice_areas object.

---

## R3 — Where to place `out_of_scope_response` on the Configuration page

**Decision**: Add it to the **Guardrails / Boundaries tab** as a new standalone field at the bottom of the existing "Never Say Rules" section — OR add it as a standalone section between Boundaries and Escalation.

**Rationale**: The out-of-scope response is a deflection behavior, conceptually adjacent to "what the bot never does." Placing it in Boundaries is the most natural home without adding a new tab. The existing tab order is: Persona | Questions | Boundaries | Escalation | Contact | Custom. The "Practice Areas" tab (tab index 1) is removed; the remaining tabs shift down by one.

**Alternatives considered**:
- A new top-level "Out-of-Scope" tab: adds a tab for a single text field, over-engineering.
- Keep it in its own section at the bottom of Persona tab: unrelated to persona configuration.
- New "Guardrails" tab: spec 008 planned but not implemented; deferred.

---

## R4 — `/api/config` field rename: `practice_areas` → `in_scope_case_types`

**Decision**: Rename the field. The rename is in scope per the spec (clarification Q1 answer: B). All widget consumers in the repo are updated as part of this feature.

**Implementation**:
- `packages/api/src/app/api/config/route.ts`: replace `practice_areas: [...config.practice_areas.active, ...]` with `in_scope_case_types: caseTypes.filter(ct => ct.is_in_scope).sort((a,b) => a.position - b.position).map(ct => ct.label)`.
- `packages/widget/src/components/ChatPanel.tsx`: rename `WidgetConfig.practice_areas` to `in_scope_case_types`.
- `packages/widget/src/components/ChatWidget.tsx`: update `WidgetConfig` type and the fetch handler.
- All widget test fixtures: rename the key.

**Risk note**: Any CDN-pinned or NPM-published widget version prior to this feature will receive `undefined` for `in_scope_case_types`. The `QuickReplies` component receives `undefined` where it previously received `[]`. The existing null/empty guard in `QuickReplies.tsx` (line 11) already handles this case gracefully — it returns `null` (no chips rendered) when the array is empty. `undefined` will be handled the same way as `[]` once we add a `?? []` default. This is an acceptable breaking change per the spec.

---

## R5 — `computeInScopeAreas` simplification

**Decision**: Remove the entire `computeInScopeAreas` function and inline the case-types-only path directly in `composeSystemPrompt`.

**Current code** (`system-prompt.ts:161-180`):
```
function computeInScopeAreas(config, sopActive, caseTypes) {
  if (sopActive && caseTypes && caseTypes.length > 0) {
    const inScope = caseTypes.filter(ct => ct.is_in_scope)...
    if (inScope.length > 0) return inScope;
  }
  return [...config.practice_areas.active, ...config.practice_areas.custom...];
}
```

**New code** (inline in `composeSystemPrompt`):
```
const inScopeAreas = (caseTypes ?? [])
  .filter(ct => ct.is_in_scope)
  .sort((a, b) => a.position - b.position)
  .map(ct => ct.label);
```

The `sopActive` guard is no longer needed — case types are always the source of truth. The `config` parameter to `composeSystemPrompt` no longer needs `practice_areas` for the in-scope list, only for `out_of_scope_response` (which moves to the top-level field).

**Alternatives considered**: Keep the function with the fallback removed — would still be a one-liner wrapper with no reason to exist. Inline is cleaner.

---

## R6 — `out_of_scope_response` in `composeSystemPrompt`

**Decision**: Change `config.practice_areas.out_of_scope_response` to `config.out_of_scope_response` (the promoted field) in `system-prompt.ts:63`. The read-time migration (R2) ensures this field is populated for old accounts.

**Impact**: `composeSystemPrompt` signature unchanged; it still receives `config: Configuration`. TypeScript will guide the rename automatically once the schema is updated.

---

## R7 — Dashboard config-form tab restructuring

**Decision**: Remove the "Practice Areas" tab entirely (was tab index 1). Add a standalone "Out-of-Scope Response" textarea field to the **Boundaries tab**. Update the `tabs` array and tab-index routing in `config-form.tsx`.

**New tab order**: Persona (0) | Questions (1) | Boundaries (2) | Escalation (3) | Contact (4) | Custom (5).

The `BoundariesSection` component gains a new textarea at the bottom: "Out-of-Scope Response" reading from/writing to `config.out_of_scope_response` (not `config.practice_areas.out_of_scope_response`).

**`defaultConfig` in `config-form.tsx`**: Remove `practice_areas` from the default state object; add `out_of_scope_response: ''`.

---

## R8 — Seed data update

**Decision**: Update `packages/api/src/db/seed.ts` to write `out_of_scope_response` at the config top level instead of inside `practice_areas`. The existing long deflection text can be preserved in the new location. The `practice_areas` key can be omitted from the seed entirely (the schema now accepts configs without it).

**Caveat**: The comment in `seed.ts` that explains the alignment between `practice_areas.active` and `case_types` should be removed or updated to note that greeting chips now come from `case_types` directly.

---

## R9 — Test surface summary

Files requiring test changes:

| File | Changes |
|------|---------|
| `packages/api/src/lib/system-prompt.test.ts` | Remove legacy fallback test ("SOP path with empty case_types falls back to legacy practice_areas"); update `out_of_scope_response` fixture path; update "legacy path" test fixture to omit `practice_areas` |
| `packages/widget/src/components/ChatPanel.test.tsx` | Rename `practice_areas` → `in_scope_case_types` in 5 fixture objects |
| `packages/widget/src/components/ChatWidget.test.tsx` | Rename `practice_areas` → `in_scope_case_types` in 1 fixture |
| `packages/widget/src/components/QuickReplies.test.tsx` | Update comment text only |
