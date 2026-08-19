import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  test: {
    // Explicit root: without it, vitest's project `include` globs (which are
    // written repo-root-relative, e.g. `packages/{core,server,cli}/test/**`)
    // resolve against `process.cwd()` instead, so `pnpm --filter @vadd/cli
    // vitest run ...` (cwd = packages/cli) silently matched nothing.
    root: rootDir,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Two projects rather than one glob: the web package needs jsdom and a
    // setup file, and `environmentMatchGlobs` was removed in Vitest 4.
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/{core,server,cli}/test/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        // `@` mirrors packages/web/vite.config.ts's own alias and
        // packages/web/tsconfig.json's `paths` — shadcn/ui components import
        // `@/lib/utils` and this project runs those files directly rather
        // than through Vite's dev/build config, so without this alias every
        // shadcn component fails to resolve under Vitest even though `tsc`
        // and `vite build` both see it fine.
        resolve: {
          alias: { '@': fileURLToPath(new URL('./packages/web/src', import.meta.url)) },
        },
        test: {
          name: 'web',
          // Both extensions: a `.test.ts` here (a pure-logic helper test with
          // no JSX) was silently uncollected, and an uncollected suite is green
          // by not running.
          include: ['packages/web/test/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['packages/web/test/setup.ts'],
        },
      },
    ],
  },
})
