import { describe, expect, it } from 'vitest'
import { type GraphCommit, laneCount, layoutCommits } from '../src/git/layout-commits.js'

/** Newest first, exactly as `git log` returns them. */
const linear: GraphCommit[] = [
  { sha: 'c', parents: ['b'] },
  { sha: 'b', parents: ['a'] },
  { sha: 'a', parents: [] },
]

/**
 *   m      merge, parents [main1, feat1]
 *   |\
 *   | f    feat1
 *   n |    main1
 *   |/
 *   r      root
 */
const merged: GraphCommit[] = [
  { sha: 'm', parents: ['n', 'f'] },
  { sha: 'n', parents: ['r'] },
  { sha: 'f', parents: ['r'] },
  { sha: 'r', parents: [] },
]

describe('layoutCommits', () => {
  it('puts a linear history in a single lane', () => {
    const laid = layoutCommits(linear)
    expect(laid.map((l) => l.lane)).toEqual([0, 0, 0])
    expect(laneCount(laid)).toBe(1)
  })

  it('keeps every commit in input order', () => {
    expect(layoutCommits(merged).map((l) => l.commit.sha)).toEqual(['m', 'n', 'f', 'r'])
  })

  it('gives a merge a second lane for its second parent', () => {
    const laid = layoutCommits(merged)
    const byIsha = Object.fromEntries(laid.map((l) => [l.commit.sha, l]))
    expect(byIsha.m?.lane).toBe(0)
    expect(byIsha.n?.lane).toBe(0)
    // The second parent opened a new lane, so `f` is not in lane 0.
    expect(byIsha.f?.lane).toBe(1)
    expect(laneCount(laid)).toBe(2)
  })

  it('collapses back to one lane once the branches rejoin at the root', () => {
    const laid = layoutCommits(merged)
    // By the root, both rails have converged onto it, so nothing is still
    // open to its right.
    expect(laid.at(-1)?.lane).toBe(0)
  })

  it('reuses a lane freed by an ended branch', () => {
    //  z        parents [y]        lane 0
    //  y        parents [x]        lane 0
    //  q        parents []   <- a second root, opens lane 1 then ends
    //  x        parents []
    const laid = layoutCommits([
      { sha: 'z', parents: ['y'] },
      { sha: 'y', parents: ['x'] },
      { sha: 'q', parents: [] },
      { sha: 'x', parents: [] },
    ])
    expect(laneCount(laid)).toBe(2)
  })

  it('a second root reuses the lane the first one freed', () => {
    const laid = layoutCommits([
      { sha: 'a1', parents: [] },
      { sha: 'b1', parents: [] },
    ])
    expect(laid.map((l) => l.lane)).toEqual([0, 0])
  })

  it('returns an empty layout for no commits', () => {
    expect(layoutCommits([])).toEqual([])
    expect(laneCount([])).toBe(0)
  })

  it('does not lose a parent that is outside the fetched page', () => {
    // The last page of a paged log: `a` has a parent that was never fetched.
    // The rail must simply end rather than throwing or opening a lane that
    // is never closed.
    const laid = layoutCommits([{ sha: 'a', parents: ['not-fetched'] }])
    expect(laid).toHaveLength(1)
    expect(laid[0]?.lane).toBe(0)
  })
})
