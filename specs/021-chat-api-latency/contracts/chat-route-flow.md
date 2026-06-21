# Contract: Chat Route Flow (post-change)

**Feature**: 021-chat-api-latency · **File**: `packages/api/src/app/api/chat/route.ts`

## Goal

Document the post-change sequence of operations in `POST /api/chat` so reviewers can verify the optimizations preserve behavior.

## Sequence (one chat turn)

```text
1.   parse x-api-key header
2.   bodyPromise = req.json()           ┐ raced (today's optimization, kept)
3.   auth = await verifyApiKey(...)     ┘
4.   checkRateLimit(auth.accountId)
5.   incomingSessionId = req.headers.get('x-session-id')
6.   Promise.all([                       ┐
       loadConfig(isPreview),            │
       getSOPBundle(accountId),          │ kept; lazy branch deps added in step 12
       bodyPromise,                      │
       incomingSessionId                 │
         ? getSessionForSOP(...)         │
         : Promise.resolve(null)         │
     ])                                  ┘
7.   validate body.messages
8.   sessionId = existingSession ? incomingSessionId : await createSession(...)
9.   history = sessionData?.messages ?? []
10.  conversationAnchorIso = sessionData?.conversationAnchorIso ?? new Date().toISOString()
11.  newUserMessage = messages[messages.length - 1]
     fullMessages = [...history, newUserMessage]
12.  if (sopState && sopBundle.sop) {
       advanced = await advanceForVisitorMessage(...)
       sopState = advanced.state
       // NOTE: isOffTopic call REMOVED in this feature
       detectPendingContact / stash if applicable
     }
13.  branchPromptDirective = null
     branchActiveQuestion = null
     branchFinalizationPayload = null
     if (sopState?.is_finalized) {           // <-- NEW gate (was: always-eager)
       branchDeps = { lookupBranch, getVersionById, now, sessionId,
                      whenChipWeights (built lazily),
                      whenChipWeightsByLabel (built lazily),
                      goodbyePhrases }
       orchestrated = await runBranchOrchestrator({ accountId, sopState, userMessage, deps: branchDeps })
       // branchPromptDirective / branchActiveQuestion / branchFinalizationPayload set as today
     }
14.  staticPrefix = getCachedStaticPrompt({ accountId, configVersionId, isPreview, config })
                    // miss path computes composeSystemPromptStatic(config) and stores
     systemPrompt = staticPrefix
                  + (sopActive ? composeSopBlock(sopState, sopConfig, goodbyePhrases) : '')
                  // NOTE: isOffTopicNow argument REMOVED
                  + (branchPromptDirective ? `\n\n${branchPromptDirective}` : '')
15.  tools = { searchContext, captureLead }  // unchanged
16.  result = streamText({
       model: google('gemini-2.5-flash'),
       system: systemPrompt,
       messages: fullMessages,
       tools,
       maxSteps: 5,
       onError: ...,
       onFinish: async ({ text }) => {
         const allMessages = [...fullMessages, { role: 'assistant', content: text }]

         // CRITICAL PATH — visitor's next turn reads this row
         await appendMessagesAndSOPState(
           sessionId,
           history,                                  // <-- NEW: pass in-memory history
           [newUserMessage, { role: 'assistant', content: text }],
           sopState,
         )

         // DEFERRED — runs after response closes
         runAfterResponse(async () => {
           await updateLeadSOPState(sessionId, sopState)

           if (branchFinalizationPayload) {
             const branchUpdate = await db.update(schema.leads).set({...}).where(...).returning({ id })
             const branchedLeadId = branchUpdate[0]?.id ?? null
             if (branchedLeadId) {
               await applyAndPersistHardOverrides({ accountId, leadId: branchedLeadId, sopState })
             }
           }

           const partial = extractPartialLeadData(allMessages)
           await savePartialLead(accountId, sessionId, partial, allMessages)
         }, (err) => log.error('[chat] deferred-writes failed', { sessionId, accountId, err }))
       },
     })
17.  response = result.toDataStreamResponse()
18.  set x-session-id, x-sop-state headers, CORS headers (unchanged)
19.  return Response (unchanged)
```

## Removed steps (delta from today)

- Step 12 no longer calls `isOffTopic(...)`. The `isOffTopicNow` local is gone.
- Step 14 no longer threads `isOffTopicNow` into `composeSystemPrompt`. The `composeSystemPrompt` signature drops that parameter (last positional argument).
- Step 13's `branchDeps` literal moves inside the `is_finalized` gate.
- Step 16's `onFinish` no longer awaits `Promise.all([sessionsWrite, leadsWrite])`. The session write is awaited directly; the leads chain runs inside `runAfterResponse`.

## Behavior invariants

- **System-prompt content**: byte-equal to today's output for the same `(config, sopState, sopConfig, goodbyePhrases, caseTypes, branchPromptDirective)` input, MINUS the removed `### Detour required NOW` block. (Today this block was conditionally appended; removing it changes the prompt only on the specific turns where it would have been emitted.)
- **Database state at `done` event**: `sessions` row has the new messages + SOP state. Other tables may be eventually-consistent (~10-100ms behind).
- **Database state ~1s after `done` event**: byte-equal to today's database state for the same input, modulo monotonic timestamps.
- **HTTP response headers**: unchanged.
- **HTTP response body**: unchanged.

## Error contract

- Any error in the critical-path `appendMessagesAndSOPState` propagates to the AI SDK's `onFinish` and surfaces via `onError` (today's behavior).
- Any error in the deferred chain is caught by `runAfterResponse`'s `.catch` and emitted as a structured log entry. The visitor's stream is NOT affected.
