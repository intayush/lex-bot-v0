# Contract: Design Tokens

The redesigned widget exposes a public set of CSS custom properties
that embedding firms MAY override on the `.lc-widget` or any ancestor
element. Internal tokens are documented but are not part of the v1
public override surface; their names MAY change in a future release
without a major version bump.

## Public Tokens (override-safe)

These were already public before spec 017 and MUST remain backwards-
compatible. The defaults change in 017 (warmer palette) but the
override contract is unchanged.

```css
.lc-widget {
  /* Used in: bubble bg, user message bg, focused input ring, chip
     selected bg, primary button. Default: warm indigo (was navy). */
  --lc-primary-color: #4338CA;

  /* Text on --lc-primary-color. Default: white. */
  --lc-primary-text: #ffffff;

  /* Panel solid background (used as fallback when backdrop-filter
     is unsupported, and as the base layer that --lc-surface is
     composed over). Default: warm off-white (was pure white). */
  --lc-background: #fcfaf5;

  /* Panel corner radius on tablet/desktop. Default: 20px (was 12px). */
  --lc-border-radius: 20px;

  /* Panel + page font family. Default: system stack. */
  --lc-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                    Roboto, Inter, sans-serif;
}
```

### Override compatibility rules

- An embedding firm overriding ONLY `--lc-primary-color` MUST get a
  usable, contrast-passing panel. Tested with three sample
  overrides (navy `#0F2447`, forest `#1F4030`, plum `#5C2A52`).
- An embedding firm overriding `--lc-background` to a darker value
  MUST still get a readable panel; the implementation pairs each
  background with a sensible foreground via media-query / CSS
  variables, OR documents that overriding `--lc-background` to a
  dark color requires also overriding `--lc-text-primary`.
  *Decision*: document the dark-background case in the README; do
  not auto-detect contrast in CSS.
- Overriding `--lc-border-radius` to `0` MUST produce a
  square-cornered panel without breaking layout.

## Internal Tokens (not public, may change)

These tokens are introduced by spec 017 and live entirely inside
`packages/widget/src/styles/panel.css`. They are documented here so
that future contributors can read them, but they are not part of the
override surface promised to embedding customers.

```css
.lc-panel {
  --lc-surface: rgba(252, 250, 245, 0.72);
  --lc-surface-fallback: rgba(252, 250, 245, 0.96);
  --lc-surface-blur: blur(20px) saturate(180%);
  --lc-shadow: 0 8px 40px rgba(20, 16, 8, 0.16);
  --lc-message-radius: 16px;
  --lc-panel-radius: 20px;
  --lc-text-primary: #1f1b16;
  --lc-text-muted: #65604f;
  --lc-message-bg-assistant: #f5f1e8;
  --lc-border-subtle: rgba(31, 27, 22, 0.06);
  --lc-panel-anim-distance: 100%;
  --lc-panel-anim-duration: 320ms;
  --lc-panel-anim-easing: cubic-bezier(0.16, 1, 0.3, 1);
}

@media (prefers-reduced-motion: reduce) {
  .lc-panel {
    --lc-panel-anim-duration: 0ms;
  }
}

@supports not (backdrop-filter: blur(1px)) {
  .lc-panel {
    --lc-surface: var(--lc-surface-fallback);
    --lc-surface-blur: none;
  }
}
```

## Removed / Deprecated

None. No previously-public token is removed in this spec.

## Test Contract

A token-snapshot test in `panel.test.tsx`:

1. Mount `PanelShell` with default props.
2. Read the computed style of the root element.
3. Assert each public token has a value equal to the documented
   default.
4. Re-mount with an inline `style={{ '--lc-primary-color': '#0F2447' }}`
   wrapper; assert the override is honored.

