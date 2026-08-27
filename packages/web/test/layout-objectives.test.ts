import { describe, expect, it } from 'vitest'
import type { ObjectiveListRow } from '../src/api.js'
import { layoutObjectives, TONE_ORDER } from '../src/map/layout-objectives.js'

function row(over: Partial<ObjectiveListRow> = {}): ObjectiveListRow {
  return {
    id: 'o1',
    projectId: 'p1',
    title: 'Fix login',
    goalText: 'g',
    status: 'executing',
    worktreePath: null,
    branchName: null,
    baseSha: null,
    integrateAction: null,
    continuedFromId: null,
    lowEnergy: false,
    mode: 'standard',
    updatedAt: '2026-08-22T10:00:00.000Z',
    verifiedCount: 0,
    totalCount: 0,
    ...over,
  }
}

describe('layoutObjectives', () => {
  it('returns an empty list for no objectives', () => {
    expect(layoutObjectives([])).toEqual([])
  })

  it('assigns each objective to its status-tone column', () => {
    const objectives = [
      row({ id: 'a', status: 'idle' }),
      row({ id: 'b', status: 'executing' }), // active
      row({ id: 'c', status: 'paused' }), // attention
      row({ id: 'd', status: 'done' }),
      row({ id: 'e', status: 'failed' }),
    ]
    const mapped = layoutObjectives(objectives)
    const columnOf = (id: string) => mapped.find((m) => m.id === id)?.column
    expect(columnOf('a')).toBe('idle')
    expect(columnOf('b')).toBe('active')
    expect(columnOf('c')).toBe('attention')
    expect(columnOf('d')).toBe('done')
    expect(columnOf('e')).toBe('failed')
  })

  it('orders objectives within a column by most-recently-updated first', () => {
    const objectives = [
      row({ id: 'old', status: 'idle', updatedAt: '2026-08-01T00:00:00.000Z' }),
      row({ id: 'new', status: 'idle', updatedAt: '2026-08-20T00:00:00.000Z' }),
    ]
    const mapped = layoutObjectives(objectives)
    const idleRows = mapped.filter((m) => m.column === 'idle')
    expect(idleRows.map((m) => m.id)).toEqual(['new', 'old'])
    expect(idleRows.map((m) => m.row)).toEqual([0, 1])
  })

  it('gives every objective a row index scoped to its own column, not global', () => {
    const objectives = [row({ id: 'a', status: 'idle' }), row({ id: 'b', status: 'done' })]
    const mapped = layoutObjectives(objectives)
    expect(mapped.find((m) => m.id === 'a')?.row).toBe(0)
    expect(mapped.find((m) => m.id === 'b')?.row).toBe(0)
  })

  it('exports column order matching StatusTone declaration order', () => {
    expect(TONE_ORDER).toEqual(['idle', 'active', 'attention', 'done', 'failed'])
  })
})
