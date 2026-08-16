import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Integration suites share one Postgres and truncate between files, so they must not
    // interleave. Correctness here is worth more than a few saved seconds.
    fileParallelism: false,
  },
});
