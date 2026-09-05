import { GitBranch } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Aggregate } from '../api.js'
import { groupEvidence } from '../evidence/group.js'
import { statusFor } from '../routes/stateColor.js'
import type { ViewStateName } from './primary.js'
import { stateLabel } from './state-label.js'

const INTEGRATE_LABEL = { commit: 'committed', keep: 'kept', discard: 'discarded' } as const

/** A terminal objective in one line: what happened, what was proven, where the work is. */
export function OutcomeSummary({ aggregate }: { aggregate: Aggregate }) {
  const state = aggregate.state as ViewStateName
  const status = statusFor(state)
  const verified = aggregate.tasks.filter((t) => t.status === 'verified').length
  const { required } = groupEvidence(aggregate.evidence)
  const requiredPassed = required.filter((r) => r.status === 'pass').length
  const action = aggregate.objective.integrateAction
  return (
    <section
      aria-label="Outcome"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-card px-5 py-4 ring-1 ring-foreground/10"
    >
      <span className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
        <span aria-hidden="true" className={`size-2.5 rounded-full ${status.dot}`} />
        {stateLabel(state)}
      </span>
      {action !== null && <Badge variant="secondary">{INTEGRATE_LABEL[action]}</Badge>}
      <span className="font-mono text-sm tabular-nums text-muted-foreground">
        {verified}/{aggregate.tasks.length} tasks verified
      </span>
      {required.length > 0 && (
        <span className="font-mono text-sm tabular-nums text-muted-foreground">
          {requiredPassed}/{required.length} required checks
        </span>
      )}
      {aggregate.objective.branchName !== null && (
        <span className="flex items-center gap-1 font-mono text-sm text-muted-foreground">
          <GitBranch className="size-3.5" aria-hidden="true" />
          {aggregate.objective.branchName}
        </span>
      )}
    </section>
  )
}
