# Contract: `captureLead` Tool

**Owner**: Lead Classification (`006-lead-classification`)
**Consumed by**: Chat API + Agent (`004-chat-api-agent`) — registers as a Vercel AI SDK tool
**Source of Truth**: §7.4, §2.8.

## Tool Registration (in `004-chat-api-agent`'s route)

```ts
captureLead: tool({
  description: 'Capture a qualified lead after understanding the legal matter. Call as soon as the legal issue is clear — do not wait for complete contact info.',
  parameters: captureLeadParamsSchema,
  execute: async (params) => {
    return await captureLead({ accountId, sessionId, ...params });
  },
}),
```

The tool DESCRIPTION text is the §7.4 binding:
> "Capture a qualified lead after understanding the legal matter.
>  Call as soon as the legal issue is clear — do not wait for
>  complete contact info."

## Parameter Zod Schema

```ts
// packages/shared/src/schemas/lead-tool-params.ts (NEW; exported)

import { z } from 'zod';

export const captureLeadParamsSchema = z.object({
  name:                    z.string().nullable(),
  contactEmail:            z.string().nullable(),
  contactPhone:            z.string().nullable(),
  caseType:                z.string().nullable(),
  incidentDate:            z.string().nullable(),
  briefDescription:        z.string(),
  classification:          z.enum(['urgent', 'normal', 'unqualified']),
  classificationRationale: z.string().min(1),  // R4: non-empty
  urgencyFactors:          z.array(z.string()),
});

export type CaptureLeadParams = z.infer<typeof captureLeadParamsSchema>;
```

The Zod schema is the binding interface; both the Vercel AI SDK
tool wiring and the `captureLead` function consume it.

## Function Signature

```ts
// packages/api/src/lib/leads.ts

export async function captureLead(input: {
  accountId: string;
  sessionId: string;
} & CaptureLeadParams): Promise<{
  leadId: string;
  classification: 'urgent' | 'normal' | 'unqualified';
  isUpsert: boolean;
}>;
```

## Execute Behavior

Sequential steps inside a single Drizzle transaction (R2):

1. **Validate** `classificationRationale.trim().length > 0`. If
   not, throw `LeadValidationError` with a message naming the
   offending field (R4).
2. **Upsert** into `leads` keyed by `session_id` (R3):
   - On insert: new `id = nanoid()`, all fields populated.
   - On update: existing `id` preserved; mutable fields refreshed
     from `input`.
3. **If `classification === 'urgent'`**: check whether an
   `urgent_lead` notification already exists for this
   `session_id`. If not, INSERT one with the §8.7 wording (R1).
4. Emit `lead_captured` log event via Foundation logger (R5).
5. Return `{ leadId, classification, isUpsert }`.

If any step throws, the transaction rolls back. The Foundation
logger emits `lead_capture_failed` with the error context.

## Tool Result (Returned to Agent)

```ts
// What the agent sees in the tool-call result
{
  success: true,
  leadId: '<nanoid>',
  classification: 'urgent' | 'normal' | 'unqualified',
}
```

On validation failure (R4):

```ts
{
  error: 'invalid_lead',
  message: 'classification_rationale must be non-empty',
}
```

The agent can self-correct on the next step within the
`maxSteps: 5` budget.

## Classification Outcomes (per §7.4)

| Classification | Criteria | Persistence | Notification | Agent Next Action |
|---|---|---|---|---|
| `urgent` | Time-sensitive matter, statute of limitations, active danger, recent arrest, user requests human help | Lead row | Yes (urgent_lead) | Recommend immediate contact |
| `normal` | Valid legal matter, not time-critical | Lead row | No | Offer consultation scheduling |
| `unqualified` | Outside practice areas, no actionable legal matter | Lead row | No | Politely redirect |

## Determinism

Given identical input, the function produces:
- The same lead-row state in the database (idempotent under R3
  upsert).
- The same notification-row state (idempotent under the
  deduplication check).
- The same return value (modulo `leadId` on first call).

## Tests (mandatory — per Constitution III)

The 294-line `leads.test.ts` covers the existing function. R1–R5
gap-fill tests:

- R1: notification title/body matches §8.7 wording exactly.
- R2: notification insert failure rolls back the lead insert.
- R3: second `captureLead` for same session UPDATEs (id stable);
  no duplicate notification on repeat urgent classification.
- R4: empty / whitespace-only `classificationRationale` throws.
- R5: success path emits `lead_captured` event with redacted
  payload.

