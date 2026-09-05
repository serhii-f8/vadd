import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Aggregate } from '../src/api.js'
import { FocusHeader } from '../src/focus/FocusHeader.js'

function aggregate(over: Partial<Aggregate> = {}): Aggregate {
  return {
    state: 'awaitingDecision',
    tasks: [],
    decisions: [],
    evidence: [],
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
      status: 'awaitingDecision',
      worktreePath: '/home/u/.vadd/worktrees/p1/o1',
      branchName: 'vadd/493356bd',
      baseSha: 'deadbeef',
      integrateAction: null,
      continuedFromId: null,
      lowEnergy: false,
      mode: 'fastfix',
      updatedAt: '2026-09-05T10:00:00.000Z',
    },
    ...over,
  }
}

function renderHeader(agg = aggregate(), onCommand = vi.fn(), showActions = true) {
  render(
    <MemoryRouter>
      <FocusHeader
        aggregate={agg}
        projectName="flexpick.net"
        showActions={showActions}
        onCommand={onCommand}
      />
    </MemoryRouter>,
  )
  return onCommand
}

describe('FocusHeader', () => {
  /**
   * The defect this exists for: Back was a bare `/`, which resolved to the
   * first registered project — not the one this objective belongs to.
   */
  it('links back to this objective’s own project board, by name', () => {
    renderHeader()
    const back = screen.getByRole('link', { name: /flexpick\.net/ })
    expect(back.getAttribute('href')).toBe('/?project=p1')
    expect(screen.getByRole('link', { name: 'Objectives' }).getAttribute('href')).toBe(
      '/?project=p1',
    )
  })

  it('shows the human label beside the machine state, and the mode', () => {
    renderHeader()
    expect(screen.getByText('Waiting for your decision')).toBeTruthy()
    expect(screen.getByText('awaitingDecision')).toBeTruthy()
    expect(screen.getByText('Fast Fix')).toBeTruthy()
  })

  it('links the branch to the git console scoped to it', () => {
    renderHeader()
    expect(screen.getByRole('link', { name: /vadd\/493356bd/ }).getAttribute('href')).toBe(
      '/git?project=p1&ref=vadd%2F493356bd',
    )
  })

  it('toggles Low Energy as a switch that posts the flipped value', async () => {
    const onCommand = renderHeader()
    await userEvent.click(screen.getByRole('switch', { name: 'Low Energy Mode' }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_low_energy', value: true })
  })

  it('keeps Abandon behind the menu and its confirmation', async () => {
    const onCommand = renderHeader()
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Abandon objective/ }))
    expect(onCommand).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Abandon objective' }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'abandon' })
  })

  it('offers neither Pause nor Abandon where the caller says so', async () => {
    renderHeader(aggregate({ state: 'done' }), vi.fn(), false)
    expect(screen.queryByRole('button', { name: /pause/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(await screen.findByRole('menuitem', { name: /Raw transcript/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Abandon/ })).toBeNull()
  })
})
