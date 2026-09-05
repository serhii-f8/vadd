import { TooltipProvider } from '@/components/ui/tooltip'
import type { ObjectiveListRow } from '../api.js'
import { statusFor } from '../routes/stateColor.js'
import { groupObjectives } from './group-objectives.js'
import { ObjectiveRow } from './ObjectiveRow.js'

/** One representative state per tone, so a group heading's dot reads `statusFor` like every other dot. */
const TONE_STATE = {
  attention: 'awaitingReview',
  active: 'executing',
  idle: 'paused',
  done: 'done',
  failed: 'failed',
} as const

/** The board's rows, grouped by what they ask of the user. */
export function ObjectiveGroups({ objectives }: { objectives: ObjectiveListRow[] }) {
  const now = Date.now()
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        {groupObjectives(objectives).map((g) => (
          <section key={g.key} aria-labelledby={`group-${g.key}`} className="flex flex-col gap-1.5">
            <h2
              id={`group-${g.key}`}
              className="flex items-center gap-2 px-3.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
            >
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${statusFor(TONE_STATE[g.tone]).dot}`}
              />
              {g.label}
              <span className="font-normal normal-case">{g.rows.length}</span>
            </h2>
            <ul className="flex flex-col rounded-xl bg-card p-1 ring-1 ring-foreground/10">
              {g.rows.map((o) => (
                <ObjectiveRow key={o.id} objective={o} now={now} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </TooltipProvider>
  )
}
