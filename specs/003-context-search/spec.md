# Feature Specification: Context Search

**Feature Branch**: `003-context-search`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "Extract the functional requirements for Context Search from 'product-spec-legal-chatbot.md'. Generate the isolated feature specification file. Do not invent new requirements; stick strictly to what is outlined in the document."

**Source of Truth**: All requirements in this document are extracted verbatim or paraphrased without addition from `product-spec-legal-chatbot.md` (v0.2, 2026-05-16). Primary sources: §7.3 (Tool: Context Search), §7.6 (Search Strategy), §7.7 (Context Window Management), §7.11 (Fallback Behavior). Supporting sources: §5.2 (Location & Accessibility), §5.5 (Manifest schema this consumes), §5.6 (Markdown as Universal Format), §5.7 (File Size Constraints), §5.8 (Naming Conventions), §12.7 (Phase 2 Deliverable + done-when). Each functional requirement cites its source section. No requirements have been invented.

## Overview

Context Search is a standalone module that takes a natural-language query and returns the relevant context from the markdown files produced by the Crawler (§12.7). It is the intelligence layer that connects user queries to firm-specific knowledge; it is *not* the LLM, *not* the chat API, and *not* the agent. It is the deterministic retrieval engine those layers consume.

Per §7.3 the surface visible to the agent is a single tool, `searchContext(query, sectionTypes?)`, which returns the assembled context (the contents of the top-N most relevant markdown files) for injection into the LLM's prompt. Per §7.6 retrieval is a two-pass algorithm: a fast manifest scan that scores every file, then a targeted fetch of the highest-scoring files. Per §7.7 the assembled context is bounded by a strict token budget.

This is Phase 2 per §12.5. It depends on the Crawler's manifest format (§5.5) and feeds the Chat API (§12.8).

## User Scenarios & Testing *(mandatory)*

The "users" of Context Search are:

1. **The agent runtime (LLM tool caller)** — calls `searchContext` during a conversation and consumes the returned context.
2. **A Lex Bot engineer** — invokes the search standalone (e.g., via the test script `scripts/test-search.ts` per §12.7 deliverable) to verify the retrieval engine in isolation, debug query handling, or measure scoring on fixtures.

### User Story 1 — Agent Retrieves Relevant Pages for a User Query (Priority: P1)

When the chatbot receives a user question (e.g., "I was in a car accident"), the agent calls `searchContext` with a query string. The module loads the manifest, scores every indexed page against the query using a weighted formula, filters out files below the relevance threshold, fetches the contents of the top 3–5 scoring files, assembles them within the token budget, and returns the assembled context to the agent.

**Why this priority**: §7.3 names this as the agent's primary tool for retrieving firm information to "answer user questions accurately." §7.1 names the search layer as where "the chatbot's 'thinking' happens." Without it, the agent has no firm-grounded data and is forced into pure-LLM hallucination, which §7.11 explicitly forbids.

**Independent Test**: Run the standalone test script per §12.7 against the seeded Shrager Defense Attorneys context — `npx tsx scripts/test-search.ts "I was in a car accident"` — and verify that the personal-injury practice-area markdown is returned with a relevance score visible to the caller.

**Acceptance Scenarios**:

1. **Given** a manifest with multiple practice-area files, **When** the agent calls `searchContext` with `query: "personal injury"`, **Then** the personal-injury practice-area file is returned as the top result (§12.7 done-when).
2. **Given** a manifest with attorney-bio files, **When** the agent calls `searchContext` with `query: "John Smith"`, **Then** the attorney-bio file for John Smith is returned (§12.7 done-when).
3. **Given** a manifest with family-law content, **When** the agent calls `searchContext` with `query: "divorce"`, **Then** the family-law practice-area file is returned (§12.7 done-when).
4. **Given** a manifest with no tax-law content, **When** the agent calls `searchContext` with `query: "tax law"`, **Then** no results are returned because all candidates score below the relevance threshold (§7.6, §12.7 done-when).
5. **Given** a query for which several pages match, **When** `searchContext` returns context, **Then** the assembled context never exceeds the total token budget defined in §7.7 (§12.7 done-when).

---

### User Story 2 — Agent Filters by Section Type (Priority: P2)

When the agent already knows the kind of page the user is asking about (for example, the user asks for an attorney by name), the agent passes a `sectionTypes` filter. The search applies the section-type bonus to candidates of those types and biases the ranking accordingly.

**Why this priority**: §7.3 defines `sectionTypes` as an optional filter parameter on the tool. §7.6 defines `section_type_bonus = 1.0 if the agent explicitly filtered by section type and this file matches; 0.5 if section type is contextually relevant; 0.0 otherwise`. The capability exists in the spec; it is not the primary flow but is required for precision-sensitive queries.

**Independent Test**: With a manifest containing both an attorney bio and a practice-area page that both mention an attorney's name, call `searchContext({ query: "John Smith", sectionTypes: ["attorney-bio"] })` and verify that the bio file ranks above the practice-area file.

**Acceptance Scenarios**:

1. **Given** an explicit `sectionTypes` filter, **When** a candidate file's section type matches a filter value, **Then** it receives the full section-type bonus of 1.0 (§7.6 scoring table).
2. **Given** no explicit filter but a query that contextually implies a section type (e.g., a query mentioning an attorney name), **When** scoring, **Then** the relevant section type receives a partial bonus of 0.5 (§7.6 scoring table).
3. **Given** a candidate with no matching section type and no contextual signal, **When** scoring, **Then** the section-type bonus contribution is 0.0 (§7.6 scoring table).

---

### User Story 3 — Agent Receives Empty Result and Falls Back Gracefully (Priority: P1)

When no manifest entry exceeds the relevance threshold for a query, the search returns an empty result. The agent then issues the §7.11 fallback response ("I don't have specific information about that on our website. Would you like me to connect you with our team directly?") rather than hallucinating an answer.

**Why this priority**: §7.11 explicitly requires the chatbot to "never fabricate information" and to "acknowledge the gap" when no context is found. §7.6 explicitly says "If no files exceed this threshold, the search returns empty (triggers fallback behavior)." This is a non-negotiable safety property.

**Independent Test**: Issue a query for content guaranteed to not be in the manifest (e.g., "tax law" against the Shrager Defense Attorneys context), verify the search returns empty, and verify the agent's response is the §7.11 fallback string.

**Acceptance Scenarios**:

1. **Given** a query for which no candidate scores ≥ 0.15, **When** `searchContext` is called, **Then** it returns an empty result (§7.6 relevance threshold paragraph).
2. **Given** an empty search result, **When** the agent composes its response, **Then** it produces the §7.11 "no relevant context files found" fallback message rather than fabricating information (§7.11).

---

### User Story 4 — Repeated Queries in the Same Session Are Fast (Priority: P2)

When the same chat session issues multiple queries in quick succession, manifest fetches and recently fetched markdown files are served from an in-memory cache rather than re-fetched over HTTPS from the lawyer's server.

**Why this priority**: §5.2 defines this caching as a latency-sensitive requirement: "the API server caches the `_manifest.json` and recently fetched markdown files in memory (TTL: 5 minutes)." Without it, every chat message would incur a network round-trip to the lawyer's server. With it, "the API server does not make a network request to the lawyer's server on every chat message — only on cache misses or when context for a new topic is needed."

**Independent Test**: Issue two consecutive `searchContext` calls in the same session within the cache TTL and observe (via instrumentation or test stubs) that the second call does not re-fetch the manifest from HTTPS.

**Acceptance Scenarios**:

1. **Given** the manifest has been fetched within the last 5 minutes, **When** `searchContext` runs again, **Then** the manifest is read from the in-memory cache rather than re-fetched (§5.2).
2. **Given** a markdown file has been fetched within the last 5 minutes, **When** the same file is needed by another `searchContext` call, **Then** it is read from the in-memory cache rather than re-fetched (§5.2).
3. **Given** the cache TTL has elapsed, **When** the next `searchContext` call needs the manifest or a previously cached file, **Then** the value is re-fetched from the context store and the cache is refreshed (§5.2 implicit consequence of TTL).

---

### Edge Cases

- **Query for a topic outside all firm practice areas**: §7.11 distinguishes "no relevant context files found" (the search-empty case) from "question outside practice areas" (which uses the configured out-of-scope response from the guardrails). Context Search returns empty in both cases; the distinction is the agent's responsibility (it may filter by relevant section types or handle the response message). For the search module specifically, the behavior is empty result (§7.6, §7.11).
- **Query that yields more than 5 candidates above threshold**: §7.6 Pass 2 says the search fetches "the top 3–5 highest-scoring files from the context store (above threshold)." Candidates beyond the top 5 are not retrieved in this pass, even if they exceed the threshold.
- **Top-scoring files together exceed token budget**: §7.7 requires that "If retrieved content exceeds the budget, lower-ranked files are truncated or excluded. The guardrails file is never truncated." For Context Search specifically, the lower-ranked retrieved page contents may be truncated or excluded so the assembled output stays within the per-query page-content budget; this preserves the highest-relevance content.
- **Manifest-fetch failure (lawyer's context store unreachable)**: §5.2 calls out latency considerations and HTTPS access but does not enumerate explicit error handling for an unreachable context store. Standard reliability practice (return empty so the agent issues the no-context fallback) is captured in Assumptions because the spec is silent on the exact behavior.
- **Manifest entry whose markdown file is missing**: §5.5 lists `path` and `content_hash` per file; §5.9 says the manifest is "regenerated as the single source of truth." If the manifest entry exists but the file fetch fails, the search treats the file as unavailable and skips it, falling back to the next highest-scoring candidate.
- **`sectionTypes` filter with no matching candidates**: §7.3 makes `sectionTypes` optional; §7.6 awards the full bonus only when an explicit filter matches. If the filter eliminates every candidate above threshold, the search returns empty and triggers fallback behavior (§7.6, §7.11).

## Requirements *(mandatory)*

Each requirement cites the spec section it derives from. No requirement appears here that is not present in `product-spec-legal-chatbot.md`.

### Functional Requirements

#### FR Group A — Tool Surface (§7.3, §12.7)

- **FR-001**: The Context Search module MUST expose its functionality as a single agent-callable tool whose role is described as: "Search the firm knowledge base for information relevant to the user query." Source: §7.3 (`description` field on the `contextSearchTool`).
- **FR-002**: The tool MUST accept a `query` parameter — a free-text string described as "Search query derived from user message." Source: §7.3 parameter schema.
- **FR-003**: The tool MUST accept an optional `sectionTypes` parameter — an array of section-type strings — described as "Filter by section type." Source: §7.3 parameter schema.
- **FR-004**: The tool MUST be callable by the agent on either the user's verbatim query or an agent-reformulated search query. Source: §7.3 ("Receives the user's query (or an agent-reformulated search query)").

#### FR Group B — Two-Pass Retrieval Pipeline (§7.6)

- **FR-005**: Retrieval MUST proceed in two distinct passes: Pass 1 = manifest scan, Pass 2 = content retrieval. Source: §7.6 ("Two-pass retrieval for speed and precision").
- **FR-006**: Pass 1 MUST parse `_manifest.json`, score every file against the query, and rank all files by score. It MUST NOT read any per-page markdown file in this pass. Source: §7.6 ("Pass 1 — Manifest scan (fast, no file reads)").
- **FR-007**: Pass 2 MUST fetch the top 3–5 highest-scoring files (above threshold) from the context store and inject their full markdown content into the prompt context. Source: §7.6 ("Pass 2 — Content retrieval (targeted file reads)").
- **FR-008**: Pass 2 MUST order the fetched files by score, highest first, so that token-budget-driven truncation discards lower-ranked content first. Source: §7.6 ("Files are ordered by score (highest first) so that if token budget forces truncation, the most relevant content is preserved").

#### FR Group C — Scoring Algorithm (§7.6)

- **FR-009**: Each candidate file MUST receive a relevance score in the range 0–1 computed as: `score = (keyword_match × 0.4) + (title_match × 0.3) + (section_type_bonus × 0.2) + (filename_match × 0.1)`. Source: §7.6 scoring formula.
- **FR-010**: `keyword_match` MUST be the Jaccard similarity (intersection ÷ union) between the query tokens and the file's `keywords` array (as defined in §5.5). Source: §7.6 factor table.
- **FR-011**: `title_match` MUST be the proportion of query tokens found in the file title, computed case-insensitively. Source: §7.6 factor table.
- **FR-012**: `section_type_bonus` MUST be: 1.0 when the agent explicitly filtered by section type AND the candidate matches one of those types; 0.5 when the section type is contextually relevant to the query (e.g., the query mentions an attorney name → `attorney-bio` gets a boost); 0.0 otherwise. Source: §7.6 factor table.
- **FR-013**: `filename_match` MUST be 1.0 if any query token appears in the candidate's filename, and 0.0 otherwise. Source: §7.6 factor table.

#### FR Group D — Relevance Threshold & Empty Result (§7.6, §7.11)

- **FR-014**: Files scoring below 0.15 MUST be excluded from the candidate set. Source: §7.6 ("Files scoring below 0.15 are excluded").
- **FR-015**: If no files exceed the threshold, the search MUST return an empty result, which is the trigger for the agent's no-context fallback behavior. Source: §7.6 ("If no files exceed this threshold, the search returns empty (triggers fallback behavior)") and §7.11.
- **FR-016**: The Context Search module MUST NEVER fabricate or synthesize page content; if no qualifying files exist, it MUST return empty rather than hallucinate. Source: §7.11 ("The chatbot never fabricates information. If it's not in the context store, it acknowledges the gap").

#### FR Group E — Manifest Consumption (§5.5, §7.6)

- **FR-017**: The Context Search module MUST consume `_manifest.json` produced by the Crawler with the schema defined in §5.5: a top-level object containing `version`, `generated_at`, `base_url`, and `files` array; each file entry containing `path`, `title`, `section_type`, `word_count`, `content_hash`, `keywords`. Source: §5.5 manifest example, §7.3 (Mechanism step 2: "Reads `_manifest.json` from the context store").
- **FR-018**: Scoring MUST use the manifest's `keywords`, `title`, and `section_type` fields without opening any per-page markdown file. Source: §7.3 (Mechanism step 3: "Matches query against file keywords, titles, and section types") and §7.6 (Pass 1 "no file reads").
- **FR-019**: File retrieval MUST resolve each candidate's `path` against the manifest's `base_url` to construct the absolute URL of the markdown file in the context store. Source: §5.5 manifest fields (`base_url`, per-file `path`).

#### FR Group F — Caching (§5.2)

- **FR-020**: The Context Search module MUST cache `_manifest.json` in memory after first fetch with a TTL of 5 minutes. Source: §5.2 ("The API server caches the `_manifest.json` and recently fetched markdown files in memory (TTL: 5 minutes)") and §7.6 ("cached in memory after first fetch").
- **FR-021**: The Context Search module MUST cache recently fetched markdown files in memory with the same 5-minute TTL. Source: §5.2.
- **FR-022**: Within the cache TTL, the module MUST NOT make a network request to re-fetch a value that is already cached. Source: §5.2 ("the API server does not make a network request to the lawyer's server on every chat message — only on cache misses or when context for a new topic is needed").

#### FR Group G — Token Budget & Context Window Management (§7.7)

- **FR-023**: The total context-injection budget that the Context Search module contributes (per query) MUST stay within the per-query page-content allocation: approximately 3000 tokens for relevant page content (top matches), plus an optional approximately 500 tokens for supplementary related pages "if room." Source: §7.7 priority table rows 2 and 3.
- **FR-024**: The Context Search module MUST respect the overall context-injection cap so that the module's contribution plus the static `_guardrails.md` budget (~1000 tokens, never truncated) never exceeds the total cap of approximately 4500 tokens. Source: §7.7 ("Total context injection cap: ~4500 tokens" and "The guardrails file is never truncated").
- **FR-025**: When retrieved content exceeds the available budget, the module MUST truncate or exclude lower-ranked files, preserving the highest-ranked files in full whenever possible. Source: §7.7 ("If retrieved content exceeds the budget, lower-ranked files are truncated or excluded").
- **FR-026**: The token-budget cap MUST be enforced on every `searchContext` invocation; the module MUST NEVER return assembled context exceeding ~4500 tokens. Source: §12.7 done-when ("Token budget cap is respected (never exceeds ~4500 tokens of context)").

#### FR Group H — Operating Constraints (§5.6, §5.7, §5.8)

- **FR-027**: The Context Search module MUST treat markdown as the universal content format and MUST NOT perform additional serialization/deserialization of page content beyond reading the markdown directly. Source: §5.6 ("LLMs parse markdown natively with high fidelity; No serialization/deserialization overhead at query time").
- **FR-028**: The module MUST tolerate the Crawler's split-by-heading naming for oversized pages (e.g., `faq--general.md`, `faq--personal-injury.md`) and treat each split as an independent candidate in the manifest. Source: §5.7.
- **FR-029**: The module MAY exploit the predictable filename patterns enumerated in §5.8 (`practice-areas--*.md`, `attorneys--*.md`, `faq*.md`, `blog--*.md`, `contact.md`, `about.md`) as part of `filename_match` scoring. Source: §5.8 ("This enables a fast 'filename scan' before opening files, reducing unnecessary reads") combined with §7.6 `filename_match` definition.

#### FR Group I — Read-Only Boundary (§5.10)

- **FR-030**: The Context Search module MUST NEVER write to the context store. The module is purely a reader. Source: §5.10 ("The chatbot and API server never write to the context store").

#### FR Group J — Standalone Test Harness (§12.7)

- **FR-031**: The Context Search module MUST be invokable as a standalone module independent of the Chat API, suitable for being driven by a small test script such as `npx tsx scripts/test-search.ts "<query>"`. Source: §12.7 deliverable example.
- **FR-032**: The standalone invocation MUST surface the relevance score of returned files so an engineer can verify scoring against fixture content. Source: §12.7 deliverable ("Output: retrieves practice-areas--personal-injury.md, shows relevance score").

### Key Entities

The Context Search module reads two artifact types defined elsewhere in the spec and produces one ephemeral output. It introduces no new persistent entities.

- **Context Store Manifest (consumed)**: `_manifest.json` with the schema defined in §5.5 (`version`, `generated_at`, `base_url`, `files[]` where each file has `path`, `title`, `section_type`, `word_count`, `content_hash`, `keywords`). Source: §5.5.
- **Crawled Page Markdown File (consumed)**: The per-page markdown files under `pages/` produced by the Crawler with the YAML frontmatter defined in §3.11. The Context Search module reads the content body for assembly into the prompt; it MAY read the frontmatter for supplementary metadata but the manifest is the authoritative source. Source: §3.11, §5.5.
- **Assembled Context (produced, ephemeral)**: The output returned to the agent — an ordered concatenation of the highest-scoring markdown files' contents, ordered by score (highest first), bounded by the §7.7 token budget. Not persisted. Source: §7.6, §7.7.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Issuing a query of "personal injury" against the seeded Shrager Defense Attorneys context returns the personal-injury practice-area markdown file as the top result. Source: §12.7 done-when.
- **SC-002**: Issuing a query of "John Smith" against a context containing an attorney bio for John Smith returns that attorney bio file as a top result. Source: §12.7 done-when.
- **SC-003**: Issuing a query of "divorce" against a context containing family-law content returns the family-law markdown file. Source: §12.7 done-when.
- **SC-004**: Issuing a query of "tax law" against a context that does not cover tax law returns no results because every candidate scores below the threshold. Source: §12.7 done-when.
- **SC-005**: For 100% of queries that return content, the assembled context never exceeds approximately 4500 tokens. Source: §7.7 cap, §12.7 done-when.
- **SC-006**: For any query, the relevance scoring formula (`0.4 × keyword_match + 0.3 × title_match + 0.2 × section_type_bonus + 0.1 × filename_match`) is the sole basis for ranking — alternative ranking heuristics are not used. Source: §7.6.
- **SC-007**: Files scoring below 0.15 do not appear in the returned context for any query. Source: §7.6 threshold.
- **SC-008**: Pass 2 fetches between 0 and 5 markdown files per query (zero when no candidate exceeds threshold; otherwise the top 3–5). Source: §7.6 Pass 2.
- **SC-009**: Two consecutive `searchContext` invocations within a 5-minute window do not produce two manifest network fetches; the second invocation reads from the in-memory cache. Source: §5.2.
- **SC-010**: Re-fetching the same markdown file twice within a 5-minute window does not produce two network fetches; the second read is served from the in-memory cache. Source: §5.2.
- **SC-011**: When invoked with an explicit `sectionTypes` filter that matches at least one candidate, files of the filtered type rank above otherwise-equivalent files of non-filtered types because of the 1.0 section-type bonus. Source: §7.6 factor table.
- **SC-012**: The Context Search module reads zero per-page markdown files during Pass 1 — Pass 1 reads only the manifest. Source: §7.6 ("fast, no file reads").
- **SC-013**: When the search returns empty, the agent's response uses the §7.11 "no relevant context files found" wording rather than fabricating an answer. (Verification of this criterion requires the Chat API layer; from the Context Search module's perspective, the module returns empty in 100% of below-threshold cases — Source: §7.6, §7.11.)

## Assumptions

These are reasonable defaults adopted where the spec does not explicitly prescribe a detail. Each is consistent with — and never contradicts — the spec.

- **Query tokenization**: §7.6 references "query tokens" for `keyword_match`, `title_match`, and `filename_match` but does not define the tokenizer. A reasonable default is to lowercase the query and split on whitespace and standard punctuation, consistent with the case-insensitive `title_match` rule. Stopword filtering is permitted but not required; both options remain consistent with §7.6.
- **Token-counting strategy**: §7.7 defines the budget in approximate tokens. Counting against the model's tokenizer is the natural choice (since the budget exists to protect the model). The spec does not mandate a specific tokenizer; a reasonable approximation (e.g., 4 chars/token, or the model's actual tokenizer when available) is acceptable.
- **`section_type_bonus = 0.5` contextual relevance triggers**: §7.6 gives one example ("query mentions an attorney name → `attorney-bio` gets a boost"). The spec does not enumerate all triggers. A small, deterministic mapping (e.g., names → `attorney-bio`; "office hours", "phone", "address" → `contact`; "cost", "fees" → `general` or `faq`) is acceptable, provided it is documented and testable.
- **Network timeout for context-store fetches**: §5.2 does not specify a timeout. A short, conservative timeout (e.g., 5–10 seconds) appropriate for serverless function execution is acceptable, with a fetch failure treated as "file unavailable" so the search continues with the next candidate or returns empty.
- **Manifest TTL refresh strategy**: §5.2 specifies 5 minutes; the spec does not say whether refresh is "lazy on next access" or "background scheduled." Lazy refresh on access (re-fetch when the cached value's age exceeds 5 minutes at next read) is the simpler default and is consistent with the latency consideration in §5.2.
- **Top-N selection within 3–5**: §7.6 says "top 3–5 highest-scoring files." Choosing N dynamically based on score gaps and the available token budget (so high-confidence single-result queries do not waste budget on weaker matches) is permitted; selecting a fixed N within [3, 5] is also permitted. Both behaviors stay within the spec.
- **Context-store unreachable**: §5.2 does not enumerate the error path. Returning an empty result so the agent issues the §7.11 fallback is the consistent default — the chatbot must never fabricate, so empty is the safe response.

## Out of Scope (for this feature)

The following items are explicitly **not** part of the Context Search feature, even though they are mentioned in adjacent spec sections.

- Generation of `_manifest.json` and the markdown files themselves. These are owned by the Crawler (§3, Phase 1) and the Dashboard publish action (`_guardrails.md`, §4.7). Context Search consumes their output.
- The system prompt composition (§7.8). Although Context Search produces the "Retrieved context" block of the system prompt, the assembly of the four-block system prompt (Base instructions, `_guardrails.md` content, retrieved context, intake state) is the Chat API's responsibility (Phase 3, §12.8).
- The conversation memory sliding window (§7.9). That belongs to the Chat API.
- Multi-turn awareness behaviors — pronoun resolution, follow-up detection, topic-shift detection (§7.12). These are the agent's concern; Context Search exposes a stateless tool that responds to whatever query the agent passes in.
- LLM tool-call orchestration, `maxSteps` enforcement, and streaming (§7.2, §12.8). These belong to the Chat API.
- The `captureLead` tool (§7.4), classification, and lead persistence. These belong to Phase 5.
- Authentication, transport, and serving of the context store (§5.2). The context store is hosted on the lawyer's infrastructure; Context Search only fetches from it.

## Dependencies

- **External**: HTTPS reachability of the lawyer's `chatbot-context/` directory at the URL configured for the account (§5.2). The module fetches the manifest and per-file content from that URL.
- **Internal — Upstream**: The Foundation feature (`001-foundation`) for shared types, environment configuration, structured logging, and the `shared` workspace package. The Crawler CLI feature (`002-crawler-cli`) for the manifest and markdown formats this module consumes (§5.5, §3.11).
- **Internal — Downstream**: The Chat API (Phase 3, §12.8) consumes Context Search to populate the "Retrieved context" block of the system prompt (§7.8).

## Notes on Non-Invention

This specification deliberately omits any requirement not present in `product-spec-legal-chatbot.md`. In particular:

- No specific tokenizer is mandated for query tokenization; §7.6 describes scoring in terms of "query tokens" without specifying the tokenizer.
- No specific HTTP client library is named; §5.2 specifies HTTPS access without prescribing a client.
- No vector embeddings, semantic similarity, or re-ranking model is required; §7.6 describes a deterministic, weighted lexical score and only a lexical score.
- No persistence of search results is required; §7.7 implies the assembled context is built per query.
- No per-account or per-lawyer scoring tuning is required; §7.6 defines the algorithm globally.
- No explicit rate limiting on context-store fetches is required; §5.2 caps requests indirectly via the 5-minute cache TTL.
- No `searchContext` retry/backoff policy is required; the spec does not enumerate one.
- The semantic-similarity-based FAQ cache mentioned in §11.6 is explicitly an additional recommendation and is out of scope here (and is post-MVP per the constitution and §10).

If any of these are wanted, they belong in a separate feature, not in Context Search.
