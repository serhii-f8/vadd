import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  /**
   * `setLoadingMore` does not resolve synchronously, so two clicks landing
   * before the first render flush both see `loadingMore === false` and both
   * fire — a real double-click race, not a hypothetical one. The ref is
   * checked and flipped synchronously, before the first `await`, so the
   * second click's call returns immediately no matter how close together the
   * two clicks land.
   */
  const loadingMoreRef = useRef(false)

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
      setHasMore(l.hasMore)
    } catch (e) {
      setTopology(null)
      setCommits([])
      setHasMore(false)
      setError((e as Error).message)
    }
  }, [selectedId, ref])

  /**
   * Fetches the next page using the last currently-loaded commit's sha as
   * the cursor, and appends rather than replaces. A failed "load more"
   * leaves whatever is already on screen alone — it does not reset
   * `topology` or `commits` the way a failed `load()` does.
   */
  const loadMore = useCallback(async () => {
    if (selectedId === null) return
    if (loadingMoreRef.current) return
    const last = commits[commits.length - 1]
    if (last === undefined) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const l = await api.getGitLog(selectedId, { ref, before: last.sha })
      setCommits((prev) => [...prev, ...l.commits])
      setHasMore(l.hasMore)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [selectedId, ref, commits])

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
            {hasMore && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                Load 50 more
              </Button>
            )}
          </section>
        </>
      )}
    </main>
  )
}
