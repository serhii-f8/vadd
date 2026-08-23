import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GitCommit } from '../src/api.js'
import { CommitLog } from '../src/git/CommitLog.js'

function gutters(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('li')).map(
    (li) => li.querySelector('span[aria-hidden]')?.textContent ?? '',
  )
}

describe('CommitLog', () => {
  it('draws a plain straight rail down a strictly linear history', () => {
    const commits: GitCommit[] = [
      {
        sha: 'a'.repeat(40),
        parents: ['b'.repeat(40)],
        subject: 'top',
        author: 'S',
        at: '2026-08-23T10:00:00Z',
        refs: [],
      },
      {
        sha: 'b'.repeat(40),
        parents: [],
        subject: 'root',
        author: 'S',
        at: '2026-08-22T10:00:00Z',
        refs: [],
      },
    ]
    const { container } = render(<CommitLog commits={commits} />)
    expect(gutters(container)).toEqual(['●', '●'])
  })

  it('renders the row where a merge rejoins differently from a straight pass-through row', () => {
    // A real two-parent commit — the shape layoutCommits computes `rails`
    // for and this gutter has to actually read, not just decorate:
    //
    //   M (parents: A, F)   — merge commit
    //   ├── A (parents: B)  — mainline continues: straight pass-through
    //   └── F (parents: B)  — feature branch: this is where it rejoins B
    //   B (root)
    const M = 'a'.repeat(40)
    const A = 'b'.repeat(40)
    const F = 'c'.repeat(40)
    const B = 'd'.repeat(40)
    const commits: GitCommit[] = [
      {
        sha: M,
        parents: [A, F],
        subject: 'merge feature',
        author: 'S',
        at: '2026-08-23T13:00:00Z',
        refs: [],
      },
      {
        sha: A,
        parents: [B],
        subject: 'mainline continues',
        author: 'S',
        at: '2026-08-23T12:00:00Z',
        refs: [],
      },
      {
        sha: F,
        parents: [B],
        subject: 'feature work',
        author: 'S',
        at: '2026-08-23T11:00:00Z',
        refs: [],
      },
      { sha: B, parents: [], subject: 'base', author: 'S', at: '2026-08-23T10:00:00Z', refs: [] },
    ]
    const { container } = render(<CommitLog commits={commits} />)
    const rows = gutters(container)

    // M diverges into a second lane for F — its own dot, plus a diagonal
    // marker in the lane it just opened, not a plain straight rail.
    expect(rows[0]).toBe('●×')
    // A is a genuine straight pass-through: its own dot, and F's lane
    // simply continues untouched beside it.
    expect(rows[1]).toBe('●│')
    // F is where the branches rejoin. This must render differently from A's
    // straight pass-through row directly above it, and specifically with a
    // diagonal marker where A's row had a plain rail.
    expect(rows[2]).toBe('×●')
    expect(rows[2]).not.toBe(rows[1])
    // B's lane closed at F — nothing left to draw there.
    expect(rows[3]).toBe('● ')
  })
})
