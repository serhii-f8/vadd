import type { PlanTask } from '../api.js'

/**
 * The current task, and nothing else. **No log stream** — the whole point of
 * the product is reading 10× less text, and the raw view is one header link
 * away for when that is not enough. No `state` prop — the header already
 * shows the machine state, so this component doesn't take it just to leave
 * it unread.
 */
export function LiveTask({ tasks }: { tasks: PlanTask[] }) {
  const running =
    tasks.find((t) => t.status === 'running') ?? tasks.find((t) => t.status !== 'verified')
  return (
    <section>
      <h2 className="text-lg font-medium">{running?.title ?? 'Working'}</h2>
    </section>
  )
}
