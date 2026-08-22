import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type TodaySummary } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'

/** Spec §8: "Text only. Not gamified." Counts, a label, nothing else. */
const STATS: Array<{ key: keyof Omit<TodaySummary, 'date'>; label: string }> = [
  { key: 'verifiedTasks', label: 'tasks verified' },
  { key: 'decisionsMade', label: 'decisions made' },
  { key: 'checksPassed', label: 'checks passed' },
]

export function Today() {
  const { selectedId } = useProjects()
  const [summary, setSummary] = useState<TodaySummary | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        {summary !== null && <p className="text-sm text-muted-foreground">{summary.date}</p>}
      </header>

      {error !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {summary === null && error === null && (
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}

      {summary !== null && (
        <div className="grid grid-cols-3 gap-3">
          {STATS.map(({ key, label }) => (
            <Card key={key}>
              <CardContent className="flex flex-col gap-1">
                <span className="font-mono text-3xl tabular-nums">{summary[key]}</span>
                <span className="text-sm text-muted-foreground">{label}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
