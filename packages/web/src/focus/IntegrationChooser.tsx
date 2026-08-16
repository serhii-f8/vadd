/**
 * Three genuinely different outcomes, each with its consequence spelled out:
 * a user cannot be expected to know which one deletes a branch.
 */
const ACTIONS = [
  {
    action: 'commit',
    label: 'Commit',
    detail: 'Squash the checkpoints into one commit; keep the branch, remove the worktree.',
  },
  {
    action: 'keep',
    label: 'Keep',
    detail: 'Leave the worktree and branch exactly as they are, to go on by hand.',
  },
  {
    action: 'discard',
    label: 'Discard',
    detail: 'Delete the worktree and branch. The objective and its evidence are kept.',
  },
] as const

export function IntegrationChooser({
  onCommand,
}: {
  onCommand: (body: Record<string, unknown>) => void
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-medium">Integrate</h2>
      <ul className="space-y-2">
        {ACTIONS.map((a) => (
          <li key={a.action} className="flex items-baseline gap-3">
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() => onCommand({ type: 'integrate', action: a.action })}
            >
              {a.label}
            </button>
            <span className="text-sm text-gray-600">{a.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
