import { MACHINE_STATES } from '@vadd/core'
import { expect, test } from 'vitest'
import { gateForStatus } from '../src/git/mutation-gate.js'

/** Spec §3: the six that have something writing into the worktree. */
const BUSY = ['executing', 'revising', 'verifying', 'rollingBack', 'integrating', 'creating']

test('every busy state is refused, and the reason names it', () => {
  for (const status of BUSY) {
    const verdict = gateForStatus(status)
    expect(verdict.allowed, `${status} must be refused`).toBe(false)
    if (verdict.allowed) throw new Error('unreachable')
    expect(verdict.reason).toContain(status)
  }
})

test('every other machine state is permitted', () => {
  for (const status of MACHINE_STATES) {
    if (BUSY.includes(status)) continue
    expect(gateForStatus(status).allowed, `${status} must be permitted`).toBe(true)
  }
})

test('setup_failed is permitted', () => {
  // Not a machine state — a deliberately permanent objectives.status that
  // owns the evidence_items row carrying the failure log. Nothing is
  // writing to the worktree in it.
  expect(gateForStatus('setup_failed').allowed).toBe(true)
})

test('an unrecognised status fails CLOSED', () => {
  // Drizzle types `objectives.status` as a bare `string`, so a value this
  // map has never seen reaches the gate at the type level. Permitting it
  // would run a mutation against a worktree in an unknown condition.
  const verdict = gateForStatus('some-future-status')
  expect(verdict.allowed).toBe(false)
  if (verdict.allowed) throw new Error('unreachable')
  expect(verdict.reason).toMatch(/unrecognised|unknown/i)
})

test('the map is total over MACHINE_STATES', () => {
  // Guards against a state being added to the machine and silently falling
  // through to the unknown branch, which would refuse every mutation on it
  // for no stated reason.
  for (const status of MACHINE_STATES) {
    const verdict = gateForStatus(status)
    if (!verdict.allowed) expect(verdict.reason).not.toMatch(/unrecognised|unknown/i)
  }
})
