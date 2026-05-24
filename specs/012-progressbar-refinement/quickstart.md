# Quickstart: ProgressBar Refinement

**Date**: 2026-05-24
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This quickstart shows the visitor's experience after the ProgressBar
Refinement feature ships. It validates the single user story from
spec.md.

## Prerequisites

- 010-sop-workflow merged + deployed (the original ProgressBar lives
  here).
- 011-preflight-phrase rev2 merged + deployed (the typing indicator
  uses the rev2 client-side classifier; not strictly required for 012
  but it's the current production state).
- Widget demo + API site deployed at known URLs.
- Dev account with the default 6-step SOP seeded.

## Walk-through

### US1 — Visible Step Progress Inside Chat Panel

1. Open the widget demo (https://lex-bot-chatbot.netlify.app/) in an
   incognito browser window.
2. Click the chat bubble in the bottom-right to open the panel.

**Expected**:

- The header bar (firm name + close button) is visible at the top of
  the panel.
- **Below the header**, you see a horizontal progress bar — clearly
  visible, ~8px thick.
- The bar has a small label at the right: `Step - 0/6`.
- Below the bar, the conversation area starts (greeting message +
  Quick Reply pills).

3. Type "I had a DUI" and press Enter.

**Expected**:

- Bot processes your message.
- After the assistant responds, the progress bar updates: e.g.,
  `Step - 1/6` with the filled portion advancing about 1/6 of the bar's
  width.

4. Continue answering the SOP questions (sub_type → where → what → when
   → contact form).

**Expected**:

- After each captured step, the bar's label increments (`Step - 2/6`,
  `Step - 3/6`, …) and the filled portion advances.
- When the contact form is submitted and the SOP finalizes, the bar
  shows `Step - 6/6` fully filled.

### Edge case: Account with no SOP

(Hard to reproduce manually since the dev account has a seeded SOP. The
Playwright spec covers this: when `total === 0`, the component returns
`null` and nothing is rendered. No empty-bar artifact.)

## Verification

### Smoke test: live styling

Open the widget in a browser, open DevTools → Elements, find the
`role="progressbar"` element. Check:

- Computed `height` is `8px` (or whatever the implementation tuned to in
  the 6-10px range).
- The element is rendered AFTER the header `<div>` in the DOM order
  (the header has class names containing the dark primary color).
- The label `<span>` text content matches the regex `/^Step - \d+\/\d+$/`.

### Walk spec

```bash
pnpm --filter @legal-chatbot/api e2e -- widget-progressbar-refinement
```

Should pass green. Run in headed slow-mo to watch:

```bash
pnpm --filter @legal-chatbot/api e2e:walk -- widget-progressbar-refinement
```

### Production deploy verification

After merging to `main` and pushing (Netlify auto-rebuilds):

```bash
E2E_BASE_URL=https://lex-bot-v0.netlify.app \
E2E_WIDGET_URL=https://lex-bot-chatbot.netlify.app \
pnpm --filter @legal-chatbot/api e2e -- widget-progressbar-refinement
```

## Done-When (Spec SC) Verification Map

| Spec SC | Quickstart step | How verified |
|---|---|---|
| SC-001 | US1 walk-through step 2 | Visible inspection — bar prominent at top |
| SC-002 | US1 walk-through step 2 | Visible inspection — 8px bar at normal viewing distance |
| SC-003 | US1 walk-through step 2 | Label text reads exactly "Step - 0/6" |
| SC-004 | US1 walk-through steps 3-4 | Bar advances 1/6 → 6/6 across the SOP |
| SC-005 | DevTools inspection | role/aria-valuenow/aria-valuemax/aria-label preserved |
| SC-006 | Bundle-size manual check | `dist/assets/index-*.js` after `pnpm --filter @legal-chatbot/widget build` — should be within ~50 bytes of pre-012 size |

## Troubleshooting

- **Bar not visible after deploy.** Hard-refresh / open in incognito —
  Vite cache hash changes per build but browsers may cache.
- **Bar visible but label says "X/Y" instead of "Step - X/Y".** Old
  bundle still loaded; clear browser cache.
- **Bar above header instead of below.** The placement change in
  `ChatPanel.tsx` didn't land — verify the relevant commit is in the
  deployed branch.

## References

- spec.md (this feature's spec)
- plan.md (this feature's implementation plan)
- contracts/progressbar-refinement-supplement.md
- research.md (decisions log)
- specs/010-sop-workflow/contracts/progress-bar-contract.md (the
  underlying 010 contract this feature supplements)
