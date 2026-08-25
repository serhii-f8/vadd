import { expect, test } from 'vitest'
import { readProtectedGlobs } from '../src/git/protected-globs.js'

const VALID = {
  verify: { setup: [], commands: [], checks: [], timeoutSec: 600 },
  policy: { protectedGlobs: ['backend/.env*'], maxFastFixLines: 150 },
}

test('a stored spec yields its globs', () => {
  expect(readProtectedGlobs(VALID)).toEqual({ ok: true, globs: ['backend/.env*'] })
})

test('no spec at all means no globs, which is a legitimate answer', () => {
  expect(readProtectedGlobs(null)).toEqual({ ok: true, globs: [] })
  expect(readProtectedGlobs(undefined)).toEqual({ ok: true, globs: [] })
})

test('a spec that is present but unreadable is NOT "no globs"', () => {
  // The exact shape that produced the fail-open in the hand-verification run:
  // `setup`/`commands`/`checks` at the top level rather than nested under
  // `verify`. It parsed as a failure, the globs became `[]`, and a protected
  // `.env.local` was committed reporting `excludedPaths: []` — indistinguish-
  // able on screen from an exclusion that ran and found nothing.
  const read = readProtectedGlobs({ setup: [], commands: [], checks: [] })
  expect(read.ok).toBe(false)
  if (read.ok) throw new Error('unreachable')
  expect(read.reason).toMatch(/verification spec/i)
})

test('a spec whose policy is unreadable is refused rather than emptied', () => {
  const read = readProtectedGlobs({
    verify: { setup: [], commands: [], checks: [], timeoutSec: 600 },
    policy: { protectedGlobs: 'backend/.env*' },
  })
  expect(read.ok).toBe(false)
})
