import { describe, expect, it } from 'vitest'
import { headlineFor } from '../src/verification/headline.js'

describe('headlineFor', () => {
  it('reads PHPUnit', () => {
    expect(headlineFor('test', 0, 'OK (12 tests, 30 assertions)\n')).toBe(
      'OK (12 tests, 30 assertions)',
    )
  })

  it('reads a vitest summary', () => {
    const out = ' Test Files  41 passed | 2 skipped (43)\n      Tests  364 passed (366)\n'
    expect(headlineFor('test', 0, out)).toContain('364 passed')
  })

  it('reads an eslint warning count', () => {
    expect(headlineFor('lint', 0, '\n3 problems (0 errors, 3 warnings)\n')).toContain('3 warnings')
  })

  it('falls back to the exit code on failure', () => {
    expect(headlineFor('build', 2, 'gibberish')).toBe('build failed — exit 2')
  })

  it('falls back to a generic pass line with no recognised summary', () => {
    expect(headlineFor('test', 0, 'done')).toBe('test passed')
  })

  it('never exceeds the contract cap of 120 characters', () => {
    expect(
      headlineFor('test', 0, `OK (${'9'.repeat(300)} tests, 1 assertions)`).length,
    ).toBeLessThanOrEqual(120)
  })
})
