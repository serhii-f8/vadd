import { Download, GitBranch, RefreshCw, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GitBranch as Branch, GitRemote, GitTopology } from '../api.js'
import { ConfirmButton } from './ConfirmButton.js'

/**
 * The console's header: where the repository is, which branch is checked
 * out, how it stands against its upstream, and the three network actions for
 * that branch — the same `ConfirmButton`s the branch row used to carry,
 * placed where the question "am I in sync?" is asked.
 *
 * Fetch is per remote and lives on the remote's row; a push or pull without a
 * remote is not offered at all.
 */
export function SyncHeader({
  topology,
  remotes,
  busy,
  onMutate,
  onRefresh,
}: {
  topology: GitTopology | null
  remotes: GitRemote[]
  busy: boolean
  onMutate: (op: string, body: Record<string, unknown>) => void
  onRefresh: () => void
}) {
  const current: Branch | null = topology?.branches.find((b) => b.isCurrent) ?? null
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Git</h1>
        {topology !== null && (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <code className="min-w-0 truncate text-xs">{topology.mainRepoPath}</code>
            {current !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1.5">
                  <GitBranch className="size-3.5" aria-hidden="true" />
                  <code className="text-xs text-foreground">{current.name}</code>
                </span>
                {current.upstream !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="flex items-center gap-1.5">
                      <Upload className="size-3.5" aria-hidden="true" />
                      {current.ahead ?? '?'} ahead
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Download className="size-3.5" aria-hidden="true" />
                      {current.behind ?? '?'} behind
                    </span>
                    <code className="text-xs">{current.upstream}</code>
                  </>
                )}
              </>
            )}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {topology !== null &&
          current !== null &&
          remotes.map((r) => (
            <ConfirmButton
              key={`pull-${r.name}`}
              label={remotes.length > 1 ? `Pull from ${r.name}` : 'Pull'}
              confirmLabel={`Pull from ${r.name}?`}
              disabled={busy}
              tone="caution"
              onConfirm={() =>
                onMutate('pull', { worktree: topology.mainRepoPath, remote: r.name })
              }
            />
          ))}
        {topology !== null &&
          current !== null &&
          remotes.map((r) => (
            <ConfirmButton
              key={`push-${r.name}`}
              label={
                remotes.length > 1
                  ? `Push to ${r.name}`
                  : current.ahead !== null && current.ahead > 0
                    ? `Push ${current.ahead}`
                    : 'Push'
              }
              confirmLabel={`Push ${current.name} to ${r.name}?`}
              disabled={busy}
              tone="caution"
              onConfirm={() =>
                onMutate('push', {
                  worktree: topology.mainRepoPath,
                  remote: r.name,
                  branch: current.name,
                  setUpstream: current.upstream === null,
                })
              }
            />
          ))}
        <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={onRefresh}>
          <RefreshCw />
        </Button>
      </div>
    </header>
  )
}
