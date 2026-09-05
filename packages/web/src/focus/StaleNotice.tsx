import { CircleAlert, FileText, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatElapsed } from './elapsed.js'

/** After this much silence the live card stops looking merely busy. */
export const STALE_AFTER_MS = 60_000

/**
 * "Is anything happening?" answered honestly when the answer is "not for a
 * while". The turn is still open — the machine has not failed — so this is
 * amber, names the usual benign cause, and offers the two things a user can
 * do about it: look at the raw transcript, or pause.
 */
export function StaleNotice({
  lastAgentUpdateAt,
  now,
  rawHref,
  onCommand,
}: {
  lastAgentUpdateAt: string | null
  now: number
  rawHref: string
  onCommand: (body: Record<string, unknown>) => void
}) {
  if (lastAgentUpdateAt === null) return null
  if (now - Date.parse(lastAgentUpdateAt) < STALE_AFTER_MS) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-status-attention/60"
    >
      <CircleAlert className="size-4 shrink-0 text-status-attention" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        No agent output for{' '}
        <span className="font-mono font-medium">{formatElapsed(lastAgentUpdateAt, now)}</span>. The
        turn is still open; long test suites are the usual cause.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={rawHref}>
            <FileText />
            Raw transcript
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={() => onCommand({ type: 'pause' })}>
          <Pause />
          Pause
        </Button>
      </div>
    </div>
  )
}
