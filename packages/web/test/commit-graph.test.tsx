import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GitCommit } from '../src/api.js'
import { CommitLog } from '../src/git/CommitLog.js'

function gutters(container: HTMLElement) {
  return Array.from(container.querySelectorAll('li')).map((li) => {
    const svg = li.querySelector('svg') as SVGElement
    return {
      lane: svg.getAttribute('data-lane'),
      rails: svg.getAttribute('data-rails'),
      continues: svg.getAttribute('data-continues'),
      lines: svg.querySelectorAll('line').length,
      curves: svg.querySelectorAll('path').length,
      dots: svg.querySelectorAll('circle').length,
    }
  })
}

const commit = (sha: string, parents: string[], subject: string): GitCommit => ({
  sha,
  parents,
  subject,
  author: 'S',
  at: '2026-08-23T10:00:00Z',
  refs: [],
})

describe('CommitGraph gutter', () => {
  it('draws a plain straight rail down a strictly linear history', () => {
    const { container } = render(
      <CommitLog
        commits={[
          commit('a'.repeat(40), ['b'.repeat(40)], 'top'),
          commit('b'.repeat(40), [], 'root'),
        ]}
      />,
    )
    const rows = gutters(container)
    expect(rows.map((r) => r.lane)).toEqual(['0', '0'])
    // The top row's lane carries on; the root's does not, so nothing is drawn
    // below its dot even though the layout records the lane as open there.
    expect(rows[0]).toMatchObject({ continues: 'true', lines: 1, curves: 0, dots: 1 })
    expect(rows[1]).toMatchObject({ continues: 'false', lines: 1, curves: 0, dots: 1 })
  })

  it('renders a merge as a diagonal that opens a second lane and a diagonal that closes it', () => {
    // M (parents: A, F) merge · A (B) mainline · F (B) feature rejoining · B root
    const M = 'a'.repeat(40)
    const A = 'b'.repeat(40)
    const F = 'c'.repeat(40)
    const B = 'd'.repeat(40)
    const { container } = render(
      <CommitLog
        commits={[
          commit(M, [A, F], 'merge feature'),
          commit(A, [B], 'mainline continues'),
          commit(F, [B], 'feature work'),
          commit(B, [], 'base'),
        ]}
      />,
    )
    const rows = gutters(container)
    // M: its own lane 0 continues to A (one line), a diagonal opens lane 1 for F.
    expect(rows[0]).toMatchObject({ lane: '0', rails: '0-0,0-1', lines: 1, curves: 1 })
    // A: the diagonal arrives (curve), lane 0 arrives, both lanes leave straight.
    expect(rows[1]).toMatchObject({ lane: '0', rails: '0-0,1-1', lines: 3, curves: 1 })
    // F: on lane 1, and its lane ends here — it rejoins lane 0 as a diagonal,
    // with no straight segment drawn below its dot.
    expect(rows[2]).toMatchObject({ lane: '1', continues: 'false', lines: 3, curves: 1 })
    expect(rows[2]?.rails).toContain('1-0')
    // B: the rejoin arrives as a curve; a root draws nothing below.
    expect(rows[3]).toMatchObject({ lane: '0', continues: 'false', lines: 1, curves: 1 })
    expect(rows.every((r) => r.dots === 1)).toBe(true)
  })

  it('labels refs by kind and mutes checkpoint commits', () => {
    const { container } = render(
      <CommitLog
        commits={[
          {
            ...commit('a'.repeat(40), [], 'vadd-checkpoint: task 1'),
            refs: ['main', 'origin/main', 'vadd/12345678', 'v1.2.0'],
          },
        ]}
      />,
    )
    const chips = Array.from(container.querySelectorAll('[data-slot=badge]')).map(
      (b) => b.textContent,
    )
    expect(chips).toEqual(['main', 'origin/main', 'vadd/12345678', 'v1.2.0'])
    expect(container.querySelector('li span.truncate')?.className).toContain(
      'text-muted-foreground',
    )
  })
})
