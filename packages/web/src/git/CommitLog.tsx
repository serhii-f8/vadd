import type { GitCommit } from '../api.js'
import { laneCount, layoutCommits } from './layout-commits.js'

const LANE_WIDTH = 12

/**
 * The rail gutter is drawn as monospace text rather than SVG: it is a fixed
 * grid of columns, it inherits the row height for free, and it stays aligned
 * when the browser reflows the subject beside it.
 */
function railText(lane: number, lanes: number): string {
  const cells = Array.from({ length: lanes }, (_, i) => (i === lane ? '●' : '│'))
  return cells.join('')
}

export function CommitLog({ commits }: { commits: GitCommit[] }) {
  const laid = layoutCommits(commits)
  const lanes = Math.max(1, laneCount(laid))

  return (
    <ol className="flex flex-col" aria-label="History">
      {laid.map(({ commit, lane }) => (
        <li key={commit.sha} className="flex items-baseline gap-3 py-0.5 text-sm">
          <span
            aria-hidden
            className="shrink-0 font-mono text-xs text-muted-foreground"
            style={{ width: `${lanes * LANE_WIDTH}px` }}
          >
            {railText(lane, lanes)}
          </span>
          <code className="shrink-0 text-xs text-muted-foreground">{commit.sha.slice(0, 7)}</code>
          <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
          {commit.refs.map((r) => (
            <span key={r} className="shrink-0 rounded border border-border px-1 text-xs">
              {r}
            </span>
          ))}
          <span className="shrink-0 text-xs text-muted-foreground">{commit.author}</span>
        </li>
      ))}
    </ol>
  )
}
