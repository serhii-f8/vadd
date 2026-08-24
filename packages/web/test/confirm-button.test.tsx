import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmButton } from '../src/git/ConfirmButton.js'

describe('ConfirmButton', () => {
  it('does not fire on the first click', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Drop commit" confirmLabel="Really drop?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Drop commit' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('fires on the second click', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Drop commit" confirmLabel="Really drop?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Drop commit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Really drop?' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('reverts to the unconfirmed label when it loses focus', async () => {
    const onConfirm = vi.fn()
    render(
      <>
        <ConfirmButton label="Drop commit" confirmLabel="Really drop?" onConfirm={onConfirm} />
        <button type="button">elsewhere</button>
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Drop commit' }))
    // Armed first, asserted here: without this the closing assertion holds
    // vacuously against a button that never changes its label at all.
    expect(screen.getByRole('button', { name: 'Really drop?' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    // A control left armed is a control that fires on a click the user
    // thought was their first.
    expect(screen.getByRole('button', { name: 'Drop commit' })).toBeTruthy()
  })
})
