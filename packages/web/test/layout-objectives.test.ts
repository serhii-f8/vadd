import { describe, expect, it } from 'vitest'
import type { ObjectiveListRow } from '../src/api.js'
import {
  layoutObjectives,
  NODE_HEIGHT,
  ROW_HEIGHT,
  TONE_ORDER,
} from '../src/map/layout-objectives.js'

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

/**
 * The map lays nodes out on a fixed vertical grid, so a card that renders
 * taller than its slot overlaps the one below it. Seen on 2026-09-08: an
 * investigation objective's chip row wraps to two lines, measuring 116px in a
 * real browser against a 96px `ROW_HEIGHT` — the card below it was covered by
 * 20px. Both constants live in one module so they cannot drift apart again.
 */
describe('map row spacing', () => {
  it('leaves a gap between a full-height node and the next row', () => {
    expect(ROW_HEIGHT).toBeGreaterThan(NODE_HEIGHT)
  })

  it('is tall enough for a node whose chip row wraps to two lines', () => {
    // Measured in Chrome at 1440px: 92px with one chip line, 116px with two.
    expect(NODE_HEIGHT).toBeGreaterThanOrEqual(116)
  })
})
