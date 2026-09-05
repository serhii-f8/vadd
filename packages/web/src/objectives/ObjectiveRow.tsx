import { ChevronRight, Search, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ObjectiveListRow } from '../api.js'
import type { ViewStateName } from '../focus/primary.js'
import { stateLabel } from '../focus/state-label.js'
import { relativeTime } from '../lib/relative-time.js'
import { statusFor } from '../routes/stateColor.js'

/** A8: a done objective whose work was thrown away must not look like one whose work was committed. */
const INTEGRATE_LABEL: Record<NonNullable<ObjectiveListRow['integrateAction']>, string> = {
  commit: 'committed',
  keep: 'kept',
  discard: 'discarded',
}

/**
 * One objective, as the board and Today show it: tone dot (pulsing while the
 * agent works), title, the chips that change what the row means (mode,
 * integrate action), a Level 1 line of state · branch · when, and progress.
 * Must be rendered inside a `TooltipProvider`.
 */
export function ObjectiveRow({ objective: o, now }: { objective: ObjectiveListRow; now: number }) {
  const status = statusFor(o.status as ViewStateName)
  const pct = o.totalCount > 0 ? o.verifiedCount / o.totalCount : 0
  return (
    <li>
      <Link
        to={`/o/${o.id}`}
        className="flex items-center gap-3.5 rounded-lg px-3.5 py-3 hover:bg-muted hover:no-underline"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              aria-label={status.label}
              className={`size-2 shrink-0 rounded-full ${status.dot} ${
                status.tone === 'active' ? 'animate-pulse-dot' : ''
              }`}
            />
          </TooltipTrigger>
          <TooltipContent>
            {status.label} — {o.status}
          </TooltipContent>
        </Tooltip>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate font-medium">{o.title}</span>
            {o.mode === 'fastfix' && (
              <Badge variant="outline" className="shrink-0">
                <Zap aria-hidden="true" />
                Fast Fix
              </Badge>
            )}
            {o.mode === 'investigation' && (
              <Badge variant="outline" className="shrink-0">
                <Search aria-hidden="true" />
                Investigation
              </Badge>
            )}
            {o.integrateAction !== null && (
              <Badge variant="secondary" className="shrink-0">
                {INTEGRATE_LABEL[o.integrateAction]}
              </Badge>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{stateLabel(o.status as ViewStateName)}</span>
            {o.branchName !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate font-mono">{o.branchName}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{relativeTime(o.updatedAt, now)}</span>
          </span>
        </span>

        <span className="hidden w-40 shrink-0 items-center gap-2.5 sm:flex">
          <Progress
            value={Math.round(pct * 100)}
            aria-label={`${o.verifiedCount} of ${o.totalCount} tasks verified`}
            tone={status.tone === 'active' ? 'active' : 'done'}
          />
          <span className="w-8 text-right font-mono text-xs tabular-nums text-muted-foreground">
            {o.verifiedCount}/{o.totalCount}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  )
}
