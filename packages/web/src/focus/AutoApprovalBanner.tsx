import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import type { Aggregate } from '../api.js'
import { Button } from '../components/ui/button.js'

type Props = {
  lastAutoApproval: Aggregate['lastAutoApproval']
  onCommand: (body: Record<string, unknown>) => void
}

/**
 * D13's "Good stopping point" banner (amendment A12). Purely informational:
 * by the time the aggregate reports `lastAutoApproval`, the machine has
 * already advanced past `awaitingReview`/`awaitingPlanApproval` on its own —
 * Continue only dismisses this banner, it never sends a command.
 */
export function AutoApprovalBanner({ lastAutoApproval, onCommand }: Props) {
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  if (!lastAutoApproval || lastAutoApproval.at === dismissedAt) return null

  return (
    <div
      role="status"
      className="mb-4 flex items-center justify-between gap-4 rounded border border-status-done/40 bg-status-done/10 p-3 text-sm"
    >
      <p className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-status-done" aria-hidden="true" />
        Verified{lastAutoApproval.kind === 'plan' ? ' plan' : ''}. Good stopping point.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDismissedAt(lastAutoApproval.at)}
        >
          Continue
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setDismissedAt(lastAutoApproval.at)
            onCommand({ type: 'pause' })
          }}
        >
          Stop for now
        </Button>
      </div>
    </div>
  )
}
