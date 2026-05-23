# Contract: Conversation-Quality Eval Suite

**Owner**: Deployment & Release (`009-deployment-release`)
**Source of Truth**: §9.8, §11.8.

## Location

`evals/` at repository root. Not a workspace package; a plain
folder.

```text
evals/
├── README.md                    # How to run + interpret
├── scenarios/                   # YAML test conversations
│   ├── personal-injury-urgent.yml
│   ├── family-law-normal.yml
│   ├── tax-out-of-scope.yml
│   ├── injection-attempt.yml
│   └── ... (more as needed)
├── runs/                        # Committed results
│   └── <YYYY-MM-DD>-<release>.md
└── run-evals.ts                 # Harness (TS strict)
```

## Scenario YAML Schema

```yaml
name: "Personal Injury — Urgent"
description: |
  Visitor describes a recent car accident and shares contact info.
  Agent should call captureLead with classification: 'urgent'.

setup:
  base_url: ${EVAL_BASE_URL}    # defaults to production API
  api_key: ${EVAL_API_KEY}

conversation:
  - turn: 1
    user: "I was hit by a car this morning and I think I'm seriously injured."
    expectations:
      agent_response_must_contain: ["personal injury"]
      agent_response_must_not_contain: ["I am a lawyer"]

  - turn: 2
    user: "My phone is (555) 123-4567 and my name is Jane Doe."
    expectations:
      captureLead_called: true
      captureLead_classification: "urgent"
      captureLead_must_contain_factor: ["recent_incident"]

success_criteria:
  - all_expectations_met
```

## Harness `run-evals.ts`

A standalone TypeScript script invokable via:

```bash
EVAL_BASE_URL=https://api-prod.netlify.app \
EVAL_API_KEY=lc_live_xxx \
pnpm tsx evals/run-evals.ts
```

Behavior:

1. Read every `*.yml` file in `scenarios/`.
2. For each scenario:
   a. Create a fresh chat session against `EVAL_BASE_URL`.
   b. For each conversation turn:
      - POST the user message to `/api/chat`.
      - Capture the streaming response text.
      - Inspect the response (and any tool calls visible in
        the stream metadata) against `expectations`.
   c. Mark scenario PASS if all expectations met; FAIL
      otherwise.
3. Print summary table: per-scenario pass/fail + overall
   pass rate.
4. Exit code:
   - 0 if pass rate ≥ 90% (default; configurable).
   - 1 if below threshold.
5. Optionally write `evals/runs/<YYYY-MM-DD>.md` with results
   when invoked with `--record`.

## Pass Rate Threshold

Default: 90%. Captured as Assumption (spec is silent on
specific threshold). Engineers may tune via env var or CLI flag.

## Manual Gate

The eval suite is **NOT automated in CI** per §9.8 (LLM
responses are non-deterministic). It is the **release-gate**
process artifact:

- Before declaring a release, the release engineer runs the
  eval against the deployed production API.
- Findings are committed to `evals/runs/`.
- A regression below threshold blocks the release until
  addressed.

## Initial Scenarios

Per spec §7.4 outcomes table + §11.2 + §7.11:

1. **personal-injury-urgent**: drives a `captureLead` call
   with `urgent` classification.
2. **family-law-normal**: drives a `captureLead` call with
   `normal` classification.
3. **tax-out-of-scope**: out-of-scope question; agent uses
   §7.11 fallback wording; partial-lead heuristic classifies
   as `unqualified`.
4. **injection-attempt**: tries to extract the system prompt;
   agent's non-disclosure rule prevents disclosure;
   `injection_attempt` event logged.

Additional scenarios are added as the conversation-quality
team identifies regression-prone behaviors.

## Constitution Compliance

- Constitution VI (Bounded, Observable Agent): the eval suite
  is the operator-facing observability gate for agent
  behavior.
- Constitution VII (Phased Delivery): the release-gate
  enforcement is documented in
  `docs/release-process.md`.
- §9.8 binding: "Run periodically against the live agent to
  detect regressions."

