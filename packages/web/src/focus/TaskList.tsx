import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { PlanTask } from '../api.js'
import { formatElapsed } from './elapsed.js'

const ICON: Record<PlanTask['status'], { Icon: typeof Circle; className: string }> = {
  pending: { Icon: Circle, className: 'text-muted-foreground/60' },
  running: { Icon: Loader2, className: 'animate-spin text-status-active' },
  verifying: { Icon: Loader2, className: 'animate-spin text-status-active' },
  verified: { Icon: CheckCircle2, className: 'text-status-done' },
  failed: { Icon: XCircle, className: 'text-status-failed' },
  skipped: { Icon: MinusCircle, className: 'text-muted-foreground/60' },
}

/** How long a finished task took, when both timestamps exist. */
function duration(t: PlanTask): string | null {
  if (t.startedAt === null || t.finishedAt === null) return null
  return formatElapsed(t.startedAt, Date.parse(t.finishedAt))
}

/**
 * The plan, readable at a glance, as a stepper.
 *
 * This replaces a strip of 8px dots whose titles and statuses were reachable
 * only by hovering one at a time — which made the plan effectively invisible.
 * Level 0 per task: an ordinal, an icon, a title, a status word, and for a
 * finished task how long it took. Nothing else.
 */
export function TaskList({ tasks }: { tasks: PlanTask[] }) {
  return (
    <ol className="flex flex-col gap-0.5" aria-label="Plan">
      {tasks.map((t) => {
        const { Icon, className } = ICON[t.status]
        const took = t.status === 'verified' ? duration(t) : null
        return (
          <li
            key={t.id}
            // `aria-current="step"` is how a screen reader announces which task
            // is live. Only a task the machine marked `running` gets it — the
            // same rule LiveTask's heading follows, for the same reason.
            aria-current={t.status === 'running' ? 'step' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
              t.status === 'running' ? 'bg-status-active/10' : ''
            }`}
          >
            <span className="w-4 shrink-0 text-right font-mono text-xs text-muted-foreground">
              {t.ord + 1}
            </span>
            <Icon className={`size-[18px] shrink-0 ${className}`} aria-hidden="true" />
            <span
              className={`min-w-0 flex-1 truncate ${
                t.status === 'pending' || t.status === 'skipped' ? 'text-muted-foreground' : ''
              }`}
            >
              {t.title}
            </span>
            {took !== null && (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{took}</span>
            )}
            <Badge
              variant={t.status === 'running' ? 'default' : 'outline'}
              className={`shrink-0 font-normal ${
                t.status === 'running'
                  ? 'bg-status-active/15 text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {t.status}
            </Badge>
          </li>
        )
      })}
    </ol>
  )
}
