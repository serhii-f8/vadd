import { Progress as ProgressPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A determinate bar. `tone` picks the fill from the status tokens: `done`
 * (green) for verified work, `active` (blue) for a run in progress.
 */
function Progress({
  className,
  value,
  max = 100,
  tone = 'done',
  ...props
}: Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, 'value' | 'max'> & {
  value: number
  max?: number
  tone?: 'done' | 'active'
}) {
  // Radix rejects `max <= 0`; an empty plan is a legitimate input here.
  const safeMax = max > 0 ? max : 1
  const safeValue = max > 0 ? Math.min(value, max) : 0
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={safeValue}
      max={safeMax}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          'h-full rounded-full transition-transform',
          tone === 'active' ? 'bg-status-active' : 'bg-status-done',
        )}
        style={{ transform: `translateX(-${100 - (safeValue / safeMax) * 100}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
