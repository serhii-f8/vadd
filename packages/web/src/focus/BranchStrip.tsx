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
  worktreeMissing,
}: {
  projectId: string
  branchName: string | null
  worktreePath: string | null
  worktreeMissing: boolean
}) {
  if (branchName === null && worktreePath === null) return null
  return (
    <>
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
      {/*
        Read-only on purpose: the repair lives in the /git console with the
        other git-state controls. What this has to do is make sure a user who
        clicks Resume learns why it will not work *before* they click it,
        rather than meeting a 500.
      */}
      {worktreeMissing && (
        <p role="status" className="text-xs text-destructive">
          This worktree directory no longer exists, so this objective cannot continue.{' '}
          <Link to={`/git?project=${encodeURIComponent(projectId)}`} className="underline">
            Release it in the git console
          </Link>
          .
        </p>
      )}
    </>
  )
}
