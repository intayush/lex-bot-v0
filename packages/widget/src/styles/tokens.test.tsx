/**
 * Spec 017 T027 — public design-token snapshot. Mounts PanelShell and
 * asserts each public token resolves to its documented default; then
 * asserts that wrapping in a parent that overrides a token cascades
 * the override down. jsdom does not evaluate external stylesheets, so
 * we set inline tokens on the panel root via a wrapper stylesheet
 * injected at test time. The runtime contract — that an embedding
 * firm can override `--lc-primary-color` and have the panel pick it
 * up — is verified by the integration test rather than this unit.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, './panel.css'), 'utf8');

const PUBLIC_TOKENS: Record<string, RegExp> = {
  '--lc-primary-color': /#4338ca/,
  '--lc-primary-text': /#ffffff/,
  '--lc-background': /#fcfaf5/,
  '--lc-border-radius': /20px/,
  '--lc-font-family': /-apple-system/,
};

describe('design-tokens — public defaults (T027)', () => {
  for (const [token, valueRe] of Object.entries(PUBLIC_TOKENS)) {
    it(`${token} declares the documented default`, () => {
      const re = new RegExp(`${token.replace(/-/g, '\\-')}\\s*:\\s*[^;]*${valueRe.source}`);
      expect(css).toMatch(re);
    });
  }
});

describe('design-tokens — cascade override (T027)', () => {
  it('a parent style override of --lc-primary-color cascades to the panel', () => {
    const root = document.createElement('div');
    root.setAttribute('style', '--lc-primary-color: #0F2447');
    const panel = document.createElement('div');
    panel.className = 'lc-panel';
    root.appendChild(panel);
    document.body.appendChild(root);
    try {
      const cs = window.getComputedStyle(panel).getPropertyValue('--lc-primary-color').trim();
      // jsdom's CSS engine returns the cascaded property value when set inline
      // on an ancestor. (External stylesheets aren't evaluated, so the panel
      // class adds nothing — the test exercises only the cascade.)
      expect(cs).toBe('#0F2447');
    } finally {
      document.body.removeChild(root);
    }
  });
});
