# Contract: Widget Installation Page Surfaces

**Owner**: Dashboard (`007-dashboard`)
**Source of Truth**: §8.8.

## Page Layout

Three-section vertical layout per §8.8:

1. **Step 1 — API Key Management**: lists keys (per
   `api-keys-route-contract.md`), with Generate / Revoke /
   Rotate actions.
2. **Step 2 — Installation Snippet**: tabbed code preview with
   copy-to-clipboard.
3. **Step 3 — Verify Installation**: button → calls
   `/api/dashboard/verify-install` → green checkmark or
   troubleshooting tips.

## Step 2: Snippet Generator

Three tabs, each pre-filled with the lawyer's API key (the
plaintext if just generated; otherwise prompt the lawyer to
generate a new key for the snippet).

### Tab: Script Tag (HTML)

```html
<script src="https://cdn.legalchatbot.com/widget/v1/legal-chatbot.js"
        data-api-key="lc_live_xxxxxxxx"></script>
```

### Tab: React Component

```jsx
import { LegalChatbot } from '@legal-chatbot/widget';

<LegalChatbot apiKey="lc_live_xxxxxxxx" />
```

### Tab: Next.js

```jsx
'use client';
import { LegalChatbot } from '@legal-chatbot/widget';

export default function Page() {
  return <LegalChatbot apiKey="lc_live_xxxxxxxx" />;
}
```

The CDN URL is the Phase 8 production URL (configurable via
env in dev).

## Step 3: Verify Installation Probe

### POST /api/dashboard/verify-install

Body:

```ts
{ url: z.string().url() }   // The lawyer's site URL where the widget should be
```

Behavior:
1. Authenticated.
2. Server-side fetch of `url` with timeout 5 s.
3. Parse the response HTML for `<script src="...legal-chatbot.js" data-api-key="...">`.
4. Verify the `data-api-key` matches one of the account's
   active API keys (extract via regex; do NOT log the
   key — Constitution V).
5. Return:

```ts
{
  status: 'ok' | 'script_not_found' | 'wrong_key' | 'fetch_failed',
  detail?: string,
}
```

Friendly client-side messages map each `status` to:

- `ok`: "✓ Widget detected and using a valid API key."
- `script_not_found`: "We couldn't find the widget script on
  your page. Make sure you copied the snippet exactly."
- `wrong_key`: "We found the widget script, but the API key
  doesn't match any of your active keys."
- `fetch_failed`: "We couldn't reach your URL. Make sure it's
  publicly accessible."

## Constitution Compliance

- Constitution II: Zod body validation.
- Constitution IV: Route Handler; no fs writes.
- Constitution V: API key plaintexts never logged;
  Foundation logger redacts on emission.

