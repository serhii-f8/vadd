import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type GitCommit, type GitTopology } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'
import { CommitLog } from '../git/CommitLog.js'
import { OwnerBadge } from '../git/OwnerBadge.js'

export function GitConsole() {
  const { selectedId } = useProjects()
  const [searchParams] = useSearchParams()
  const ref = searchParams.get('ref') ?? undefined

  const [topology, setTopology] = useState<GitTopology | null>(null)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (selectedId === null) return
    // Cleared before the fetch: a failure must not leave the previous
    // project's topology on screen under the new project's name — the same
    // stale-data bug the daily summary already had to fix once.
    setError(null)
    try {
      const [t, l] = await Promise.all([
        api.getGitTopology(selectedId),
        api.getGitLog(selectedId, { ref }),
      ])
      setTopology(t)
      setCommits(l.commits)
    } catch (e) {
      setTopology(null)
      setCommits([])
      setError((e as Error).message)
    }
  }, [selectedId, ref])

  useEffect(() => {
    void load()
  }, [load])

  // Git state changes from *outside* VADD — the user committing in a terminal
  // — and the EventBus only knows what VADD itself did, so SSE would update
  // reliably for the changes that do not matter here and never for the ones
  // that do. Alt-tab back is the real signal.
  useEffect(() => {
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Git</h1>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </header>

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {topology === null && error === null && <Skeleton className="h-8 w-full" />}

      {topology !== null && (
        <>
          <section>
            <h2 className="mb-2 text-lg font-medium">Worktrees</h2>
            <ul className="flex flex-col gap-1" aria-label="Worktrees">
              {topology.worktrees.map((w) => (
                <li key={w.path} className="flex items-baseline gap-2 text-sm">
                  <code className="min-w-0 flex-1 truncate">{w.path}</code>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {w.branch ?? 'detached'}
                  </span>
                  {w.prunable && <span className="shrink-0 text-xs">prunable</span>}
                  <OwnerBadge owner={w.owner} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium">Branches</h2>
            <ul className="flex flex-col gap-1" aria-label="Branches">
              {topology.branches.map((b) => (
                <li key={b.name} className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  {b.isCurrent && <span className="shrink-0 text-xs">current</span>}
                  <OwnerBadge owner={b.owner} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium">History</h2>
            <CommitLog commits={commits} />
          </section>
        </>
      )}
    </main>
  )
}
