import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BranchStrip } from '../src/focus/BranchStrip.js'

describe('BranchStrip', () => {
  it('shows the branch and worktree the objective is working in', () => {
    render(
      <MemoryRouter>
        <BranchStrip
          projectId="p1"
          branchName="vadd/fdca5ca3"
          worktreePath="/home/u/.vadd/worktrees/p1/fdca"
          worktreeMissing={false}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('vadd/fdca5ca3')).toBeTruthy()
    expect(screen.getByText('/home/u/.vadd/worktrees/p1/fdca')).toBeTruthy()
  })

  it("links through to the console for that branch, scoped to the objective's project", () => {
    render(
      <MemoryRouter>
        <BranchStrip
          projectId="p1"
          branchName="vadd/fdca5ca3"
          worktreePath="/tmp/wt"
          worktreeMissing={false}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /vadd\/fdca5ca3/ }).getAttribute('href')).toBe(
      '/git?project=p1&ref=vadd%2Ffdca5ca3',
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
        <BranchStrip projectId="p1" branchName={null} worktreePath={null} worktreeMissing={false} />
      </MemoryRouter>,
    )
    expect(container.textContent).toBe('')
    expect(container.firstChild).toBeNull()
  })

  it('a healthy worktree gets no warning', () => {
    render(
      <MemoryRouter>
        <BranchStrip
          projectId="p1"
          branchName="vadd/abc12345"
          worktreePath="/home/u/.vadd/worktrees/p1/o1"
          worktreeMissing={false}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a missing worktree says so and points at the git console', () => {
    render(
      <MemoryRouter>
        <BranchStrip
          projectId="p1"
          branchName="vadd/abc12345"
          worktreePath="/home/u/.vadd/worktrees/p1/o1"
          worktreeMissing={true}
        />
      </MemoryRouter>,
    )
    const note = screen.getByRole('status')
    expect(note.textContent).toMatch(/no longer exists/i)
    // Deliberately does NOT claim the objective is over: the machine decides
    // that, and the first browser render found this line sitting above a
    // clarification prompt still inviting an answer.
    expect(note.textContent).not.toMatch(/cannot continue/i)
    // The repair lives in the console, so the line has to get the user there.
    const link = screen.getByRole('link', { name: /git/i })
    expect(link.getAttribute('href')).toContain('project=p1')
  })
})
