import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ApiError,
  api,
  type GitCommit,
  type GitMutationReport,
  type GitRemote,
  type GitStray,
  type GitTopology,
} from '../api.js'
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
  const [remotes, setRemotes] = useState<GitRemote[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [hasMore, setHasMore] = useState(false)
  /**
   * Remotes-section-only, the same "degrade in place" shape as `logError`
   * below: a remotes fetch is a separate request from the topology fetch it
   * loads alongside, and a failure there must not blank worktrees/branches
   * that loaded fine — the exact bug this console already had to fix once
   * for the log fetch.
   */
  const [remotesError, setRemotesError] = useState<string | null>(null)
  const [strays, setStrays] = useState<GitStray[]>([])
  /**
   * Strays-section-only, the same "degrade in place" shape as `remotesError`
   * above, and for a reason unique to this one: the scan behind it touches
   * the filesystem, so an EACCES or a stale mount is a failure mode git has
   * nothing to do with.
   */
  const [straysError, setStraysError] = useState<string | null>(null)
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
    setRemotesError(null)
    setStraysError(null)
    let t: GitTopology
    try {
      t = await api.getGitTopology(selectedId)
    } catch (e) {
      if (gen !== generationRef.current) return
      setTopology(null)
      setCommits([])
      setHasMore(false)
      setRemotes([])
      setStrays([])
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
    // Independent of the log fetch above: a bad `?ref=` and a remotes
    // failure are unrelated causes, and one degrading must not take the
    // other's already-loaded section down with it.
    try {
      const r = await api.getGitRemotes(selectedId)
      if (gen !== generationRef.current) return
      setRemotes(r.remotes)
    } catch (e) {
      if (gen !== generationRef.current) return
      setRemotes([])
      setRemotesError((e as Error).message)
    }
    // Independent of both the log and the remotes fetch, and for a reason
    // unique to this one: the scan behind it touches the filesystem, so an
    // EACCES or a stale mount is a failure mode git has nothing to do with.
    try {
      const s = await api.getGitStrays(selectedId)
      if (gen !== generationRef.current) return
      setStrays(s.strays)
    } catch (e) {
      if (gen !== generationRef.current) return
      setStrays([])
      setStraysError((e as Error).message)
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
    async (op: string, body: Record<string, unknown>) => {
      if (selectedId === null) return
      setBusy(true)
      setOutcome(null)
      try {
        const { report } = await api.gitMutate(selectedId, op, body)
        setOutcome({ kind: 'ok', report })
        // Neither `fetch` nor `push` leaves anything an undo could restore,
        // by two different mechanisms — worth stating precisely, because the
        // earlier wording here named one mechanism for both and was wrong
        // about `fetch`. `push` runs through `withGitMutation` declaring
        // `undoable: false` (`REMOTE_PLAIN` in
        // `packages/server/src/http/routes/git.ts`), so no `git_undo` row is
        // written. `fetch` never constructs a `MutationKind` at all — it sits
        // outside the wrapper entirely, following `branch/delete`'s
        // precedent, because it moves no local ref. An Undo banner for either
        // would offer to reset the local branch and "un-push" nothing: a
        // real, desynchronising action under a label promising to undo one.
        // `release` is the same shape as `fetch`: it writes no `git_undo`
        // row (it clears a database record or deletes a directory outside
        // the working tree the wrapper's undo mechanism governs), so an
        // Undo banner here would offer to undo the *previous* mutation
        // under a label reading "Release" — the same defect class fixed
        // server-side for `fetch`/`push` in commit `f186053`, reintroduced
        // client-side had this exclusion been left off.
        //
        // For `push` this is now belt to the server's braces rather than the
        // only guard: a non-undoable mutation clears whatever record an
        // earlier one left, so `POST /git/undo` after a push 404s. It used to
        // return 200, and the invariant lived only in this line.
        setUndoable(
          op === 'undo' || op === 'fetch' || op === 'push' || op === 'release'
            ? null
            : report.describes,
        )
      } catch (e) {
        // The server names the objective it refused for; the worktree
        // lookup is only a fallback for an error that carries no body, and
        // `fetch` sends no `worktree` at all (it targets no worktree).
        const named = e instanceof ApiError ? e.body.objectiveId : undefined
        const worktree = body.worktree
        setOutcome({
          kind: 'refused',
          message: (e as Error).message,
          objectiveId:
            typeof named === 'string'
              ? named
              : typeof worktree === 'string'
                ? objectiveOf(worktree)
                : null,
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

  /**
   * The dead end Passes B and C between them opened, named before it is hit.
   *
   * A rewrite (drop, squash) acts on the main checkout's current branch. If
   * the range it touches is already on that branch's upstream, the result can
   * be neither pushed (non-fast-forward, and force push is deliberately out of
   * scope) nor pulled (`--ff-only` cannot reconcile a divergence). Both
   * refusals are individually correct; their combination leaves the user stuck
   * inside VADD with work that is safe but unpublishable. Each pass owned only
   * one half, so nothing warned.
   *
   * `ahead` is how many commits the branch has that the upstream does not, so
   * a rewrite of the last `n` reaches a published commit exactly when
   * `ahead < n`. `null` for either field means there is no upstream to diverge
   * from — nothing to warn about.
   */
  const currentBranch = topology?.branches.find((b) => b.isCurrent) ?? null
  const rewriteReaches = useCallback(
    (n: number): string | null => {
      const b = currentBranch
      if (b?.upstream == null || b.ahead == null) return null
      return b.ahead < n ? b.upstream : null
    },
    [currentBranch],
  )

  /** Appended to a rewrite's armed label, at the moment of the click. */
  const publishedSuffix = (n: number): string => {
    const upstream = rewriteReaches(n)
    if (upstream === null) return ''
    return n === 1
      ? ` It is already on ${upstream}.`
      : ` The range reaches a commit already on ${upstream}.`
  }

  // Shown standing, before anything is armed: the widest range on offer is
  // what decides, because the user reads this while choosing which control to
  // press, not after.
  const widestRange = commits[1] !== undefined ? 2 : 1
  const rewriteWarning =
    commits[0] === undefined || rewriteReaches(widestRange) === null
      ? null
      : `Rewriting ${currentBranch?.name} here diverges from ${rewriteReaches(widestRange)}. ` +
        'VADD offers no force push and pulls fast-forward only, so the result could then be ' +
        'published or reconciled only from a terminal.'

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
            <h2 className="mb-2 text-lg font-medium">Remotes</h2>
            {remotesError !== null ? (
              <Alert variant="destructive">
                <AlertDescription>{remotesError}</AlertDescription>
              </Alert>
            ) : (
              <ul className="flex flex-col gap-1" aria-label="Remotes">
                {remotes.map((r) => (
                  <li key={r.name} className="flex items-baseline gap-2 text-sm">
                    <span className="shrink-0 font-medium">{r.name}</span>
                    <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {r.fetchUrl}
                    </code>
                    {/* Shown only when it diverges — most remotes push where they fetch. */}
                    {r.pushUrl !== r.fetchUrl && (
                      <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        push: {r.pushUrl}
                      </code>
                    )}
                    <ConfirmButton
                      label="Fetch"
                      confirmLabel={`Fetch ${r.name}?`}
                      disabled={busy}
                      onConfirm={() => void runMutation('fetch', { remote: r.name })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(strays.length > 0 || straysError !== null) && (
            <section>
              <h2 className="mb-2 text-lg font-medium">Stray worktrees</h2>
              {straysError !== null ? (
                <Alert variant="destructive">
                  <AlertDescription>{straysError}</AlertDescription>
                </Alert>
              ) : (
                <ul className="flex flex-col gap-1" aria-label="Stray worktrees">
                  {strays.map((s) => (
                    <li key={s.path} className="flex items-baseline gap-2 text-sm">
                      <code className="min-w-0 flex-1 truncate">{s.path}</code>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {s.kind === 'vanished' ? 'directory is gone' : 'git does not track this'}
                      </span>
                      {s.claim !== null && (
                        <span className="shrink-0 truncate text-xs">{s.claim.objectiveTitle}</span>
                      )}
                      {/*
                        Two labels, because the two kinds cost different
                        things. Releasing a vanished row clears a record and
                        touches no file; releasing a stranded one deletes a
                        directory whose size is not knowable from here, which
                        is why that label names the path rather than an
                        objective — an unclaimed stray has no objective, and a
                        label implying otherwise would be worse than none.

                        The `vanished` label used to read "Clear this record?
                        Nothing on disk is touched." with nothing identifying
                        WHICH record — several vanished rows in the list would
                        arm identical-looking confirm buttons, the same shape
                        of finding already recorded once for Pass C's two
                        push-confirm buttons. `vanished`'s `claim` is never
                        null by construction (only a claimed path can be
                        classified vanished — see `strays.ts`), so the
                        objective's own title is always available to name.
                      */}
                      <ConfirmButton
                        label="Release"
                        confirmLabel={
                          s.kind === 'vanished'
                            ? `Clear the record for “${s.claim.objectiveTitle}”? Nothing on disk is touched.`
                            : `Delete ${s.path} and everything in it?`
                        }
                        disabled={busy}
                        onConfirm={() => void runMutation('release', { path: s.path })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section>
            <h2 className="mb-2 text-lg font-medium">Branches</h2>
            <ul className="flex flex-col gap-1" aria-label="Branches">
              {topology.branches.map((b) => (
                <li key={b.name} className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  {b.upstream !== null && (
                    <span className="shrink-0 text-xs text-muted-foreground">→ {b.upstream}</span>
                  )}
                  {b.ahead !== null && (
                    <span className="shrink-0 text-xs text-muted-foreground">{b.ahead} ahead</span>
                  )}
                  {b.behind !== null && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {b.behind} behind
                    </span>
                  )}
                  {b.isCurrent && <span className="shrink-0 text-xs">current</span>}
                  <OwnerBadge owner={b.owner} />
                  {/*
                    One control per remote rather than guessing which of
                    several a click meant — the common single-remote case
                    still reads as one plain "Push" button.
                  */}
                  {remotes.map((r) => (
                    <ConfirmButton
                      key={`push-${r.name}`}
                      label={remotes.length > 1 ? `Push to ${r.name}` : 'Push'}
                      /*
                        Both arms name the remote. The VADD arm used to drop
                        it, so with two remotes configured the two push
                        buttons on one `vadd/<8hex>` row showed identical
                        armed text naming neither — at the exact moment of
                        the destructive second click.
                      */
                      confirmLabel={
                        b.owner.kind === 'vadd'
                          ? `Push ${b.name} to ${r.name}? The remote copy outlives integrate: discard.`
                          : `Push ${b.name} to ${r.name}?`
                      }
                      disabled={busy}
                      onConfirm={() =>
                        void runMutation('push', {
                          worktree: topology.mainRepoPath,
                          remote: r.name,
                          branch: b.name,
                          setUpstream: b.upstream === null,
                        })
                      }
                    />
                  ))}
                  {b.isCurrent &&
                    remotes.map((r) => (
                      <ConfirmButton
                        key={`pull-${r.name}`}
                        label={remotes.length > 1 ? `Pull from ${r.name}` : 'Pull'}
                        confirmLabel={`Pull from ${r.name}?`}
                        disabled={busy}
                        onConfirm={() =>
                          void runMutation('pull', {
                            worktree: topology.mainRepoPath,
                            remote: r.name,
                          })
                        }
                      />
                    ))}
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
                {rewriteWarning !== null && (
                  <p
                    role="status"
                    aria-label="Rewrite warning"
                    className="mb-2 text-sm text-destructive"
                  >
                    {rewriteWarning}
                  </p>
                )}
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
                      confirmLabel={`Really drop “${commits[0].subject}”?${publishedSuffix(1)}`}
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
                        confirmLabel={`Squash the last two commits into one?${publishedSuffix(2)}`}
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
