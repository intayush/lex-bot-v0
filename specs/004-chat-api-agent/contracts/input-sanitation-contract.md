# Contract: Input Sanitation & Injection Detection

**Owner**: Chat API + Agent (`004-chat-api-agent`)
**Source of Truth**: §11.2, FR-047 to FR-049.

## Two Concerns

This contract covers two related but distinct concerns:

1. **Sanitation (FR-047)**: deterministic transformation of user
   input to remove control characters and cap length. Always
   applied.
2. **Injection detection (FR-049)**: pattern-matching to flag
   conversations that appear to be attempting prompt injection.
   Logs the attempt but does NOT block the conversation.

## Sanitation Module

```ts
// packages/api/src/lib/input-sanitize.ts

export function sanitize(text: string): string;
```

### Algorithm

1. Normalize Unicode: `text.normalize('NFC')`.
2. Strip control / format / private-use / unassigned characters,
   preserving `\n`, `\r`, `\t`:
   ```ts
   text.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, (ch) =>
     ch === '\n' || ch === '\r' || ch === '\t' ? ch : ''
   );
   ```
3. Trim leading/trailing whitespace.
4. Cap length at 4000 characters (Assumption — chosen as ~1000
   tokens, comfortably below the agent's per-turn budget).

### Application

The route runs `sanitize()` on the **content** of the latest user
message before passing it to the LLM. Earlier messages in
`history` are NOT re-sanitized (they were already sanitized when
they were originally written).

### Determinism

Pure function; identical input → identical output. Trivially
unit-testable.

## Injection Detection Module

```ts
// packages/api/src/lib/injection-detector.ts

export function detectInjectionAttempt(text: string):
  { matched: boolean; pattern?: string };
```

### Pattern Set (initial)

```ts
const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'ignore-instructions', regex: /ignore\s+(your|all|previous|the)\s+(instructions|prompts|rules)/i },
  { name: 'print-system-prompt', regex: /print\s+(your|the)\s+(system\s+)?(prompt|instructions|configuration)/i },
  { name: 'reveal-internal',     regex: /reveal\s+(your|the)\s+(system\s+)?(prompt|instructions|tools)/i },
  { name: 'role-override',       regex: /you\s+are\s+now\s+a/i },
  { name: 'forget-everything',   regex: /forget\s+(everything|previous|your\s+instructions)/i },
];
```

The set is deliberately small for MVP; tuning happens via
conversation-quality eval (Phase 8) and the optional classifier
in `008-hardening`.

### Behavior

- Returns `{ matched: false }` on no match.
- Returns `{ matched: true, pattern: '<name>' }` on first match.
- The route emits an `injection_attempt` log event when matched
  (per Foundation log-event contract):
  ```ts
  logger.event('injection_attempt', {
    pattern: result.pattern,
    message_length: text.length,
  }, { session_id, account_id });
  ```
- Detection is non-blocking: the conversation proceeds. The
  agent's system-prompt non-disclosure rule (R13) is the runtime
  defense.

## Order of Application

```
incoming user message
    │
    ├─ sanitize(text)          // R2 — always
    │
    ├─ detectInjectionAttempt(sanitized_text)
    │       │
    │       ├─ matched → emit injection_attempt log event
    │       │
    │       └─ continue regardless
    │
    └─ pass sanitized_text to LLM
```

## Constitution Compliance

- Constitution Principle V (Privilege & Privacy): the
  `injection_attempt` log entry passes through the Foundation
  logger's redaction list; the message text is NOT included in
  the log payload at top level (only `message_length` is).
- Constitution Principle VI (Bounded, Observable Agent): every
  injection attempt is observable via the structured-log stream;
  conversation-quality regressions are detectable.

## Tests

- `input-sanitize.test.ts`: control-char strip across categories,
  preservation of `\n` `\r` `\t`, length cap, NFC normalization,
  whitespace trim.
- `injection-detector.test.ts`: each pattern matches its
  canonical form; non-matching strings return false; mixed case
  works; partial overlaps don't false-match.

