import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PlanTask } from '../api.js'
import { formatElapsed } from './elapsed.js'

export type LiveTaskProps = {
  tasks: PlanTask[]
  /** The agent's own last one-line status. Level 1, §10-budgeted at 15 words. */
  lastStatus: { headline: string; phase: string | null; at: string } | null
  /** When the agent last produced any raw output. The liveness heartbeat. */
  lastAgentUpdateAt: string | null
}

/**
 * The current task, and enough signal to answer "is anything happening?".
 *
 * **No log stream** — the whole point of the product is reading 10× less text,
 * and the raw view is one header link away for when that is not enough. What
 * is here instead is the agent's own status line, which spec §10 already caps
 * at 15 words, plus position in the plan and elapsed time.
 *
 * No `state` prop: the header already shows the machine state, and this
 * component doesn't take it just to leave it unread. The phase, where it
 * matters, arrives on `lastStatus`.
 */
export function LiveTask({ tasks, lastStatus, lastAgentUpdateAt }: LiveTaskProps) {
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

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // A display clock, not view state: it drives no fetch and no transition.
    // Only mounted while something is actually running, so an idle Focus View
    // is not re-rendering once a second for nothing.
    if (running?.startedAt == null && lastAgentUpdateAt === null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running?.startedAt, lastAgentUpdateAt])

  return (
    <section>
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-medium">{running?.title ?? 'Working'}</h2>
      </div>

      {/* `role="status"` with a polite live region: a spinner is a purely
          visual signal, and without this a screen-reader user gets no
          indication at all that the agent is mid-run. */}
      <div role="status" aria-live="polite" className="mt-1 flex flex-col gap-0.5 pl-6">
        {lastStatus !== null && <p className="text-sm">{lastStatus.headline}</p>}
        <p className="flex gap-3 text-xs text-muted-foreground">
          {running !== undefined && (
            <span>
              Task {running.ord + 1} of {tasks.length}
            </span>
          )}
          {running?.startedAt != null && <span>{formatElapsed(running.startedAt, now)}</span>}
          {lastAgentUpdateAt !== null && (
            <span>agent output {formatElapsed(lastAgentUpdateAt, now)} ago</span>
          )}
        </p>
      </div>
    </section>
  )
}
