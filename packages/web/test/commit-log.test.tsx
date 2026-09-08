import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GitCommit } from '../src/api.js'
import { CommitLog } from '../src/git/CommitLog.js'

/**
 * The gutter's geometry is pinned in `commit-graph.test.tsx`, on the same
 * fixtures the glyph rail used to be tested on. This file keeps the row
 * anatomy: sha, subject, author, and a time.
 */
describe('CommitLog rows', () => {
  it('shows the short sha, the subject and the author', () => {
    const commits: GitCommit[] = [
      {
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        parents: [],
        subject: 'fix the login redirect',
        author: 'Serhii',
        at: '2026-08-23T10:00:00Z',
        refs: ['master'],
      },
    ]
    render(<CommitLog commits={commits} />)
    expect(screen.getByText('abcdef1')).toBeTruthy()
    expect(screen.getByText('fix the login redirect')).toBeTruthy()
    expect(screen.getByText('Serhii')).toBeTruthy()
    expect(screen.getByText('master')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'History' })).toBeTruthy()
  })
})

/**
 * Every objective branches from the same starting commit, so a project with
 * seven open objectives puts seven `vadd/…` chips on one row. Rendered in
 * Chrome on 2026-09-08 that row ran past the right edge of the history card
 * and over the panel beside it — the subject already shrinks to nothing, and a
 * chip does not shrink at all. Only the first few are drawn; the rest are
 * counted, with the full list on the summary chip's title.
 */
describe('CommitLog refs', () => {
  const many = (refs: string[]): GitCommit[] => [
    {
      sha: 'abcdef1234567890abcdef1234567890abcdef12',
      parents: [],
      subject: 'fix the login redirect',
      author: 'Serhii',
      at: '2026-08-23T10:00:00Z',
      refs,
    },
  ]

  it('draws every ref while there are few enough to fit', () => {
    render(<CommitLog commits={many(['main', 'vadd/aaaa1111', 'vadd/bbbb2222'])} />)
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.getByText('vadd/aaaa1111')).toBeTruthy()
    expect(screen.getByText('vadd/bbbb2222')).toBeTruthy()
    expect(screen.queryByText(/^\+\d+$/)).toBeNull()
  })

  it('counts the overflow instead of running off the row', () => {
    render(
      <CommitLog
        commits={many(['main', 'vadd/aaaa1111', 'vadd/bbbb2222', 'vadd/cccc3333', 'vadd/dddd4444'])}
      />,
    )
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.queryByText('vadd/dddd4444')).toBeNull()
    const more = screen.getByText('+2')
    expect(more.getAttribute('title')).toContain('vadd/dddd4444')
  })
})
