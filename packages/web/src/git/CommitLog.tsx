import { Cloud, GitBranch, Tag } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { GitCommit } from '../api.js'
import { relativeTime } from '../lib/relative-time.js'
import { ROW_HEIGHT, RowGutter } from './CommitGraph.js'
import { laneCount, layoutCommits } from './layout-commits.js'

/** How a ref reads: a local branch, a VADD branch, a remote-tracking ref, or a tag. */
function RefChip({ name }: { name: string }) {
  // `<remote>/<branch>` reads as remote-tracking. A local branch that happens
  // to carry a slash (`feature/x`) is misread as remote here — the log route
  // does not say which is which, and a cloud icon is the lesser wrong.
  if (name.includes('/') && !name.startsWith('vadd/')) {
    return (
      <Badge variant="outline" className="h-[18px] font-mono font-normal text-muted-foreground">
        <Cloud aria-hidden="true" />
        {name}
      </Badge>
    )
  }
  if (name.startsWith('vadd/')) {
    return (
      <Badge className="h-[18px] bg-status-done/15 font-mono font-normal text-foreground">
        <GitBranch aria-hidden="true" />
        {name}
      </Badge>
    )
  }
  if (/^v?\d+\.\d+/.test(name)) {
    return (
      <Badge variant="secondary" className="h-[18px] font-mono font-normal">
        <Tag aria-hidden="true" />
        {name}
      </Badge>
    )
  }
  return (
    <Badge className="h-[18px] bg-status-active/15 font-mono font-normal text-foreground">
      <GitBranch aria-hidden="true" />
      {name}
    </Badge>
  )
}

/**
 * How many ref chips a row draws before it stops.
 *
 * Every objective branches from the same starting commit, so one commit can
 * carry a chip per open objective. The subject beside them is already
 * `min-w-0 truncate` and shrinks to nothing; a chip does not shrink at all, so
 * an uncapped list runs past the card's right edge and over whatever sits
 * next to it — seen with seven `vadd/…` chips on 2026-09-08.
 */
const MAX_REFS = 3

export function CommitLog({ commits }: { commits: GitCommit[] }) {
  const laid = layoutCommits(commits)
  const lanes = Math.max(1, laneCount(laid))
  const now = Date.now()

  return (
    <ol className="flex flex-col" aria-label="History">
      {laid.map(({ commit, lane, rails, continues }, i) => {
        const prev = laid[i - 1]
        // A lane that ended on the row above must not arrive here: the
        // layout records the own-lane segment before it learns the lane
        // closes, so that one segment is dropped on the way down.
        const prevRails =
          prev === undefined
            ? []
            : prev.rails.filter(
                (r) => !(r.from === r.to && r.from === prev.lane && !prev.continues),
              )
        return (
          <li
            key={commit.sha}
            className="flex items-center gap-2.5 pr-2 text-sm"
            style={{ minHeight: ROW_HEIGHT }}
          >
            <RowGutter
              lane={lane}
              lanes={lanes}
              rails={rails}
              prevRails={prevRails}
              continues={continues}
            />
            <code className="w-14 shrink-0 text-xs text-muted-foreground">
              {commit.sha.slice(0, 7)}
            </code>
            <span
              className={`min-w-0 flex-1 truncate ${
                commit.subject.startsWith('vadd-checkpoint:') ? 'text-muted-foreground' : ''
              }`}
            >
              {commit.subject}
            </span>
            {commit.refs.slice(0, MAX_REFS).map((r) => (
              <RefChip key={r} name={r} />
            ))}
            {commit.refs.length > MAX_REFS && (
              <Badge
                variant="outline"
                className="h-[18px] shrink-0 font-mono font-normal text-muted-foreground"
                title={commit.refs.slice(MAX_REFS).join(', ')}
              >
                +{commit.refs.length - MAX_REFS}
              </Badge>
            )}
            <span className="hidden w-16 shrink-0 truncate text-right text-xs text-muted-foreground sm:inline">
              {commit.author}
            </span>
            <time
              dateTime={commit.at}
              className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground"
            >
              {relativeTime(commit.at, now, { short: true })}
            </time>
          </li>
        )
      })}
    </ol>
  )
}
