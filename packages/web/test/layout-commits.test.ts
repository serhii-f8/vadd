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

  it('draws the fold as a diagonal rail, and does not leave the folded lane still open', () => {
    const laid = layoutCommits(merged)
    const byIsha = Object.fromEntries(laid.map((l) => [l.commit.sha, l]))
    // `f`'s parent `r` is already waited for in lane 0 (n got there first),
    // so `f`'s own lane 1 folds into it: a rail whose `from` and `to` differ,
    // not a second rail that stays open forever.
    expect(byIsha.f?.rails).toContainEqual({ from: 1, to: 0 })
    // Once folded, lane 1 is closed — the root's row should draw only the
    // one rail still open, not a leftover second one.
    expect(byIsha.r?.rails).toEqual([{ from: 0, to: 0 }])
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

  it('says whether a commit’s own lane continues below it', () => {
    const M = 'a'.repeat(40)
    const A = 'b'.repeat(40)
    const F = 'c'.repeat(40)
    const B = 'd'.repeat(40)
    const laid = layoutCommits([
      { sha: M, parents: [A, F] },
      { sha: A, parents: [B] },
      { sha: F, parents: [B] },
      { sha: B, parents: [] },
    ])
    // M and A continue; F narrows back into B's lane; B is a root.
    expect(laid.map((r) => r.continues)).toEqual([true, true, false, false])
  })
})
