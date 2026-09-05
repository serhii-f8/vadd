import { describe, expect, it } from 'vitest'
import type { ObjectiveListRow } from '../src/api.js'
import { groupObjectives } from '../src/objectives/group-objectives.js'

const row = (id: string, status: string, updatedAt = '2026-09-05T10:00:00.000Z') =>
  ({
    id,
    projectId: 'p1',
    title: id,
    goalText: 'g',
    status,
    worktreePath: null,
    branchName: null,
    baseSha: null,
    integrateAction: null,
    continuedFromId: null,
    lowEnergy: false,
    mode: 'standard',
    updatedAt,
    verifiedCount: 0,
    totalCount: 0,
  }) as ObjectiveListRow

describe('groupObjectives', () => {
  it('orders needs-you, working, paused, finished and omits empty groups', () => {
    const groups = groupObjectives([
      row('done', 'done'),
      row('run', 'executing'),
      row('ask', 'awaitingDecision'),
      row('dead', 'failed'),
    ])
    expect(groups.map((g) => g.label)).toEqual(['Needs you', 'Working', 'Finished'])
    expect(groups[2]?.rows.map((r) => r.id)).toEqual(['done', 'dead'])
  })

  it('puts paused under Needs you (it is an attention tone) and idle under Not started', () => {
    const groups = groupObjectives([row('a', 'paused'), row('b', 'idle'), row('c', 'creating')])
    expect(groups.map((g) => g.label)).toEqual(['Needs you', 'Not started'])
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(['a'])
    expect(groups[1]?.rows).toHaveLength(2)
  })

  it('sorts newest first within a group', () => {
    const groups = groupObjectives([
      row('old', 'executing', '2026-09-01T00:00:00.000Z'),
      row('new', 'executing', '2026-09-05T00:00:00.000Z'),
    ])
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(['new', 'old'])
  })

  it('returns nothing for nothing', () => {
    expect(groupObjectives([])).toEqual([])
  })
})
