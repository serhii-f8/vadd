import { describe, expect, it } from 'vitest'
import { currentRequired, type EvidenceRow, groupEvidence } from '../src/evidence/group.js'

function row(over: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: over.id ?? 'e1',
    commandId: over.commandId ?? null,
    taskId: over.taskId ?? null,
    kind: over.kind ?? 'test',
    status: over.status ?? 'pass',
    headline: over.headline ?? 'ok',
    summary: over.summary ?? [],
    artifactPath: over.artifactPath ?? null,
    decidedBy: over.decidedBy ?? null,
    createdAt: over.createdAt ?? '2026-08-16T10:00:00.000Z',
  }
}

describe('groupEvidence', () => {
  it('counts a row with a commandId as required', () => {
    const { required, advisory } = groupEvidence([row({ id: 'a', commandId: 'test' })])
    expect(required.map((r) => r.id)).toEqual(['a'])
    expect(advisory).toEqual([])
  })

  it('counts an agent-emitted row with no commandId as advisory', () => {
    const { required, advisory } = groupEvidence([row({ id: 'b', commandId: null })])
    expect(required).toEqual([])
    expect(advisory.map((r) => r.id)).toEqual(['b'])
  })

  it('lifts every warn row into warnings, whatever its commandId', () => {
    const { warnings, required, advisory } = groupEvidence([
      row({ id: 'w1', status: 'warn', commandId: 'lint' }),
      row({ id: 'w2', status: 'warn', commandId: null }),
    ])
    expect(warnings.map((r) => r.id).sort()).toEqual(['w1', 'w2'])
    expect(required).toEqual([])
    expect(advisory).toEqual([])
  })

  it('keeps only the most recent row per checkId, so an untick supersedes', () => {
    const { required } = groupEvidence([
      row({
        id: 'old',
        kind: 'check',
        commandId: 'check-0',
        status: 'pass',
        createdAt: '2026-08-16T10:00:00.000Z',
      }),
      row({
        id: 'new',
        kind: 'check',
        commandId: 'check-0',
        status: 'fail',
        createdAt: '2026-08-16T11:00:00.000Z',
      }),
    ])
    expect(required.map((r) => r.id)).toEqual(['new'])
    expect(required[0]?.status).toBe('fail')
  })

  it('does not collapse two rows for different commands', () => {
    const { required } = groupEvidence([
      row({ id: 'a', commandId: 'test', createdAt: '2026-08-16T10:00:00.000Z' }),
      row({ id: 'b', commandId: 'lint', createdAt: '2026-08-16T11:00:00.000Z' }),
    ])
    expect(required.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('does not collapse non-check rows sharing a commandId — reruns are history', () => {
    const { required } = groupEvidence([
      row({ id: 'run1', kind: 'test', commandId: 'test', createdAt: '2026-08-16T10:00:00.000Z' }),
      row({ id: 'run2', kind: 'test', commandId: 'test', createdAt: '2026-08-16T11:00:00.000Z' }),
    ])
    expect(required.map((r) => r.id).sort()).toEqual(['run1', 'run2'])
  })

  it('orders every group newest first', () => {
    const { required } = groupEvidence([
      row({ id: 'a', commandId: 'test', createdAt: '2026-08-16T10:00:00.000Z' }),
      row({ id: 'b', commandId: 'lint', createdAt: '2026-08-16T12:00:00.000Z' }),
    ])
    expect(required.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('handles an empty set without inventing groups', () => {
    expect(groupEvidence([])).toEqual({ required: [], advisory: [], warnings: [] })
  })

  it('currentRequired keeps one row per commandId, the newest', () => {
    const row = (
      id: string,
      commandId: string,
      status: 'pass' | 'fail',
      createdAt: string,
    ): EvidenceRow => ({
      id,
      commandId,
      taskId: null,
      kind: 'test',
      status,
      headline: id,
      summary: [],
      artifactPath: null,
      decidedBy: null,
      createdAt,
    })
    const { required } = groupEvidence([
      row('old-red', 'suite', 'fail', '2026-09-05T10:00:00.000Z'),
      row('new-green', 'suite', 'pass', '2026-09-05T11:00:00.000Z'),
      row('lint', 'lint', 'pass', '2026-09-05T10:30:00.000Z'),
    ])
    // History keeps both suite runs; the current set has one, and it is green.
    expect(required).toHaveLength(3)
    expect(
      currentRequired(required)
        .map((r) => r.id)
        .sort(),
    ).toEqual(['lint', 'new-green'])
  })
})
