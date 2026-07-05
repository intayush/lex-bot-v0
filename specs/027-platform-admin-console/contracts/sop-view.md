# Contract: Read-only SOP flow visualization

## GET /api/admin/tenants/[id]/sop-view
- 200: `SopFlowView` (read-only; no mutation endpoints exist for this view)
```
SopFlowView = {
  version: number,
  qualifiedLeadThreshold: number,
  steps: {
    position: number, slug: string, questionText: string,
    chipSource: string, appliesWhenSubTypeSlug: string | null,
    isRequired: boolean, countsTowardThreshold: boolean
  }[],
  caseTypes: {
    slug, label,
    subTypes: {
      slug, label,
      branch: {                          // present only if a branch is configured
        questions: { position, text, chips: { label, weight }[] }[]
      } | null
    }[]
  }[]
}
```
- Sourced from the tenant's **published** SOP: `sopSteps`, `caseTypes`,
  `subTypes`, `branches`, `branchVersions` (FR-023).
- Tenant with no configured branches → `branch: null` on every sub-type; default
  step flow still returned, no error (US5 scenario 3).
- No edit controls / no write endpoint (FR-024, US5 scenario 2).
