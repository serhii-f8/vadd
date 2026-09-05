import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { api, type ProjectMemoryNote } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'
import { useLiveObjectives } from '../app/useLiveObjectives.js'
import type { ViewStateName } from '../focus/primary.js'
import { statusFor } from './stateColor.js'

function MemorySection({ label, notes }: { label: string; notes: ProjectMemoryNote[] }) {
  if (notes.length === 0) return null
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{label}</h2>
      <ul className="flex flex-col gap-1">
        {notes.map((n) => (
          <li key={n.id} className="text-sm">
            {n.sourceObjectiveId !== null ? (
              <Link to={`/o/${n.sourceObjectiveId}`} className="hover:underline">
                {n.headline}
              </Link>
            ) : (
              n.headline
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ObjectiveList() {
  const { selectedId } = useProjects()
  // Live: refetched on every event the server publishes, so a state change
  // reaches the board without a reload.
  const { objectives, error } = useLiveObjectives(selectedId)
  const [memoryNotes, setMemoryNotes] = useState<ProjectMemoryNote[] | null>(null)

  useEffect(() => {
    setMemoryNotes(null)
    if (selectedId === null) return
    api
      .getProjectMemory(selectedId)
      .then((r) => setMemoryNotes(r.notes))
      .catch(() => setMemoryNotes([]))
  }, [selectedId])

  const architectureNotes = (memoryNotes ?? []).filter((n) => n.kind === 'architecture')
  const knownIssueNotes = (memoryNotes ?? []).filter((n) => n.kind === 'known_issue')

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Objectives</h1>
      </header>

      <MemorySection label="Known project structure" notes={architectureNotes} />
      <MemorySection label="Known issues" notes={knownIssueNotes} />

      {error !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {objectives === null && error === null && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {objectives !== null && objectives.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">No objectives yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use <span className="font-medium">New objective</span> in the sidebar to describe a bug
            or a feature in plain language.
          </p>
        </div>
      )}

      <TooltipProvider>
        <ul className="flex flex-col">
          {(objectives ?? []).map((o) => {
            const status = statusFor(o.status as ViewStateName)
            return (
              <li key={o.id} className="border-b border-border last:border-b-0">
                <Link
                  to={`/o/${o.id}`}
                  className="flex items-center gap-3 rounded-md px-2 py-3 hover:bg-muted"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        role="img"
                        aria-label={status.label}
                        className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {status.label} — {o.status}
                    </TooltipContent>
                  </Tooltip>
                  <span className="min-w-0 flex-1 truncate font-medium">{o.title}</span>
                  {/* A8: a done objective whose work was thrown away must not
                      look like one whose work was committed. */}
                  {o.integrateAction !== null && (
                    <Badge variant="outline">{o.integrateAction}</Badge>
                  )}
                  <span className="text-sm text-muted-foreground">{o.status}</span>
                  <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {o.verifiedCount}/{o.totalCount}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </TooltipProvider>
    </>
  )
}
