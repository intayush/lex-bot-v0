import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Spec 017: switched from `node` to `jsdom` so the redesigned
    // PanelShell, useScrollLock, and usePanelLayout (all of which need
    // a real DOM, body style mutations, animationend events, focus,
    // and window listeners) can be unit-tested. The pre-017 node-env
    // tests (e.g. QuickReplies returning React.createElement output as
    // a tree) continue to work under jsdom — jsdom is a superset.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
