import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Integration suites share one Postgres and truncate between files (see
    // packages/db/vitest.config.ts for the reasoning).
    fileParallelism: false,
  },
});
