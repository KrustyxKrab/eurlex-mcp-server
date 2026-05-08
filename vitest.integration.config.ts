import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    // Live tests hit the real SPARQL endpoint which can take 20-30 s per query
    testTimeout: 60_000,
    include: ['tests/integration/**/*.test.ts', 'tests/eval/**/*.test.ts'],
  },
});
