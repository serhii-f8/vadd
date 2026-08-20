import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IntegrationChooser } from '../src/focus/IntegrationChooser.js'

describe('IntegrationChooser', () => {
  it('offers commit, keep and discard for a standard-mode objective', () => {
    render(<IntegrationChooser mode="standard" onCommand={vi.fn()} />)
    for (const name of [/commit/i, /keep/i, /discard/i]) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('hides commit for an investigation-mode objective, which has no diff', () => {
    render(<IntegrationChooser mode="investigation" onCommand={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /commit/i })).toBeNull()
    expect(screen.getByRole('button', { name: /keep/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /discard/i })).toBeTruthy()
  })
})
