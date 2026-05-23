# Contract: `<LegalChatbot>` React Component

**Owner**: Chat Widget (`005-chat-widget`)
**Distribution**: NPM package `@legal-chatbot/widget`
**Source of Truth**: §6.2, §6.3, §6.13.

## Public API

```ts
import { LegalChatbot } from '@legal-chatbot/widget';
import type { LegalChatbotProps, LegalChatbotTheme } from '@legal-chatbot/widget';
```

## Props

| Prop | Type | Required | Default | Source |
|---|---|---|---|---|
| `apiKey` | `string` | yes | — | §6.2 |
| `apiUrl` | `string` | no | `import.meta.env.VITE_API_URL` or `http://localhost:3000/api/chat` | §6.6 |
| `position` | `'bottom-right' \| 'bottom-left'` | no | `'bottom-right'` | §6.7 |
| `theme` | `Partial<LegalChatbotTheme>` | no | — | §6.3, §6.7 |
| `onChatOpen` | `() => void` | no | — | §6.13 |
| `onChatClosed` | `() => void` | no | — | §6.13 |
| `onMessageSent` | `(m: { role: 'user'; content: string }) => void` | no | — | §6.13 |
| `onLeadSubmitted` | `(l: { classification: string; leadId: string }) => void` | no | — | §6.13 |
| `onEscalationTriggered` | `() => void` | no | — | §6.13 |

All props are TypeScript-typed; type definitions ship in
`dist/index.d.ts`.

## Peer Dependencies

```jsonc
{
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0"
  }
}
```

`@ai-sdk/react` is a regular `dependencies` entry (it has React
as its own peer); the host's React satisfies it transitively.

## Behavior

1. On mount, the component renders only the `<ChatBubble>` trigger
   in the host's light DOM. The chat panel is NOT rendered until
   first interaction (FR-038, FR-039).
2. On bubble click, the `<ChatPanel>` is mounted into a Shadow
   DOM root attached to a host `<div>`. Subsequent renders update
   in place.
3. The chat panel fetches `/api/config` on mount; falls back to
   defaults on failure (silent — see §6.5).
4. The chat panel runs `useChat` with `api: apiUrl`,
   `headers: { 'x-api-key': apiKey, 'x-session-id': sessionStorage[lc_session_id] }`.
5. On first response, captures the `x-session-id` response
   header into `sessionStorage`.
6. Subsequent navigations within the same tab read the session
   ID and resume.
7. Closing the panel keeps the session alive in storage; only
   the `<ChatPanel>` tree unmounts.

## Determinism

- Identical props produce identical initial render (modulo
  timestamps, which are deferred to mount).
- Theme tokens flow through CSS custom properties; same input →
  same visual output.

## Bundle Size

The NPM build artifact MUST be ≤ 35 KB gzipped (FR-034, SC-009).
Enforced by `pnpm --filter @legal-chatbot/widget size` in CI per
`size-limit` config (R8).

