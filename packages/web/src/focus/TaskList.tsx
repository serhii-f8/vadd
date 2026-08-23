import { Badge } from '@/components/ui/badge'
import type { PlanTask } from '../api.js'

/**
 * The plan, readable at a glance.
 *
 * This replaces a strip of 8px dots whose titles and statuses were reachable
 * only by hovering one at a time — which made the plan effectively invisible,
 * and made a tooltip string like "<task title> — pending" impossible to place.
 * Level 0 per task: an ordinal, a title, a status word. Nothing else.
 */
export function TaskList({ tasks }: { tasks: PlanTask[] }) {
  return (
    <ol className="flex flex-col gap-1" aria-label="Plan">
      {tasks.map((t) => (
        <li
          key={t.id}
          // `aria-current="step"` is how a screen reader announces which task
          // is live. Only a task the machine marked `running` gets it — the
          // same rule LiveTask's heading follows, for the same reason.
          aria-current={t.status === 'running' ? 'step' : undefined}
          className={`flex items-baseline gap-2 rounded-md px-2 py-1 text-sm ${
            t.status === 'running' ? 'bg-accent text-accent-foreground' : ''
          }`}
        >
          <span className="w-4 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {t.ord + 1}
          </span>
          <span className="min-w-0 flex-1">{t.title}</span>
          <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
            {t.status}
          </Badge>
        </li>
      ))}
    </ol>
  )
}
