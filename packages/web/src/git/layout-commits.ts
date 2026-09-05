/** The only fields the layout needs. Any richer commit type satisfies it. */
export type GraphCommit = { sha: string; parents: string[] }

/**
 * One segment drawn on a single row. `from === to` is a straight
 * pass-through; `from !== to` is a diagonal where a branch joins or leaves.
 */
export type RailSegment = { from: number; to: number }

export type LaidOutCommit<T extends GraphCommit> = {
  commit: T
  lane: number
  rails: RailSegment[]
  /**
   * Whether the commit's own lane carries on below it. False for a root and
   * for a commit whose first parent another lane was already waiting for
   * (the graph narrows there) — `rails` alone cannot say, since the own
   * lane's straight segment is captured before the parents are assigned.
   */
  continues: boolean
}

/**
 * Assigns each commit a lane, newest first.
 *
 * Pure: no React, no DOM, no git. The rails are computed from parent shas
 * rather than scraped from `git log --graph`, whose ASCII output is a
 * rendering decision of git's and not an interface.
 *
 * The algorithm maintains `open`, an array where each slot is the sha that
 * lane is currently waiting to draw. A commit claims the leftmost lane
 * waiting for it (or the leftmost free slot if nothing is), then hands that
 * lane to its first parent and opens new lanes for any others.
 */
export function layoutCommits<T extends GraphCommit>(commits: T[]): LaidOutCommit<T>[] {
  const open: (string | null)[] = []

  const claim = (sha: string): number => {
    const waiting = open.indexOf(sha)
    if (waiting !== -1) return waiting
    const free = open.indexOf(null)
    if (free !== -1) {
      open[free] = sha
      return free
    }
    open.push(sha)
    return open.length - 1
  }

  const result: LaidOutCommit<T>[] = []

  for (const commit of commits) {
    const lane = claim(commit.sha)
    // Every lane still open at this row draws a segment through it. Captured
    // before the parents are assigned so the row shows the state the commit
    // arrived into.
    const rails: RailSegment[] = open
      .map((sha, i) => (sha === null ? null : { from: i, to: i }))
      .filter((r): r is RailSegment => r !== null)

    const [first, ...rest] = commit.parents
    if (first === undefined) {
      // A root commit: this lane closes.
      open[lane] = null
    } else {
      // Another lane may already be waiting for this same parent (two
      // branches converging). Keep the leftmost and free this one, so the
      // graph narrows back down instead of carrying a duplicate rail.
      const existing = open.indexOf(first)
      if (existing !== -1 && existing !== lane) {
        open[lane] = null
        rails.push({ from: lane, to: existing })
      } else {
        open[lane] = first
      }
    }

    for (const parent of rest) {
      const existing = open.indexOf(parent)
      if (existing !== -1) {
        rails.push({ from: lane, to: existing })
        continue
      }
      const free = open.indexOf(null)
      const target = free !== -1 ? free : open.length
      open[target] = parent
      rails.push({ from: lane, to: target })
    }

    result.push({ commit, lane, rails, continues: open[lane] !== null })
  }

  return result
}

/** Widest point of the graph, for sizing the rail gutter. */
export function laneCount(laid: LaidOutCommit<GraphCommit>[]): number {
  let max = 0
  for (const row of laid) {
    max = Math.max(max, row.lane + 1, ...row.rails.map((r) => Math.max(r.from, r.to) + 1))
  }
  return max
}
