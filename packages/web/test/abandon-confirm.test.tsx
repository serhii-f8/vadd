import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AbandonButton } from '../src/focus/AbandonButton.js'

describe('AbandonButton', () => {
  it('sends nothing on the first click', async () => {
    const onConfirm = vi.fn()
    render(<AbandonButton title="Fix the rounding" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abandon' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('names the objective and its consequence in the confirmation', async () => {
    render(<AbandonButton title="Fix the rounding" onConfirm={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abandon' }))
    expect(await screen.findByText(/Fix the rounding/)).toBeTruthy()
    expect(screen.getByText(/cannot be resumed/i)).toBeTruthy()
  })

  it('sends only after confirmation', async () => {
    const onConfirm = vi.fn()
    render(<AbandonButton title="Fix the rounding" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abandon' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Abandon objective' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the confirmation is cancelled', async () => {
    const onConfirm = vi.fn()
    render(<AbandonButton title="Fix the rounding" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abandon' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Keep working' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
