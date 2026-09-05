import { CircleAlert, Info, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { currentRequired, type GroupedEvidence } from './group.js'

/**
 * The evidence set at a glance, before the rows: what decides whether Done
 * is reachable (required), what the agent claimed (advisory), and what is
 * amber (warnings). Counts only — the rows below carry the words.
 */
export function EvidenceTiles({ grouped }: { grouped: GroupedEvidence }) {
  const current = currentRequired(grouped.required)
  const requiredPassed = current.filter((r) => r.status === 'pass').length
  const requiredTotal = current.length
  const allGreen = requiredTotal > 0 && requiredPassed === requiredTotal
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Required
        </span>
        <span className="flex items-baseline gap-2.5">
          <b className="font-mono text-[26px] font-medium tracking-tight tabular-nums">
            {requiredPassed}/{requiredTotal}
          </b>
          {allGreen && <Badge className="bg-status-done/15 text-foreground">all green</Badge>}
          {requiredTotal > 0 && !allGreen && (
            <Badge className="bg-status-failed/15 text-foreground">
              {requiredTotal - requiredPassed} not passing
            </Badge>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          These decide whether Done is reachable.
        </span>
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5" aria-hidden="true" />
          Advisory
        </span>
        <span className="flex items-baseline gap-2.5">
          <b className="font-mono text-[26px] font-medium tracking-tight tabular-nums">
            {grouped.advisory.length}
          </b>
          <span className="text-xs text-muted-foreground">agent claims, never counted</span>
        </span>
        <span className="text-xs text-muted-foreground">Shown so you can weigh them.</span>
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          Warnings
        </span>
        <span className="flex items-baseline gap-2.5">
          <b className="font-mono text-[26px] font-medium tracking-tight tabular-nums">
            {grouped.warnings.length}
          </b>
          {grouped.warnings.length > 0 && (
            <Badge className="bg-status-attention/15 text-foreground">amber</Badge>
          )}
        </span>
        <span className="text-xs text-muted-foreground">Spec §8: amber, never blocking.</span>
      </div>
    </div>
  )
}
