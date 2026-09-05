import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Decision } from '../src/api.js'
import { DecisionCard } from '../src/focus/DecisionCard.js'

const decision: Decision = {
  id: 'd1',
  question: 'How should the rounding be fixed?',
  recommendedId: 'b',
  chosenId: null,
  options: [
    {
      id: 'a',
      label: 'Round at display time',
      reversibility: 'low',
      pros: ['small'],
      cons: ['hides it'],
      verification: 'cart totals test',
    },
    {
      id: 'b',
      label: 'Use integer cents',
      reversibility: 'high',
      effort: 'M',
      pros: ['correct'],
      cons: ['migration'],
      verification: 'full suite',
    },
  ],
}

describe('DecisionCard actions', () => {
  it('approves the recommendation in one click', async () => {
    const onCommand = vi.fn()
    render(<DecisionCard decision={decision} onCommand={onCommand} />)
    await userEvent.click(screen.getByRole('button', { name: 'Approve recommended' }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'decide', decisionId: 'd1', optionId: 'b' })
  })

  it('approve recommended sends the recommendation even when another option is selected', async () => {
    const onCommand = vi.fn()
    render(<DecisionCard decision={decision} onCommand={onCommand} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Round at display time' }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve recommended' }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'decide', decisionId: 'd1', optionId: 'b' })
  })

  it('still allows choosing a different option', async () => {
    const onCommand = vi.fn()
    render(<DecisionCard decision={decision} onCommand={onCommand} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Round at display time' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose selected' }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'decide', decisionId: 'd1', optionId: 'a' })
  })

  it('offers pause, which §8 lists and the card never had', async () => {
    const onCommand = vi.fn()
    render(<DecisionCard decision={decision} onCommand={onCommand} />)
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'pause' })
  })

  it('keeps the reversibility badge visible on every option', () => {
    render(<DecisionCard decision={decision} onCommand={() => undefined} />)
    expect(screen.getByText('reversibility: low')).toBeTruthy()
    expect(screen.getByText('reversibility: high')).toBeTruthy()
  })
})
