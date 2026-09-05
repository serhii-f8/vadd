import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { RowActions } from '../src/git/RowActions.js'

describe('RowActions', () => {
  it('keeps its children out of the tree until opened, and says so', async () => {
    render(
      <RowActions name="main">
        <button type="button">Push</button>
      </RowActions>,
    )
    const toggle = screen.getByRole('button', { name: 'Actions for main' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Push' })).toBeNull()

    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('group', { name: 'main actions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Push' })).toBeTruthy()

    await userEvent.click(toggle)
    expect(screen.queryByRole('button', { name: 'Push' })).toBeNull()
  })
})
