import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Two projects rather than one glob: the web package needs jsdom and a
    // setup file, and `environmentMatchGlobs` was removed in Vitest 4.
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/{core,server}/test/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'web',
          include: ['packages/web/test/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['packages/web/test/setup.ts'],
        },
      },
    ],
  },
})
