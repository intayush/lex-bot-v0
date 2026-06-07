/**
 * Spec 017 T014 / T025 — panel.css contract assertions.
 *
 * jsdom does NOT evaluate external stylesheets — `getComputedStyle` on
 * an element only reflects inline styles. We therefore verify the CSS
 * file as text: parse it as a string and assert that the documented
 * declarations exist within the relevant breakpoint blocks. This is a
 * code-review-grade check; the runtime behavior is verified by the
 * Playwright E2E spec at three viewport presets (T048).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, './panel.css');
const css = readFileSync(cssPath, 'utf8');

function block(selector: string): string {
  // Find the rule-block whose selector exactly matches `selector`. We
  // accept whitespace and a trailing `{` immediately after the selector
  // and capture up to the matching `}`. Nested braces don't appear in
  // panel.css so a non-greedy [^}]* is safe.
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*{([^}]*)}`,
  );
  const m = css.match(re);
  if (!m) {
    throw new Error(`Selector not found in panel.css: ${selector}`);
  }
  return m[1];
}

describe('panel.css — mobile breakpoint (T014)', () => {
  const decls = block(`.lc-panel\\[data-breakpoint='mobile'\\]`);

  it('inset is 0 (flush with viewport edges)', () => {
    expect(decls).toMatch(/inset\s*:\s*0/);
  });

  it('width is 100vw', () => {
    expect(decls).toMatch(/width\s*:\s*100vw/);
  });

  it('height uses 100dvh with a 100vh fallback', () => {
    expect(decls).toMatch(/height\s*:\s*100dvh/);
    expect(decls).toMatch(/max-height\s*:\s*100vh/);
  });

  it('border-radius is 0 (flush corners)', () => {
    expect(decls).toMatch(/border-radius\s*:\s*0/);
  });

  it('z-index is 2147483646 (above host overlays per research § R12)', () => {
    expect(decls).toMatch(/z-index\s*:\s*2147483646/);
  });
});

describe('panel.css — public design tokens (T002)', () => {
  // Public tokens live on `:root` (not `.lc-panel`) so that an
  // embedding host can override them by setting the same custom
  // property on a parent element of the panel — declaring them on
  // `.lc-panel` itself shadowed parent overrides because the panel's
  // own declaration was the closest definition the cascade saw.
  const rootBlock = block(':root');
  const panelBlock = block('\\.lc-panel');

  it('declares --lc-primary-color default #4338ca on :root', () => {
    expect(rootBlock).toMatch(/--lc-primary-color\s*:\s*#4338ca/);
  });

  it('declares --lc-background default #fcfaf5 on :root', () => {
    expect(rootBlock).toMatch(/--lc-background\s*:\s*#fcfaf5/);
  });

  it('declares --lc-border-radius default 20px on :root', () => {
    expect(rootBlock).toMatch(/--lc-border-radius\s*:\s*20px/);
  });

  it('declares --lc-panel-anim-duration default 320ms on .lc-panel (internal token)', () => {
    expect(panelBlock).toMatch(/--lc-panel-anim-duration\s*:\s*320ms/);
  });

  it('does NOT redeclare public tokens on .lc-panel (would shadow parent overrides)', () => {
    expect(panelBlock).not.toMatch(/--lc-primary-color\s*:/);
    expect(panelBlock).not.toMatch(/--lc-primary-bg\s*:/);
    expect(panelBlock).not.toMatch(/--lc-background\s*:\s*#/);
    expect(panelBlock).not.toMatch(/--lc-border-radius\s*:/);
  });
});

describe('panel.css — reduced-motion + backdrop-filter fallback (T002)', () => {
  it('@media (prefers-reduced-motion: reduce) sets duration to 0ms', () => {
    expect(css).toMatch(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)[\s\S]*?--lc-panel-anim-duration\s*:\s*0ms/,
    );
  });

  it('@supports not (backdrop-filter) swaps surface to fallback and disables blur', () => {
    expect(css).toMatch(
      /@supports\s+not\s*\(backdrop-filter[^)]+\)[\s\S]*?--lc-surface\s*:\s*var\(--lc-surface-fallback\)/,
    );
    expect(css).toMatch(
      /@supports\s+not\s*\(backdrop-filter[^)]+\)[\s\S]*?--lc-surface-blur\s*:\s*none/,
    );
  });
});

describe('panel.css — desktop breakpoint (T025)', () => {
  const decls = block(`.lc-panel\\[data-breakpoint='desktop'\\]`);

  it('width is exactly 480px', () => {
    expect(decls).toMatch(/width\s*:\s*480px/);
  });

  it('height is exactly 760px', () => {
    expect(decls).toMatch(/height\s*:\s*760px/);
  });

  it('floats with 24px right + bottom edge padding', () => {
    expect(decls).toMatch(/right\s*:\s*24px/);
    expect(decls).toMatch(/bottom\s*:\s*24px/);
  });

  it('rounds corners using the panel-radius token', () => {
    expect(decls).toMatch(/border-radius\s*:\s*var\(--lc-panel-radius/);
  });

  it('casts a soft shadow', () => {
    expect(decls).toMatch(/box-shadow\s*:\s*var\(--lc-shadow/);
  });
});

describe('panel.css — desktop-clamped breakpoint (T025)', () => {
  const decls = block(`.lc-panel\\[data-breakpoint='desktop-clamped'\\]`);

  it('clamps height to calc(100vh - 48px)', () => {
    expect(decls).toMatch(/height\s*:\s*calc\(100vh\s*-\s*48px\)/);
  });

  it('keeps width at 480px (matches desktop)', () => {
    expect(decls).toMatch(/width\s*:\s*480px/);
  });
});

describe('panel.css — tablet breakpoint', () => {
  const decls = block(`.lc-panel\\[data-breakpoint='tablet'\\]`);

  it('right-anchors the sheet (right: 0)', () => {
    expect(decls).toMatch(/right\s*:\s*0/);
  });

  it('rounds only the inner edges (top-left, bottom-left)', () => {
    expect(decls).toMatch(
      /border-radius\s*:\s*var\(--lc-panel-radius\)\s+0\s+0\s+var\(--lc-panel-radius\)/,
    );
  });
});

describe('panel.css — backdrop-filter fallback engaged via CSS (T026)', () => {
  it('the @supports query exists and resolves to the fallback surface', () => {
    // jsdom does not evaluate @supports, so we verify the rule exists
    // textually. The runtime behavior — that browsers without
    // backdrop-filter fall back to the near-solid surface — is a
    // browser feature, not something we can test in jsdom. The
    // Playwright spec covers visual fallback.
    expect(css).toContain('@supports not (backdrop-filter:');
    expect(css).toMatch(/--lc-surface\s*:\s*var\(--lc-surface-fallback\)/);
  });
});
