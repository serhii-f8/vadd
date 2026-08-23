import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BranchStrip } from '../src/focus/BranchStrip.js'

describe('BranchStrip', () => {
  it('shows the branch and worktree the objective is working in', () => {
    render(
      <MemoryRouter>
        <BranchStrip branchName="vadd/fdca5ca3" worktreePath="/home/u/.vadd/worktrees/p1/fdca" />
      </MemoryRouter>,
    )
    expect(screen.getByText('vadd/fdca5ca3')).toBeTruthy()
    expect(screen.getByText('/home/u/.vadd/worktrees/p1/fdca')).toBeTruthy()
  })

  it('links through to the console for that branch', () => {
    render(
      <MemoryRouter>
        <BranchStrip branchName="vadd/fdca5ca3" worktreePath="/tmp/wt" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /vadd\/fdca5ca3/ }).getAttribute('href')).toBe(
      '/git?ref=vadd%2Ffdca5ca3',
    )
  })

  it('renders nothing once the worktree is gone', () => {
    // `integrate: commit` and `discard` both null these columns. A strip
    // claiming a worktree that no longer exists is worse than no strip.
    //
    // Asserting `container.textContent === ''` alone cannot fail: with both
    // props null, the wrapping `<p>`'s two children are both `false`, so an
    // *unguarded* render also produces an empty `<p>` with empty text
    // content. `firstChild` distinguishes "no element at all" from "an empty
    // element" — only the real `return null` guard produces the former.
    const { container } = render(
      <MemoryRouter>
        <BranchStrip branchName={null} worktreePath={null} />
      </MemoryRouter>,
    )
    expect(container.textContent).toBe('')
    expect(container.firstChild).toBeNull()
  })
})
