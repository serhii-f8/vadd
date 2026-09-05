import { Brain, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type ProjectMemoryNote } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'
import { useLiveObjectives } from '../app/useLiveObjectives.js'
import type { ViewStateName } from '../focus/primary.js'
import { NewObjectiveDialog } from '../objectives/NewObjectiveDialog.js'
import { ObjectiveGroups } from '../objectives/ObjectiveGroups.js'
import { statusFor } from '../routes/stateColor.js'

function MemoryColumn({ label, notes }: { label: string; notes: ProjectMemoryNote[] }) {
  if (notes.length === 0) return null
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h3 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </h3>
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
    </div>
  )
}

/**
 * Amendment A22's read-only memory, below the objectives instead of above
 * them: it used to push the list — the thing the board exists for — down
 * the page. Collapsible, open by default; renders nothing when empty.
 */
function ProjectMemory({ notes }: { notes: ProjectMemoryNote[] }) {
  const [open, setOpen] = useState(true)
  if (notes.length === 0) return null
  const architecture = notes.filter((n) => n.kind === 'architecture')
  const knownIssues = notes.filter((n) => n.kind === 'known_issue')
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <section className="rounded-xl bg-card ring-1 ring-foreground/10">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium">
          <Brain className="size-4 text-muted-foreground" aria-hidden="true" />
          Project memory
          <Badge variant="outline">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </Badge>
          <ChevronDown
            className={`ml-auto size-4 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-1 gap-4 px-4 pb-4 md:grid-cols-2">
            <MemoryColumn label="Known project structure" notes={architecture} />
            <MemoryColumn label="Known issues" notes={knownIssues} />
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

export function ObjectiveList() {
  const { selectedId, selected } = useProjects()
  // Live: refetched on every event the server publishes, so a state change
  // reaches the board without a reload.
  const { objectives, error } = useLiveObjectives(selectedId)
  const [memoryNotes, setMemoryNotes] = useState<ProjectMemoryNote[] | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    setMemoryNotes(null)
    if (selectedId === null) return
    api
      .getProjectMemory(selectedId)
      .then((r) => setMemoryNotes(r.notes))
      .catch(() => setMemoryNotes([]))
  }, [selectedId])

  const needsYou = (objectives ?? []).filter(
    (o) => statusFor(o.status as ViewStateName).tone === 'attention',
  ).length

  return (
    <main className="flex flex-col gap-6 px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Objectives</h1>
          {objectives !== null && (
            <p className="text-sm text-muted-foreground">
              {selected !== null && `${selected.name} · `}
              {objectives.length} {objectives.length === 1 ? 'objective' : 'objectives'}
              {needsYou > 0 && ` · ${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you`}
            </p>
          )}
        </div>
        <Button disabled={selectedId === null} onClick={() => setCreating(true)}>
          <Plus />
          New objective
        </Button>
      </header>

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {objectives === null && error === null && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}

      {objectives !== null && objectives.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm font-medium">No objectives yet.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Describe a bug or a feature in plain language. VADD explores, proposes, plans and
            verifies in an isolated worktree.
          </p>
          <Button
            variant="outline"
            disabled={selectedId === null}
            onClick={() => setCreating(true)}
          >
            <Plus />
            New objective
          </Button>
        </div>
      )}

      {objectives !== null && objectives.length > 0 && <ObjectiveGroups objectives={objectives} />}

      <ProjectMemory notes={memoryNotes ?? []} />

      <NewObjectiveDialog open={creating} onOpenChange={setCreating} />
    </main>
  )
}
