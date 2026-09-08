import type { Node, NodeProps } from '@xyflow/react'
import { Search, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ObjectiveListRow } from '../api.js'
import type { ViewStateName } from '../focus/primary.js'
import { stateLabel } from '../focus/state-label.js'
import { statusFor } from '../routes/stateColor.js'
import { NODE_HEIGHT } from './layout-objectives.js'

export type ObjectiveFlowNode = Node<{ objective: ObjectiveListRow }, 'objective'>

const INTEGRATE_LABEL = { commit: 'committed', keep: 'kept', discard: 'discarded' } as const

/**
 * The board row's anatomy — tone dot, title, chips, human state, progress —
 * as a positioned card. `nodrag` keeps the inner `Link` clickable even though
 * the parent `<ReactFlow>` has node dragging disabled globally (belt and
 * suspenders, matching React Flow's own documented pattern for interactive
 * node content).
 */
export function ObjectiveNode({ data }: NodeProps<ObjectiveFlowNode>) {
  const { objective: o } = data
  const status = statusFor(o.status as ViewStateName)
  return (
    // Height pinned, not measured: the canvas positions nodes on a fixed
    // pitch, so a card free to grow overlaps its neighbour. See NODE_HEIGHT.
    <div
      className="w-60 overflow-hidden rounded-xl bg-card text-sm ring-1 ring-foreground/10"
      style={{ height: NODE_HEIGHT }}
    >
      <Link
        to={`/o/${o.id}`}
        className="nodrag flex h-full flex-col justify-between gap-2 px-3.5 py-3 hover:no-underline"
      >
        <span className="flex items-center gap-2">
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
          <span className="min-w-0 flex-1 truncate font-medium">{o.title}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{stateLabel(o.status as ViewStateName)}</span>
          {o.mode === 'fastfix' && (
            <Badge variant="outline" className="h-[18px]">
              <Zap aria-hidden="true" />
              Fast Fix
            </Badge>
          )}
          {o.mode === 'investigation' && (
            <Badge variant="outline" className="h-[18px]">
              <Search aria-hidden="true" />
              Investigation
            </Badge>
          )}
          {o.integrateAction !== null && (
            <Badge variant="secondary" className="h-[18px]">
              {INTEGRATE_LABEL[o.integrateAction]}
            </Badge>
          )}
        </span>
        <span className="flex items-center gap-2">
          <Progress
            value={o.verifiedCount}
            max={o.totalCount}
            aria-label={`${o.verifiedCount} of ${o.totalCount} tasks verified`}
            tone={status.tone === 'active' ? 'active' : 'done'}
          />
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {o.verifiedCount}/{o.totalCount}
          </span>
        </span>
      </Link>
    </div>
  )
}
