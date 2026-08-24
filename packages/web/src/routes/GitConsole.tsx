import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, api, type GitCommit, type GitMutationReport, type GitTopology } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'
import { CommitLog } from '../git/CommitLog.js'
import { ConfirmButton } from '../git/ConfirmButton.js'
import { OwnerBadge } from '../git/OwnerBadge.js'
import { UndoBanner } from '../git/UndoBanner.js'

export function GitConsole() {
  const { selectedId } = useProjects()
  const [searchParams] = useSearchParams()
  const ref = searchParams.get('ref') ?? undefined

  const [topology, setTopology] = useState<GitTopology | null>(null)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [hasMore, setHasMore] = useState(false)
  /** Page-level: the topology fetch failed, so there is nothing to render. */
  const [error, setError] = useState<string | null>(null)
  /**
   * History-region-only: the topology loaded fine (worktrees and branches
   * are real and worth showing) but the log fetch — the one most likely to
   * fail, since a stale or wrong `?ref=` from a bookmark or another
   * project's branch strip lands here — did not. Kept separate from `error`
   * so a bad `ref` degrades the History section instead of taking down the
   * whole page (mirrors `ProjectsContext`'s "a stale bookmark should
   * degrade, not break").
   */
  const [logError, setLogError] = useState<string | null>(null)
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
  /**
   * Discards a stale response rather than letting it land after a newer
   * fetch already replaced state. `load()` (fired by mount, the "Refresh"
   * button, or the window-focus handler) and `loadMore()` both read the
   * generation they started with and re-check it after every `await`; a
   * `loadMore` in flight when a `load()` starts is the exact race that used
   * to append a stale older page onto a freshly reloaded first page.
   */
  const generationRef = useRef(0)

  /**
   * The outcome of the last mutation, rendered in place beneath the header.
   *
   * Deliberately not a toast: a refusal names a state the user has to act on
   * (§3's Pause), and a rewrite names tasks that just lost their rollback
   * point. Both are things to read, not things to glimpse.
   */
  const [outcome, setOutcome] = useState<
    | { kind: 'ok'; report: GitMutationReport }
    | { kind: 'refused'; message: string; objectiveId: string | null }
    | null
  >(null)
  const [undoable, setUndoable] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * The objective a 409 refers to, so the refusal can offer its Pause.
   *
   * Read off the worktree the operation targeted rather than parsed out of
   * the message: the message is prose for the user, and reconstructing an id
   * from prose is the kind of coupling that breaks the next time the wording
   * changes.
   */
  const objectiveOf = useCallback(
    (worktreePath: string): string | null => {
      const w = topology?.worktrees.find((x) => x.path === worktreePath)
      return w?.owner.kind === 'vadd' ? w.owner.objectiveId : null
    },
    [topology],
  )

  const load = useCallback(async () => {
    if (selectedId === null) return
    const gen = ++generationRef.current
    // Cleared before the fetch: a failure must not leave the previous
    // project's topology on screen under the new project's name — the same
    // stale-data bug the daily summary already had to fix once.
    setError(null)
    setLogError(null)
    let t: GitTopology
    try {
      t = await api.getGitTopology(selectedId)
    } catch (e) {
      if (gen !== generationRef.current) return
      setTopology(null)
      setCommits([])
      setHasMore(false)
      setError((e as Error).message)
      return
    }
    if (gen !== generationRef.current) return
    setTopology(t)
    try {
      const l = await api.getGitLog(selectedId, { ref })
      if (gen !== generationRef.current) return
      setCommits(l.commits)
      setHasMore(l.hasMore)
    } catch (e) {
      if (gen !== generationRef.current) return
      setCommits([])
      setHasMore(false)
      setLogError((e as Error).message)
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
    const gen = ++generationRef.current
    try {
      const l = await api.getGitLog(selectedId, { ref, before: last.sha })
      if (gen !== generationRef.current) return
      setCommits((prev) => [...prev, ...l.commits])
      setHasMore(l.hasMore)
    } catch (e) {
      if (gen !== generationRef.current) return
      setLogError((e as Error).message)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [selectedId, ref, commits])

  /**
   * Runs one mutation and reports its outcome in place.
   *
   * Every route answers the same two shapes — `{ report }` or an `error` —
   * so this is written once rather than per control, for the same reason
   * `withGitMutation` exists on the server side.
   */
  const runMutation = useCallback(
    async (op: string, body: { worktree: string } & Record<string, unknown>) => {
      if (selectedId === null) return
      setBusy(true)
      setOutcome(null)
      try {
        const { report } = await api.gitMutate(selectedId, op, body)
        setOutcome({ kind: 'ok', report })
        setUndoable(op === 'undo' ? null : report.describes)
      } catch (e) {
        // The server names the objective it refused for; the worktree
        // lookup is only a fallback for an error that carries no body.
        const named = e instanceof ApiError ? e.body.objectiveId : undefined
        setOutcome({
          kind: 'refused',
          message: (e as Error).message,
          objectiveId: typeof named === 'string' ? named : objectiveOf(body.worktree),
        })
      } finally {
        setBusy(false)
      }
      await load()
    },
    [selectedId, objectiveOf, load],
  )

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

      {outcome?.kind === 'refused' && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{outcome.message}</span>
            {outcome.objectiveId !== null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void api
                    .command(outcome.objectiveId as string, { type: 'pause' })
                    .then(() => load())
                }}
              >
                Pause objective
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {outcome?.kind === 'ok' && (
        <Alert>
          <AlertDescription className="flex flex-col gap-1">
            <span>{outcome.report.describes}</span>
            {(outcome.report.excludedPaths ?? []).length > 0 && (
              <span className="text-sm">
                Kept out of the commit by policy.protectedGlobs:{' '}
                {(outcome.report.excludedPaths ?? []).join(', ')}
              </span>
            )}
            {(outcome.report.clearedCheckpoints ?? []).length > 0 && (
              <span className="text-sm">
                These tasks lost their rollback point:{' '}
                {(outcome.report.clearedCheckpoints ?? []).map((c) => c.title).join(', ')}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <UndoBanner
        describes={undoable}
        busy={busy}
        onUndo={() => {
          const main = topology?.mainRepoPath
          if (main !== undefined) void runMutation('undo', { worktree: main })
        }}
      />

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
                  <ConfirmButton
                    label="Stash"
                    confirmLabel="Stash all changes here?"
                    disabled={busy}
                    onConfirm={() => void runMutation('stash', { worktree: w.path })}
                  />
                  {/*
                    Refused on a VADD-owned worktree, so it is not offered
                    there either: /diff, rollback and integrate: discard all
                    depend on objectives.branchName, and discard deletes the
                    branch it is handed. The server refuses this
                    independently — the UI hiding it is convenience, not the
                    guard.
                  */}
                  {w.owner.kind !== 'vadd' && topology.currentBranch !== null && (
                    <ConfirmButton
                      label="Switch branch"
                      confirmLabel={`Switch to ${topology.currentBranch}?`}
                      disabled={busy}
                      onConfirm={() =>
                        void runMutation('checkout', {
                          worktree: w.path,
                          branch: topology.currentBranch as string,
                        })
                      }
                    />
                  )}
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
                  {b.upstream !== null && (
                    <span className="shrink-0 text-xs text-muted-foreground">→ {b.upstream}</span>
                  )}
                  {b.isCurrent && <span className="shrink-0 text-xs">current</span>}
                  <OwnerBadge owner={b.owner} />
                  {b.owner.kind !== 'vadd' && !b.isCurrent && (
                    <ConfirmButton
                      label="Delete branch"
                      confirmLabel={`Delete ${b.name}?`}
                      disabled={busy}
                      onConfirm={() => {
                        if (selectedId === null) return
                        setBusy(true)
                        setOutcome(null)
                        void api
                          .gitMutate(selectedId, 'branch/delete', { name: b.name })
                          .then(({ report }) => setOutcome({ kind: 'ok', report }))
                          .catch((e: Error) =>
                            setOutcome({ kind: 'refused', message: e.message, objectiveId: null }),
                          )
                          .finally(() => {
                            setBusy(false)
                            void load()
                          })
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium">History</h2>
            {logError !== null ? (
              <Alert variant="destructive">
                <AlertDescription>{logError}</AlertDescription>
              </Alert>
            ) : (
              <>
                {commits[0] !== undefined && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {/*
                      Only the tip. Squash, reword and drop are all narrowed
                      to ranges ending at HEAD: rewriting mid-branch needs a
                      rebase, and a rebase that conflicts stops in a state
                      this pass has no UI for (design §11).
                    */}
                    <ConfirmButton
                      label="Drop commit"
                      confirmLabel={`Really drop “${commits[0].subject}”?`}
                      disabled={busy}
                      onConfirm={() =>
                        void runMutation('drop', {
                          worktree: topology.mainRepoPath,
                          sha: (commits[0] as GitCommit).sha,
                        })
                      }
                    />
                    {commits[1] !== undefined && (
                      <ConfirmButton
                        label="Squash last two"
                        confirmLabel="Squash the last two commits into one?"
                        disabled={busy}
                        onConfirm={() =>
                          void runMutation('squash', {
                            worktree: topology.mainRepoPath,
                            from: (commits[1] as GitCommit).sha,
                            to: (commits[0] as GitCommit).sha,
                            message: (commits[1] as GitCommit).subject,
                          })
                        }
                      />
                    )}
                  </div>
                )}
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
              </>
            )}
          </section>
        </>
      )}
    </main>
  )
}
