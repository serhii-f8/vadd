import { Link } from 'react-router-dom'

/**
 * Where this objective's work actually lives. Read-only.
 *
 * Renders nothing once the columns are null — `integrate: commit` and
 * `discard` both clear them, and a strip naming a worktree that no longer
 * exists is worse than no strip at all.
 */
export function BranchStrip({
  projectId,
  branchName,
  worktreePath,
}: {
  projectId: string
  branchName: string | null
  worktreePath: string | null
}) {
  if (branchName === null && worktreePath === null) return null
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
      {branchName !== null && (
        <Link
          to={`/git?project=${encodeURIComponent(projectId)}&ref=${encodeURIComponent(branchName)}`}
          className="underline"
        >
          {branchName}
        </Link>
      )}
      {worktreePath !== null && <code className="truncate">{worktreePath}</code>}
    </p>
  )
}
