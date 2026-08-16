import type { PlanTask } from '../api.js'

/**
 * The current task, and nothing else. **No log stream** — the whole point of
 * the product is reading 10× less text, and the raw view is one header link
 * away for when that is not enough. `state` is part of the props shape (the
 * header already shows it) rather than repeated here — this component does
 * not re-render it, to avoid showing the same phase name twice on screen.
 */
export function LiveTask({ tasks }: { state: string; tasks: PlanTask[] }) {
  const running =
    tasks.find((t) => t.status === 'running') ?? tasks.find((t) => t.status !== 'verified')
  return (
    <section>
      <h2 className="text-lg font-medium">{running?.title ?? 'Working'}</h2>
    </section>
  )
}
