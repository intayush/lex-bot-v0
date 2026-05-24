import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Pure-JS unit tests only for now (jsdom + @testing-library/react come
    // when 010-sop-workflow T036/T048 deferred items land — at which point
    // hook tests for useSOPState, usePreflightPhrase, etc. can run too).
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
