import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AutoApprovalBanner } from '../src/focus/AutoApprovalBanner.js'

describe('AutoApprovalBanner', () => {
  it('renders nothing with no auto-approval', () => {
    render(<AutoApprovalBanner lastAutoApproval={null} onCommand={vi.fn()} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the banner for a task auto-approval', () => {
    render(
      <AutoApprovalBanner
        lastAutoApproval={{ kind: 'task', taskOrd: 0, at: '2026-08-18T00:00:00Z' }}
        onCommand={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/Good stopping point/i)
  })

  it('Continue dismisses the banner without sending a command', async () => {
    const onCommand = vi.fn()
    render(
      <AutoApprovalBanner
        lastAutoApproval={{ kind: 'task', taskOrd: 0, at: '2026-08-18T00:00:00Z' }}
        onCommand={onCommand}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('Stop for now dismisses the banner and sends pause', async () => {
    const onCommand = vi.fn()
    render(
      <AutoApprovalBanner
        lastAutoApproval={{ kind: 'task', taskOrd: 0, at: '2026-08-18T00:00:00Z' }}
        onCommand={onCommand}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /stop for now/i }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'pause' })
  })
})
