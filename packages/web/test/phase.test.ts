import { describe, expect, it } from 'vitest'
import { phasesFor } from '../src/focus/phase.js'

const base = { mode: 'standard' as const, tasks: [], decisions: [], lastStatusPhase: null }
const statuses = (p: ReturnType<typeof phasesFor>) => p.map((x) => `${x.key}:${x.status}`)
const current = (p: ReturnType<typeof phasesFor>) => p.find((x) => x.status === 'current')?.key

describe('phasesFor', () => {
  it('marks phases before the current one done and after it todo', () => {
    expect(statuses(phasesFor({ ...base, state: 'executing' }))).toEqual([
      'explore:done',
      'propose:done',
      'plan:done',
      'execute:current',
      'verify:todo',
      'review:todo',
      'integrate:todo',
    ])
  })

  it('marks everything done at done', () => {
    expect(phasesFor({ ...base, state: 'done' }).every((p) => p.status === 'done')).toBe(true)
  })

  it('starts at explore before anything has happened', () => {
    expect(current(phasesFor({ ...base, state: 'idle' }))).toBe('explore')
    expect(current(phasesFor({ ...base, state: 'creating' }))).toBe('explore')
  })

  it('skips propose for a Fast Fix', () => {
    const p = phasesFor({ ...base, mode: 'fastfix', state: 'planning' })
    expect(p.find((x) => x.key === 'propose')?.status).toBe('skipped')
    expect(p.find((x) => x.key === 'plan')?.status).toBe('current')
  })

  it('labels the last phase Finish for an investigation', () => {
    expect(phasesFor({ ...base, mode: 'investigation', state: 'idle' }).at(-1)?.label).toBe(
      'Finish',
    )
    expect(phasesFor({ ...base, state: 'idle' }).at(-1)?.label).toBe('Integrate')
  })

  it('infers the phase of a paused objective from the last prompt phase first', () => {
    const p = phasesFor({
      ...base,
      state: 'paused',
      lastStatusPhase: 'verify',
      tasks: [{ status: 'verified' }],
    })
    expect(current(p)).toBe('verify')
  })

  it('falls back to the plan and decisions when paused with no status phase', () => {
    expect(current(phasesFor({ ...base, state: 'paused', tasks: [{ status: 'running' }] }))).toBe(
      'execute',
    )
    expect(current(phasesFor({ ...base, state: 'paused', tasks: [{ status: 'pending' }] }))).toBe(
      'plan',
    )
    expect(current(phasesFor({ ...base, state: 'failed', decisions: [{}] }))).toBe('propose')
    expect(current(phasesFor({ ...base, state: 'failed' }))).toBe('explore')
  })
})
