import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Decision } from '../src/api.js'
import { DecisionCard } from '../src/focus/DecisionCard.js'

function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: 'd1',
    question: 'Which approach?',
    recommendedId: 'a',
    chosenId: null,
    options: [
      {
        id: 'a',
        label: 'Option A',
        pros: ['fast'],
        cons: [],
        reversibility: 'high',
        verification: 'tests pass',
      },
      {
        id: 'b',
        label: 'Option B',
        pros: [],
        cons: ['slow', 'risky'],
        reversibility: 'low',
        verification: 'tests pass',
      },
    ],
    ...over,
  }
}

describe('DecisionCard — A16 priority score', () => {
  it('shows a priority score for each option', () => {
    render(<DecisionCard decision={decision()} onCommand={vi.fn()} />)
    // Option A: reversibility high (1.0), effort neutral (0.6), pros-cons (1-0+5)/10=0.6
    // 0.5*1.0 + 0.3*0.6 + 0.2*0.6 = 0.5 + 0.18 + 0.12 = 0.80
    expect(screen.getByText(/priority: 0\.80/i)).toBeTruthy()
    // Option B: reversibility low (0.2), effort neutral (0.6), pros-cons (0-2+5)/10=0.3
    // 0.5*0.2 + 0.3*0.6 + 0.2*0.3 = 0.10 + 0.18 + 0.06 = 0.34
    expect(screen.getByText(/priority: 0\.34/i)).toBeTruthy()
  })

  it('never includes the score in any command sent to the server', async () => {
    const onCommand = vi.fn()
    const user = userEvent.setup()
    render(<DecisionCard decision={decision()} onCommand={onCommand} />)
    await user.click(screen.getByRole('button', { name: /choose/i }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'decide', decisionId: 'd1', optionId: 'a' })
  })

  it('does not change which option is pre-selected or the options order', () => {
    render(<DecisionCard decision={decision()} onCommand={vi.fn()} />)
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['a', 'b'])
    expect(screen.getByRole('radio', { name: 'Option A' }).getAttribute('aria-checked')).toBe(
      'true',
    )
  })
})
