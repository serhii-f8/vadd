import { CheckCircle2, CircleAlert, Clock, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { PlanTask } from '../api.js'
import { type EvidenceRow, groupEvidence } from '../evidence/group.js'
import { formatElapsed } from './elapsed.js'
import type { ViewStateName } from './primary.js'
import { StaleNotice } from './StaleNotice.js'
import { stateLabel } from './state-label.js'

export type LiveTaskProps = {
  tasks: PlanTask[]
  /** The agent's own last one-line status. Level 1, §10-budgeted at 15 words. */
  lastStatus: { headline: string; phase: string | null; at: string } | null
  /** When the agent last produced any raw output. The liveness heartbeat. */
  lastAgentUpdateAt: string | null
  /** The machine state, for the eyebrow. Optional so a bare render still reads. */
  state?: ViewStateName
  /** The evidence so far, counted into two chips. */
  evidence?: EvidenceRow[]
  /** Where the raw transcript lives, for the stale notice. */
  rawHref?: string
  onCommand?: (body: Record<string, unknown>) => void
}

/**
 * The current task, and enough signal to answer "is anything happening?".
 *
 * **No log stream** — the whole point of the product is reading 10× less text,
 * and the raw view is one link away for when that is not enough. What is here
 * instead: the agent's own status line (spec §10 caps it at 15 words), the
 * position in the plan, elapsed time, a heartbeat, and — new — an
 * indeterminate bar while the turn is open, the plan's progress, and a stale
 * notice once the heartbeat is more than a minute old.
 */
export function LiveTask({
  tasks,
  lastStatus,
  lastAgentUpdateAt,
  state,
  evidence = [],
  rawHref = '#',
  onCommand = () => undefined,
}: LiveTaskProps) {
  /**
   * Only a task the machine actually marked `running` is the current one.
   *
   * The previous fallback — `tasks.find(t => t.status !== 'verified')` — showed
   * the *next* pending task whenever nothing was running, which is most of
   * `exploring`, `planning` and `verifying`. A task that has not started
   * rendered as though it were live is worse than no title at all: it is a
   * confident wrong answer to the only question this panel exists to answer.
   */
  const running = tasks.find((t) => t.status === 'running')
  const verified = tasks.filter((t) => t.status === 'verified').length

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // A display clock, not view state: it drives no fetch and no transition.
    // Only mounted while something is actually running, so an idle Focus View
    // is not re-rendering once a second for nothing.
    if (running?.startedAt == null && lastAgentUpdateAt === null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running?.startedAt, lastAgentUpdateAt])

  const { required, advisory, warnings } = groupEvidence(evidence)
  const passed = [...required, ...advisory].filter((r) => r.status === 'pass').length

  return (
    <>
      <section className="flex flex-col gap-3.5 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-start gap-3.5">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-status-active/15 text-status-active"
          >
            <Loader2 className="size-[18px] animate-spin" />
          </span>
          <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
            <p className="flex gap-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {running !== undefined && (
                <span>
                  Task {running.ord + 1} of {tasks.length}
                </span>
              )}
              {running !== undefined && state !== undefined && <span aria-hidden="true">·</span>}
              {state !== undefined && <span>{stateLabel(state)}</span>}
            </p>
            <h2 className="text-[17px] leading-snug font-medium tracking-tight">
              {running?.title ?? 'Working'}
            </h2>
            {/* `role="status"` with a polite live region: a spinner is a purely
                visual signal, and without this a screen-reader user gets no
                indication at all that the agent is mid-run. */}
            <p role="status" aria-live="polite" className="text-sm">
              {lastStatus?.headline}
            </p>
          </div>
          <p className="flex shrink-0 flex-wrap items-center gap-3.5 text-xs text-muted-foreground">
            {running?.startedAt != null && (
              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5" aria-hidden="true" />
                <span className="font-mono">{formatElapsed(running.startedAt, now)}</span>
              </span>
            )}
            {lastAgentUpdateAt !== null && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-full bg-status-done" />
                agent output {formatElapsed(lastAgentUpdateAt, now)} ago
              </span>
            )}
          </p>
        </div>

        {/* Indeterminate: the turn is open and nothing here knows how long it takes. */}
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-indet rounded-full bg-status-active" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 basis-60 items-center gap-2.5">
            <span className="shrink-0 text-xs text-muted-foreground">Plan progress</span>
            <Progress
              value={verified}
              max={tasks.length}
              aria-label="Plan progress"
              className="max-w-80"
            />
            <span className="shrink-0 font-mono text-xs tabular-nums">
              {verified}/{tasks.length} verified
            </span>
          </div>
          <div className="flex gap-2">
            <Badge className="bg-status-done/15 text-foreground">
              <CheckCircle2 aria-hidden="true" />
              {passed} {passed === 1 ? 'check' : 'checks'} passed
            </Badge>
            {warnings.length > 0 && (
              <Badge className="bg-status-attention/15 text-foreground">
                <CircleAlert aria-hidden="true" />
                {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
              </Badge>
            )}
          </div>
        </div>
      </section>
      <StaleNotice
        lastAgentUpdateAt={lastAgentUpdateAt}
        now={now}
        rawHref={rawHref}
        onCommand={onCommand}
      />
    </>
  )
}
