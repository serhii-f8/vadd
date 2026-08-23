import { ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, type ObjectiveListRow } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'
import { layoutObjectives, TONE_ORDER } from './layout-objectives.js'
import { type ObjectiveFlowNode, ObjectiveNode } from './ObjectiveNode.js'

const COLUMN_WIDTH = 260
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
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Map</h1>
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
          <div className="h-[calc(100vh-10rem)] w-full rounded-lg border border-border">
            <ReactFlow
              nodes={nodes}
              edges={[]}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              fitView
            />
          </div>
        </TooltipProvider>
      )}
    </>
  )
}
