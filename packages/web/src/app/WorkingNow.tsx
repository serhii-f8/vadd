import { Link } from 'react-router-dom'
import type { ObjectiveListRow } from '../api.js'
import type { ViewStateName } from '../focus/primary.js'
import { stateLabel } from '../focus/state-label.js'
import { relativeTime } from '../lib/relative-time.js'
import { statusFor } from '../routes/stateColor.js'

/**
 * The objectives the agent is working on right now, from any screen.
 *
 * This is the answer to "is anything happening?" that used to exist only as a
 * 16px spinner on one Focus View. It reads the same live list the board
 * does; nothing here is a second source of truth.
 */
export function WorkingNow({
  objectives,
  onNavigate,
}: {
  objectives: ObjectiveListRow[] | null
  /** Closes the drawer the section may be rendered in. */
  onNavigate?: () => void
}) {
  if (objectives === null) return null
  const active = objectives.filter((o) => statusFor(o.status as ViewStateName).tone === 'active')
  const needsYou = objectives.filter(
    (o) => statusFor(o.status as ViewStateName).tone === 'attention',
  ).length
  const now = Date.now()

  return (
    <section aria-label="Working now" className="flex flex-col gap-1.5">
      <h2 className="px-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        Working now
      </h2>
      {active.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">
          Nothing running.
          {needsYou > 0 && ` ${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {active.map((o) => (
            <li key={o.id}>
              <Link
                to={`/o/${o.id}`}
                onClick={onNavigate}
                className="flex flex-col gap-0.5 rounded-lg bg-card p-2 ring-1 ring-foreground/10 hover:no-underline hover:ring-foreground/20"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 animate-pulse-dot rounded-full bg-status-active"
                  />
                  <span className="min-w-0 truncate text-[13px] font-medium">{o.title}</span>
                </span>
                <span className="pl-4 text-xs text-muted-foreground">
                  {stateLabel(o.status as ViewStateName)} · {relativeTime(o.updatedAt, now)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
