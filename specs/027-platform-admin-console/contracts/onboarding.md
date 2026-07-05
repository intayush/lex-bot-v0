# Contract: Onboarding wizard

## PUT /api/admin/tenants/[id]/onboarding  (save wizard progress / finish)
Request: `WizardSubmission` (partial allowed while in-progress):
```
WizardSubmission = {
  firmIdentity?: { firmName, chatbotName, greetingMessage, language },
  caseTypes?:   { slug, label, subTypes: {slug,label}[] }[],
  persona?:     { tone: "formal"|"friendly"|"neutral" },
  contact?:     { phone, email, officeHours: {day,open,close}[], afterHoursMessage },
  escalation?:  { triggers: string[], message: string },
  finish?:      boolean
}
```
- 200 (save, `finish` absent/false): `{ onboardingStatus: "draft" }` — progress
  persisted on the draft `configurations` row.
- 200 (finish=true, all required present): `{ onboardingStatus: "draft",
  draftReady: true }` — generates draft `configurations` + runs
  `seedSopForAccount` → `ensureContactStepForAccount` →
  `ensureCarAccidentBranchForAccount` → `ensureDefaultBranchesForAccount`.
- 422 (finish=true, required missing): `{ error, missing: string[] }` (FR-012).
- 400: Zod error.

Required-to-finish: firmIdentity, ≥1 caseType, contact. Audit: `tenant.onboard`.

## POST /api/admin/tenants/[id]/publish
- 200: `{ onboardingStatus: "live" }` — flips `is_published` on the draft
  config + SOP (existing publish path); tenant serves published config.
- 409: `{ error: "No draft ready to publish" }`.
- Audit: `tenant.publish`.
