import { CheckCircle2, FlaskConical, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, type TodaySummary } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'
import { useLiveObjectives } from '../app/useLiveObjectives.js'
import type { ViewStateName } from '../focus/primary.js'
import { ObjectiveRow } from '../objectives/ObjectiveRow.js'
import { statusFor } from './stateColor.js'

/** Spec §8: "Text only. Not gamified." Counts, a label, nothing else. */
const STATS: Array<{
  key: keyof Omit<TodaySummary, 'date'>
  label: string
  Icon: typeof CheckCircle2
}> = [
  { key: 'verifiedTasks', label: 'tasks verified', Icon: CheckCircle2 },
  { key: 'decisionsMade', label: 'decisions made', Icon: Workflow },
  { key: 'checksPassed', label: 'checks passed', Icon: FlaskConical },
]

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function Today() {
  const { selectedId, selected } = useProjects()
  const [summary, setSummary] = useState<TodaySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { objectives } = useLiveObjectives(selectedId)

  useEffect(() => {
    if (selectedId === null) return
    // Both are reset before every fetch: leaving the previous project's counts
    // on screen under a new project's name is the bug the daily-summary plan
    // had to fix once already.
    setSummary(null)
    setError(null)
    api
      .getToday(selectedId)
      .then(setSummary)
      .catch((e: Error) => setError(e.message))
  }, [selectedId])

  const open = (objectives ?? []).filter((o) => {
    const tone = statusFor(o.status as ViewStateName).tone
    return tone === 'attention' || tone === 'active'
  })
  const now = Date.now()

  return (
    <main className="flex flex-col gap-6 px-4 py-6 md:px-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Today</h1>
        {summary !== null && (
          <p className="text-sm text-muted-foreground">
            {formatDate(summary.date)}
            {selected !== null && ` · ${selected.name}`}
          </p>
        )}
      </header>

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {summary === null && error === null && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      )}

      {summary !== null && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {STATS.map(({ key, label, Icon }) => (
            <div
              key={key}
              className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </span>
              <span className="font-mono text-[32px] leading-none font-medium tracking-tight tabular-nums">
                {summary[key]}
              </span>
            </div>
          ))}
        </div>
      )}

      {open.length > 0 && (
        <section aria-labelledby="still-open" className="flex flex-col gap-1.5">
          <h2
            id="still-open"
            className="px-3.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
          >
            Still open
          </h2>
          <TooltipProvider>
            <ul className="flex flex-col rounded-xl bg-card p-1 ring-1 ring-foreground/10">
              {open.map((o) => (
                <ObjectiveRow key={o.id} objective={o} now={now} />
              ))}
            </ul>
          </TooltipProvider>
        </section>
      )}
    </main>
  )
}
