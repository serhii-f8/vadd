import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Aggregate } from '../src/api.js'
import { OutcomeSummary } from '../src/focus/OutcomeSummary.js'

function aggregate(over: Partial<Aggregate> = {}): Aggregate {
  return {
    state: 'done',
    tasks: [
      {
        id: 't1',
        ord: 0,
        title: 'a',
        description: '',
        status: 'verified',
        expectFailing: null,
        startedAt: null,
        finishedAt: null,
        checkpointRef: null,
      },
      {
        id: 't2',
        ord: 1,
        title: 'b',
        description: '',
        status: 'verified',
        expectFailing: null,
        startedAt: null,
        finishedAt: null,
        checkpointRef: null,
      },
      {
        id: 't3',
        ord: 2,
        title: 'c',
        description: '',
        status: 'skipped',
        expectFailing: null,
        startedAt: null,
        finishedAt: null,
        checkpointRef: null,
      },
    ],
    decisions: [],
    evidence: [
      {
        id: 'e1',
        commandId: 'suite',
        taskId: null,
        kind: 'test',
        status: 'pass',
        headline: 'suite',
        summary: [],
        artifactPath: null,
        decidedBy: null,
        createdAt: '2026-09-05T10:00:00.000Z',
      },
      {
        id: 'e2',
        commandId: 'lint',
        taskId: null,
        kind: 'lint',
        status: 'pass',
        headline: 'lint',
        summary: [],
        artifactPath: null,
        decidedBy: null,
        createdAt: '2026-09-05T10:00:01.000Z',
      },
      {
        id: 'e3',
        commandId: null,
        taskId: null,
        kind: 'check',
        status: 'pass',
        headline: 'claim',
        summary: [],
        artifactPath: null,
        decidedBy: null,
        createdAt: '2026-09-05T10:00:02.000Z',
      },
    ],
    artifacts: [],
    pendingClarification: null,
    lastAutoApproval: null,
    lastStatus: null,
    lastAgentUpdateAt: null,
    lastProblem: null,
    worktreeMissing: false,
    objective: {
      id: 'o1',
      projectId: 'p1',
      title: 'Score History',
      goalText: 'g',
      status: 'done',
      worktreePath: null,
      branchName: 'vadd/493356bd',
      baseSha: null,
      integrateAction: 'commit',
      continuedFromId: null,
      lowEnergy: false,
      mode: 'standard',
      updatedAt: '2026-09-05T10:00:00.000Z',
    },
    ...over,
  }
}

describe('OutcomeSummary', () => {
  it('says what happened, what was proven, and where the work is', () => {
    render(<OutcomeSummary aggregate={aggregate()} />)
    const region = screen.getByRole('region', { name: 'Outcome' })
    expect(region.textContent).toContain('Done')
    expect(region.textContent).toContain('committed')
    expect(region.textContent).toContain('2/3 tasks verified')
    // Only rows with a commandId count as required; the agent's claim does not.
    expect(region.textContent).toContain('2/2 required checks')
    expect(region.textContent).toContain('vadd/493356bd')
  })

  it('reads Abandoned for a cancelled objective, and discarded for its work', () => {
    render(
      <OutcomeSummary
        aggregate={aggregate({
          state: 'cancelled',
          objective: { ...aggregate().objective, status: 'cancelled', integrateAction: 'discard' },
        })}
      />,
    )
    const region = screen.getByRole('region', { name: 'Outcome' })
    expect(region.textContent).toContain('Abandoned')
    expect(region.textContent).toContain('discarded')
  })
})
