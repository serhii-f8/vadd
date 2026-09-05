import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PhaseStepper } from '../src/focus/PhaseStepper.js'
import { phasesFor } from '../src/focus/phase.js'

const base = { mode: 'standard' as const, tasks: [], decisions: [], lastStatusPhase: null }

describe('PhaseStepper', () => {
  it('renders the seven phases with their status and marks the current step', () => {
    render(<PhaseStepper phases={phasesFor({ ...base, state: 'verifying' })} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(7)
    expect(items.map((li) => li.getAttribute('data-status'))).toEqual([
      'done',
      'done',
      'done',
      'done',
      'current',
      'todo',
      'todo',
    ])
    expect(items[4]?.getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('Verify')).toBeTruthy()
  })

  it('keeps only the current label visible when compact, but all in the tree', () => {
    render(<PhaseStepper phases={phasesFor({ ...base, state: 'executing' })} compact />)
    expect(screen.getByText('Execute').className).not.toContain('sr-only')
    expect(screen.getByText('Explore').className).toContain('sr-only')
  })

  it('names a skipped phase as skipped for assistive technology', () => {
    render(<PhaseStepper phases={phasesFor({ ...base, mode: 'fastfix', state: 'planning' })} />)
    expect(screen.getAllByRole('listitem')[1]?.textContent).toContain('skipped')
  })
})
