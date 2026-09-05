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
