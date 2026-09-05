import { ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, type ObjectiveListRow } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'
import { statusFor } from '../routes/stateColor.js'
import { layoutObjectives, TONE_ORDER } from './layout-objectives.js'
import { type ObjectiveFlowNode, ObjectiveNode } from './ObjectiveNode.js'

const COLUMN_WIDTH = 260

/**
 * One representative machine state per tone, so the headers can read their
 * label and dot from `statusFor` — the same function the Objective Board's
 * status dot uses — instead of duplicating its table. A second copy of that
 * mapping is exactly the "rule applied in one place and not another" shape
 * this codebase's defect history is made of.
 */
const TONE_STATUS = {
  idle: 'idle',
  active: 'executing',
  attention: 'awaitingReview',
  done: 'done',
  failed: 'failed',
} as const
const ROW_HEIGHT = 96

const nodeTypes = { objective: ObjectiveNode }

function toFlowNodes(objectives: ObjectiveListRow[]): ObjectiveFlowNode[] {
  return layoutObjectives(objectives).map((m) => ({
    id: m.id,
    type: 'objective',
    position: { x: TONE_ORDER.indexOf(m.column) * COLUMN_WIDTH, y: m.row * ROW_HEIGHT },
    data: { objective: m.objective },
  }))
}

export function QuestMap() {
  const { selectedId } = useProjects()
  const [objectives, setObjectives] = useState<ObjectiveListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setObjectives(null)
    setError(null)
    api
      .listObjectives(selectedId ?? undefined)
      .then(setObjectives)
      .catch((e: Error) => setError(e.message))
  }, [selectedId])

  const nodes = useMemo(() => toFlowNodes(objectives ?? []), [objectives])

  return (
    <main className="flex flex-col px-4 py-6 md:px-8">
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight">Map</h1>
      </header>

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

      {objectives !== null && objectives.length > 0 && (
        <TooltipProvider>
          {/*
            A legend, in column order — deliberately NOT aligned headers.

            The canvas lays objectives out in five status columns and, until
            this existed, named none of them: the first browser render of
            `/map` (2026-08-25) showed one populated column with nothing on
            screen saying what it was sorted by.

            The first attempt at fixing that gave each label `COLUMN_WIDTH` and
            claimed it would "sit over the column it names at the default
            viewport". Seen in a browser, that was wrong twice over: `fitView`
            pans and zooms the canvas to frame whatever nodes exist, so there
            is no default viewport for a header to line up with — and five
            fixed 260px labels overflowed the content area, cutting "Failed"
            off entirely.

            So it reads as what it honestly is: the tone order, spelled out,
            with each tone's own dot. `TONE_ORDER` and `statusFor` are the same
            constant and function the layout and the Objective Board already
            use, so none of the three can drift apart on order or colour.
          */}
          <ul
            aria-label="Status columns"
            className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-xs font-medium text-muted-foreground"
          >
            {TONE_ORDER.map((tone) => {
              const { dot, label } = statusFor(TONE_STATUS[tone])
              return (
                <li key={tone} className="flex items-center gap-1.5">
                  <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                  {label}
                </li>
              )
            })}
          </ul>
          <div className="h-[calc(100vh-10rem)] w-full rounded-lg border border-border">
            <ReactFlow
              nodes={nodes}
              edges={[]}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              fitView
              // Two cards must not be blown up to fill the canvas: fit, never enlarge.
              fitViewOptions={{ maxZoom: 1 }}
            />
          </div>
        </TooltipProvider>
      )}
    </main>
  )
}
