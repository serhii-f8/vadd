import type { Node, NodeProps } from '@xyflow/react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ObjectiveListRow } from '../api.js'
import type { ViewStateName } from '../focus/primary.js'
import { statusFor } from '../routes/stateColor.js'

export type ObjectiveFlowNode = Node<{ objective: ObjectiveListRow }, 'objective'>

/**
 * Same fields `ObjectiveList`'s row already shows — title, tone dot, verified
 * fraction, integrate-action badge — rendered as a positioned card instead of
 * a list row. `nodrag` keeps the inner `Link` clickable even though the parent
 * `<ReactFlow>` has node dragging disabled globally (belt and suspenders,
 * matching React Flow's own documented pattern for interactive node content).
 */
export function ObjectiveNode({ data }: NodeProps<ObjectiveFlowNode>) {
  const { objective: o } = data
  const status = statusFor(o.status as ViewStateName)
  return (
    <Card className="w-56">
      <Link to={`/o/${o.id}`} className="nodrag flex flex-col gap-1.5 px-4">
        <div className="flex items-center gap-2">
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
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{o.title}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {o.integrateAction !== null && <Badge variant="outline">{o.integrateAction}</Badge>}
          <span className="font-mono tabular-nums">
            {o.verifiedCount}/{o.totalCount}
          </span>
        </div>
      </Link>
    </Card>
  )
}
