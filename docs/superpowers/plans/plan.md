Proposed Phased Plan
Phase A: Fix Crawler Quality (items 5, 6, 13)
Fix the section_type classification bug and make output deterministic. These are prerequisites -- broken section types cascade into broken search scoring.
- Fix title-hint ordering in section-type.ts (the attorney pattern matches before content-specific patterns)
- Make crawled_at/generated_at deterministic for same input (use content-derived or fixed timestamps in test mode)
- Re-crawl to produce correct section_type values in the manifest
  Manual testing: Run crawler against test-site/, verify section types are correct, run twice and diff output.
  Phase B: Align Test Data (items 7, 8, 9)
  The spec's acceptance criteria assume Smith & Associates content. The actual data is Shrager Defense. Two options:
1. Update acceptance criteria to match Shrager data (e.g., "DUI defense" instead of "personal injury")
2. Create Smith & Associates mock content as specified in Section 12.4
   I'd recommend option 1 -- the Shrager data is real-world and more valuable for testing. The spec criteria were illustrative, not prescriptive.
   Manual testing: Run test-search.ts with updated queries, verify top results match expectations.
   Phase C: Add Test Infrastructure + Unit Tests (items 1, 2, 3, 4)
   Set up Vitest across the monorepo, then write tests for all phases.
- Install vitest, configure for each package
- Phase 1 tests: markdown conversion, content extraction, frontmatter generation
- Phase 2 tests: scoring algorithm, threshold filtering, token budgeting
- Phase 3 tests: streaming, tool calling, context injection (may need mocking for Gemini)
- Phase 5 tests: lead capture, classification, DB writes
  Manual testing: pnpm test passes across all packages.
  Phase D: Feature Gaps (items 10, 11, 12)
- Abandoned session handling (partial lead data)
- Quick-reply chips loaded from config
- Lead capture threshold (optional -- may be acceptable as LLM-decided)
  Manual testing: Abandon a conversation mid-intake, verify partial lead in DB. Check quick replies match configured practice areas.