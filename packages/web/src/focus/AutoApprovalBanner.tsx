import { useState } from 'react'
import type { Aggregate } from '../api.js'

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
      className="mb-4 flex items-center justify-between gap-4 rounded border border-green-300 bg-green-50 p-3 text-sm"
    >
      <p>✅ Verified{lastAutoApproval.kind === 'plan' ? ' plan' : ''}. Good stopping point.</p>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border px-2 py-1"
          onClick={() => setDismissedAt(lastAutoApproval.at)}
        >
          Continue
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          onClick={() => {
            setDismissedAt(lastAutoApproval.at)
            onCommand({ type: 'pause' })
          }}
        >
          Stop for now
        </button>
      </div>
    </div>
  )
}
