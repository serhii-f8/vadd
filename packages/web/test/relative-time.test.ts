import { describe, expect, it } from 'vitest'
import { relativeTime } from '../src/lib/relative-time.js'

const now = Date.parse('2026-09-05T12:00:00.000Z')
const ago = (ms: number) => new Date(now - ms).toISOString()

describe('relativeTime', () => {
  it('reads as now under a minute', () => {
    expect(relativeTime(ago(20_000), now)).toBe('now')
  })
  it('counts minutes under an hour', () => {
    expect(relativeTime(ago(3 * 60_000), now)).toBe('3 min ago')
  })
  it('counts hours under a day', () => {
    expect(relativeTime(ago(2 * 3_600_000), now)).toBe('2 h ago')
  })
  it('says yesterday between one and two days', () => {
    expect(relativeTime(ago(30 * 3_600_000), now)).toBe('yesterday')
  })
  it('falls back to a short date beyond that', () => {
    expect(relativeTime('2026-08-17T17:14:20.533Z', now)).toBe('Aug 17')
  })
  it('never goes negative on clock skew', () => {
    expect(relativeTime(ago(-5_000), now)).toBe('now')
  })

  it('has a short form for dense columns', () => {
    expect(relativeTime(ago(58 * 60_000), now, { short: true })).toBe('58m')
    expect(relativeTime(ago(2 * 3_600_000), now, { short: true })).toBe('2h')
    expect(relativeTime(ago(30 * 3_600_000), now, { short: true })).toBe('1d')
    expect(relativeTime(ago(20_000), now, { short: true })).toBe('now')
  })
})
