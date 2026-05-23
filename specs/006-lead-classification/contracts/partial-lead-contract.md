# Contract: Partial Lead Heuristic

**Owner**: Lead Classification (`006-lead-classification`)
**Source of Truth**: §7.4 partial-lead fallback, §7.10.

The partial-lead heuristic is the **fallback path** for
abandoned conversations where the LLM did not call `captureLead`.
It runs after every chat turn (per §7.10) and persists a partial
lead with a heuristic classification when useful data was shared.

## Module Surface

```ts
// packages/api/src/lib/partial-lead.ts

export interface PartialLeadData {
  name: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  briefDescription: string | null;
}

export interface PartialLeadClassification {
  classification: 'urgent' | 'normal' | 'unqualified';
  rationale: string;
}

export function extractPartialLeadData(
  messages: Array<{ role: string; content: string }>,
): PartialLeadData;

export function classifyPartialLead(
  messages: Array<{ role: string; content: string }>,
): PartialLeadClassification;

export function savePartialLead(
  accountId: string,
  sessionId: string,
  partial: PartialLeadData,
  messages: Array<{ role: string; content: string }>,
): Promise<void>;
```

## `extractPartialLeadData`

Pure-function regex extraction from user messages. Patterns:

| Field | Regex | Source |
|---|---|---|
| `contactEmail` | `/[\w.-]+@[\w.-]+\.\w+/` | RFC-5322 lite, sufficient for MVP |
| `contactPhone` | `/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/` | US-style, allows parens / dashes / dots / spaces |
| `name` | `/(?:my name is\|i'm\|i am\|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i` | Common self-introduction phrasings |
| `briefDescription` | First user message with `length > 20` | Pragmatic — covers "I was in a car accident last week" |

Returns `PartialLeadData` with each field nullable. Pure
function; deterministic; no side effects.

## `classifyPartialLead`

Heuristic classifier per §7.10:

| Output | Trigger |
|---|---|
| `urgent` | Conversation matches BOTH at least one urgency pattern AND at least one legal-matter pattern |
| `normal` | Conversation matches at least one legal-matter pattern WITHOUT urgency patterns |
| `unqualified` | Otherwise |

### Pattern Sets (per §7.10 examples)

```ts
const urgencyPatterns = [
  /\b(today|yesterday|just|this morning|last night|right now|currently)\b/,
  /\b(arrested|detained|custody|jail|locked up|booked)\b/,
  /\b(emergency|immediate|urgent|asap|right away)\b/,
  /\b(court date|hearing|arraignment|deadline)\b/,
  /\b(human|representative|real person|speak to someone|talk to a lawyer)\b/,
  /\b(danger|threatened|violence|restraining)\b/,
];

const legalPatterns = [
  /\b(charged|arrested|caught|accused|cited|ticket)\b/,
  /\b(dui|dwi|drunk driving|cocaine|marijuana|drugs|possession)\b/,
  /\b(assault|theft|robbery|fraud|gun|weapon)\b/,
  /\b(divorce|custody|injury|accident|malpractice)\b/,
  /\b(lawyer|attorney|legal help|representation)\b/,
];
```

### Rationale Generation

For `urgent`: rationale lists which urgency phrases matched, e.g.,
`"Partial lead with urgency signals: today, arrested"`.
For `normal`: `"Partial lead describing a legal matter"`.
For `unqualified`: `"Partial data from abandoned session — no clear legal matter identified"`.

The matched substring may contain user PII (e.g., names mentioned
in the same sentence) — but the substrings here are limited to
**pattern matches** which are constants (no PII leaks via
matched groups for these patterns).

## `savePartialLead`

Side-effecting persistence:

1. **Existence check**: SELECT `leads.id` WHERE `session_id = ?`.
   If a row exists, RETURN immediately and emit
   `partial_lead_skipped` event with `{ reason: 'lead_exists' }`.
2. **Usefulness check**: if all of `partial.contactEmail`,
   `partial.contactPhone`, `partial.briefDescription` are null,
   RETURN immediately and emit `partial_lead_skipped` with
   `{ reason: 'no_data' }`.
3. **Classify**: call `classifyPartialLead(messages)`.
4. **INSERT**: write a new row in `leads` per
   `lead-write-contract.md` heuristic-driven path semantics.
5. **Log**: emit `partial_lead_saved` event with
   `{ leadId, classification, signalsMatched: string[] }`.
   The `signalsMatched` array contains pattern NAMES (e.g.,
   `'urgency:arrested', 'legal:dui'`), NOT matched substrings,
   to avoid logging user message content (Constitution V).

## Determinism

- `extractPartialLeadData`: pure; deterministic.
- `classifyPartialLead`: pure; deterministic.
- `savePartialLead`: idempotent (existence check prevents
  double-write); deterministic given the same DB state.

## Tests

The 429-LOC `partial-lead.test.ts` already covers most scenarios.
R5/R7 gap-fill tests:

- `extractPartialLeadData`: each pattern matches its canonical
  form; non-matching strings produce nulls.
- `classifyPartialLead`: §7.10 matrix of (urgency × legal) →
  classification; rationale text matches expected format.
- `savePartialLead`: edge cases from R7
  (no user messages; no extractable data; existing lead;
  multiple urgency signals; PII redaction in `signalsMatched`
  log payload).

