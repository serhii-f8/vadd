import { expect, test } from 'vitest'
import { classifyTaskRisk } from '../src/policies/risk-policy.js'

const POLICY = { protectedGlobs: [], maxLines: 150 }

function diff(over: Partial<Parameters<typeof classifyTaskRisk>[0]> = {}) {
  return {
    changedFiles: ['src/foo.ts'],
    insertions: 10,
    deletions: 2,
    exportLinesRemoved: null,
    exportLinesAdded: null,
    ...over,
  }
}

test('an ordinary small diff is low risk', () => {
  expect(classifyTaskRisk(diff(), POLICY)).toBe('low')
})

test('touching a migrations directory is high risk, even with no configured protectedGlobs', () => {
  expect(
    classifyTaskRisk(diff({ changedFiles: ['backend/migrations/2026_01_01_add_col.php'] }), POLICY),
  ).toBe('high')
})

test('touching a .sql file is high risk', () => {
  expect(classifyTaskRisk(diff({ changedFiles: ['db/seed.sql'] }), POLICY)).toBe('high')
})

test('a user-configured protectedGlobs entry is honored on top of the defaults', () => {
  const policy = { protectedGlobs: ['**/*.env*'], maxLines: 150 }
  expect(classifyTaskRisk(diff({ changedFiles: ['backend/.env.testing'] }), policy)).toBe('high')
  // The default-only case: the same path is fine without that glob configured.
  expect(classifyTaskRisk(diff({ changedFiles: ['backend/.env.testing'] }), POLICY)).toBe('low')
})

test('touching a lockfile is high risk', () => {
  expect(classifyTaskRisk(diff({ changedFiles: ['pnpm-lock.yaml'] }), POLICY)).toBe('high')
  expect(classifyTaskRisk(diff({ changedFiles: ['backend/composer.lock'] }), POLICY)).toBe('high')
})

test('touching a dependency manifest is high risk, even without a lockfile change', () => {
  expect(classifyTaskRisk(diff({ changedFiles: ['package.json'] }), POLICY)).toBe('high')
})

test('a diff over the line cap is high risk', () => {
  expect(classifyTaskRisk(diff({ insertions: 100, deletions: 60 }), POLICY)).toBe('high')
})

test('a diff at exactly the line cap is not over it', () => {
  expect(classifyTaskRisk(diff({ insertions: 100, deletions: 50 }), POLICY)).toBe('low')
})

test('deleting more export lines than were added is high risk', () => {
  expect(classifyTaskRisk(diff({ exportLinesRemoved: 2, exportLinesAdded: 0 }), POLICY)).toBe(
    'high',
  )
})

test('adding at least as many export lines as removed is low risk', () => {
  expect(classifyTaskRisk(diff({ exportLinesRemoved: 1, exportLinesAdded: 1 }), POLICY)).toBe('low')
})

test('a language with no export-line detector does not fail the export check', () => {
  // Both null (e.g. a PHP-only diff): the rule does not apply, not "fails closed".
  expect(classifyTaskRisk(diff({ exportLinesRemoved: null, exportLinesAdded: null }), POLICY)).toBe(
    'low',
  )
})
