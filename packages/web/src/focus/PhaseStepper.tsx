import { Check, Loader2 } from 'lucide-react'
import type { Phase } from './phase.js'

/**
 * Where the objective is in the workflow, as seven steps. Reads `phasesFor`
 * and nothing else; the machine's state is the source of truth.
 *
 * `compact` (narrow layouts) keeps only the current phase's label on screen —
 * the others stay in the accessibility tree.
 */
export function PhaseStepper({ phases, compact = false }: { phases: Phase[]; compact?: boolean }) {
  return (
    <ol
      aria-label="Phases"
      className="flex items-center overflow-x-auto rounded-xl bg-card px-4 py-3.5 ring-1 ring-foreground/10"
    >
      {phases.map((p, i) => {
        const hideLabel = compact && p.status !== 'current'
        return (
          <li
            key={p.key}
            data-status={p.status}
            aria-current={p.status === 'current' ? 'step' : undefined}
            className={`flex items-center ${i < phases.length - 1 ? 'flex-1' : ''}`}
          >
            <span
              className={`flex items-center gap-2 text-[13px] whitespace-nowrap ${
                p.status === 'current'
                  ? 'font-medium text-foreground'
                  : p.status === 'done'
                    ? 'text-foreground'
                    : p.status === 'skipped'
                      ? 'text-muted-foreground line-through opacity-60'
                      : 'text-muted-foreground'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11px] font-medium ${
                  p.status === 'done'
                    ? 'border-status-done bg-status-done text-primary-foreground'
                    : p.status === 'current'
                      ? 'border-status-active bg-status-active/15 text-status-active'
                      : 'border-border'
                }`}
              >
                {p.status === 'done' ? (
                  <Check className="size-3" />
                ) : p.status === 'current' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <span className={hideLabel ? 'sr-only' : ''}>{p.label}</span>
              {p.status === 'skipped' && <span className="sr-only">(skipped)</span>}
            </span>
            {i < phases.length - 1 && (
              <span
                aria-hidden="true"
                className={`mx-2.5 h-px min-w-4 flex-1 ${
                  p.status === 'done' ? 'bg-status-done' : 'bg-border'
                }`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
