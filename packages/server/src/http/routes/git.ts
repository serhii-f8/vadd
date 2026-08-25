import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { gitUndo, objectives, projects } from '../../db/schema.js'
import { createWorktree, removeWorktree } from '../../git/git-manager.js'
import {
  aheadBehind,
  listBranches,
  listWorktreesDetailed,
  readLog,
  readStatus,
} from '../../git/inspect.js'
import {
  amendHead,
  checkoutBranch,
  commitStaged,
  createBranch,
  declaredStatus,
  deleteBranch,
  discardPaths,
  dropCommit,
  type MutationKind,
  type MutationTarget,
  rewordCommit,
  squashRange,
  stagePaths,
  stashPop,
  stashPush,
  undoTo,
  unstagePaths,
  withGitMutation,
} from '../../git/mutate.js'
import { gateForStatus } from '../../git/mutation-gate.js'
import { guardOperation, type OperationName } from '../../git/mutation-guards.js'
import { readProtectedGlobs } from '../../git/protected-globs.js'
import { type OwnedObjective, ownerOfBranch, ownerOfWorktree } from '../../git/provenance.js'
import { fetchRemote, listRemotes, pullFastForward, pushBranch } from '../../git/remote.js'
import { GitError } from '../../git/run.js'
import { readStrays } from '../../git/strays.js'
import { worktreePathFor } from '../../paths.js'
import type { AppDeps } from '../app.js'

const SHA = /^[0-9a-f]{4,40}$/
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function registerGitRoutes(app: FastifyInstance, { db, bus }: AppDeps): void {
  /** Every route here needs the project; none of them proceed without it. */
  function project(id: string) {
    return db.select().from(projects).where(eq(projects.id, id)).get()
  }

  function ownedObjectives(projectId: string): OwnedObjective[] {
    return db
      .select({
        id: objectives.id,
        title: objectives.title,
        status: objectives.status,
        branchName: objectives.branchName,
        worktreePath: objectives.worktreePath,
      })
      .from(objectives)
      .where(eq(objectives.projectId, projectId))
      .all()
  }

  app.get<{ Params: { id: string } }>('/api/projects/:id/git', async (req, reply) => {
    const p = project(req.params.id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })

    const rows = ownedObjectives(p.id)
    // `worktreePathFor(projectId, objectiveId)` is
    // `<vaddHome>/worktrees/<projectId>/<objectiveId>`; its dirname is the
    // per-project root every worktree of this project lives under.
    const worktreeRoot = dirname(worktreePathFor(p.id, 'x'))

    const [branches, worktrees] = await Promise.all([
      listBranches(p.repoPath),
      listWorktreesDetailed(p.repoPath),
    ])

    const branchRows = await Promise.all(
      branches.map(async (b) => ({
        ...b,
        owner: ownerOfBranch(b.name, rows),
        ...(await aheadBehind(p.repoPath, b.name).then((ab) => ({
          ahead: ab?.ahead ?? null,
          behind: ab?.behind ?? null,
        }))),
      })),
    )

    return {
      mainRepoPath: p.repoPath,
      currentBranch: branches.find((b) => b.isCurrent)?.name ?? null,
      branches: branchRows,
      worktrees: worktrees.map((w) => ({
        ...w,
        owner: ownerOfWorktree(w.path, rows, worktreeRoot),
      })),
    }
  })

  app.get<{
    Params: { id: string }
    Querystring: { ref?: string; limit?: string; before?: string }
  }>('/api/projects/:id/git/log', async (req, reply) => {
    const p = project(req.params.id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })

    const { ref, before } = req.query
    if (before !== undefined && !SHA.test(before)) {
      // A cursor cannot be checked against a list, so it is constrained by
      // shape. `--all` and `HEAD^{/rm -rf}` are both rejected here.
      return reply.code(400).send({ error: 'before must be a commit sha' })
    }
    if (ref !== undefined) {
      const branches = await listBranches(p.repoPath)
      if (!branches.some((b) => b.name === ref)) {
        // Checked against the real branch list rather than a character
        // filter: this also stops a value that would be read as an option.
        return reply.code(400).send({ error: `Not a branch of this repository: ${ref}` })
      }
    }

    const parsed = Number.parseInt(req.query.limit ?? '', 10)
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : DEFAULT_LIMIT

    // One extra row is fetched purely to answer `hasMore` without a second
    // count query, then dropped.
    try {
      const commits = await readLog(p.repoPath, { ref, before, limit: limit + 1 })
      return { commits: commits.slice(0, limit), hasMore: commits.length > limit }
    } catch (err) {
      // `readLog` throws a `GitError` (code EGIT) when `before` names a
      // syntactically valid sha that isn't reachable from `tip` — a bad
      // caller argument, the same class as a non-branch `ref` or a
      // non-sha `before`, not a server fault.
      if (err instanceof GitError) {
        return reply.code(400).send({ error: err.message })
      }
      throw err
    }
  })

  app.get<{ Params: { id: string }; Querystring: { worktree?: string } }>(
    '/api/projects/:id/git/status',
    async (req, reply) => {
      const p = project(req.params.id)
      if (!p) return reply.code(404).send({ error: 'Project not found' })

      const wanted = req.query.worktree
      if (wanted === undefined) {
        return reply.code(400).send({ error: 'worktree is required' })
      }
      const known = await listWorktreesDetailed(p.repoPath)
      if (!known.some((w) => w.path === wanted)) {
        return reply.code(400).send({ error: 'Not a worktree of this repository' })
      }
      return readStatus(wanted)
    },
  )

  // ---------------------------------------------------------------------
  // Mutations (amendment A19). Every one goes through `withGitMutation`.
  // ---------------------------------------------------------------------

  type Project = NonNullable<ReturnType<typeof project>>

  /** The per-project worktree root, as the topology route computes it. */
  function rootFor(p: Project): string {
    return dirname(worktreePathFor(p.id, 'x'))
  }

  /**
   * Steps 1–5 of every mutation route, written once.
   *
   * `worktree` is checked against what git itself reports for this project
   * rather than against a character filter — Pass A's argument rule, and the
   * reason a value that would be read as an option cannot get through.
   */
  async function resolveTarget(
    p: Project,
    worktree: unknown,
  ): Promise<{ ok: true; target: MutationTarget } | { ok: false; status: number; error: string }> {
    if (typeof worktree !== 'string' || worktree === '') {
      return { ok: false, status: 400, error: 'worktree is required' }
    }
    const known = await listWorktreesDetailed(p.repoPath)
    const match = known.find((w) => resolve(w.path) === resolve(worktree))
    if (!match) {
      return { ok: false, status: 400, error: 'Not a worktree of this repository' }
    }

    const rows = ownedObjectives(p.id)
    const owner = ownerOfWorktree(match.path, rows, rootFor(p))
    const objectiveRow =
      owner.kind === 'vadd'
        ? db.select().from(objectives).where(eq(objectives.id, owner.objectiveId)).get()
        : undefined

    // Read through the one helper the squash also uses, so a manual commit and
    // `integrate: commit` cannot disagree about what is protected — and so
    // that "no globs declared" and "the spec is unreadable" stay two different
    // answers. They used to be the same `[]`, which silently disabled the
    // policy at exactly the moment it mattered.
    const globs = readProtectedGlobs(objectiveRow?.verificationSpec)
    if (!globs.ok) {
      // Every mutation on this worktree, not only the commit-creating ones:
      // a spec VADD cannot parse is a fault the user has to see, and the
      // same column drives verification. Over-refusing costs a trip to a
      // terminal; under-refusing costs a protected file on a branch.
      return { ok: false, status: 500, error: globs.reason }
    }

    return {
      ok: true,
      target: {
        worktreePath: match.path,
        owner,
        objective:
          objectiveRow === undefined
            ? null
            : {
                id: objectiveRow.id,
                status: objectiveRow.status,
                branchName: objectiveRow.branchName,
              },
        protectedGlobs: globs.globs,
      },
    }
  }

  /**
   * Repo-relative paths only, and only ones that stay inside the worktree.
   *
   * The design says to check `paths[]` against "the working tree's own
   * reported paths", but `readStatus` returns counts, not paths — there is no
   * such list to check against. This is the design's own stated fallback,
   * strengthened: `..` and a leading `/` are both rejected outright, and the
   * resolved path must still land under the worktree, which catches the cases
   * a substring check would not (a symlinked segment aside, which git itself
   * refuses to follow when staging).
   */
  function badPath(worktreePath: string, paths: unknown): string | null {
    if (!Array.isArray(paths) || paths.length === 0) return 'paths must be a non-empty array'
    for (const raw of paths) {
      if (typeof raw !== 'string' || raw === '') return 'each path must be a non-empty string'
      if (raw.startsWith('-')) return `path may not start with "-": ${raw}`
      if (isAbsolute(raw)) return `path must be relative to the worktree: ${raw}`
      const rel = relative(resolve(worktreePath), resolve(worktreePath, raw))
      if (rel.startsWith('..')) return `path escapes the worktree: ${raw}`
    }
    return null
  }

  function badSha(value: unknown, field: string): string | null {
    if (typeof value !== 'string' || !SHA.test(value)) {
      return `${field} must be a commit sha`
    }
    return null
  }

  function nonEmpty(value: unknown, field: string): string | null {
    return typeof value === 'string' && value.trim() !== '' ? null : `${field} is required`
  }

  /**
   * Only what `mutate` actually uses of a reply.
   *
   * `FastifyInstance['post']` is overloaded, so deriving the handler's reply
   * type from it resolves to `never`; a structural type is both correct and
   * independent of which overload TypeScript happens to pick.
   */
  type Replier = { code: (status: number) => { send: (body: unknown) => unknown } }

  /**
   * The one shape every mutation route has.
   *
   * Resolving the project, resolving the target, checking the provenance
   * guard and calling the wrapper are written once rather than sixteen times —
   * the whole reason the wrapper exists is that "one place applies the rule
   * and another does not" is this codebase's recurring defect.
   */
  async function mutate<T>(
    reply: Replier,
    projectId: string,
    body: { worktree?: unknown },
    op: OperationName,
    kind: MutationKind,
    describes: (target: MutationTarget) => string,
    run: Parameters<typeof withGitMutation<T>>[4],
    validate?: (target: MutationTarget) => string | null,
  ) {
    const p = project(projectId)
    if (!p) return reply.code(404).send({ error: 'Project not found' })

    const resolved = await resolveTarget(p, body.worktree)
    if (!resolved.ok) return reply.code(resolved.status).send({ error: resolved.error })
    const { target } = resolved

    const guard = guardOperation(op, target.owner)
    if (!guard.allowed) return reply.code(403).send({ error: guard.reason })

    const invalid = validate?.(target)
    if (invalid !== null && invalid !== undefined) {
      return reply.code(400).send({ error: invalid })
    }

    const out = await withGitMutation({ db, bus }, target, kind, describes(target), run)
    if (!out.ok) {
      // The objective is named on the refusal, not left to the client to
      // infer. A 409 is answerable — the UI pairs it with a Pause — and the
      // client cannot reliably work out *which* objective is in the way:
      // a commit-level operation targets the main checkout, whose own owner
      // is `user`. Reconstructing it from the message would mean parsing
      // prose written for a human.
      return reply
        .code(out.status)
        .send({ error: out.error, objectiveId: target.objective?.id ?? null })
    }
    return reply.code(200).send({ report: out.report })
  }

  const PLAIN: MutationKind = { rewritesHistory: false, createsCommit: false, undoable: true }
  const COMMITS: MutationKind = { rewritesHistory: false, createsCommit: true, undoable: true }
  const REWRITES_AND_COMMITS: MutationKind = {
    rewritesHistory: true,
    createsCommit: true,
    undoable: true,
  }
  const REWRITES: MutationKind = { rewritesHistory: true, createsCommit: false, undoable: true }

  type PathsBody = { worktree?: unknown; paths?: unknown }

  app.post<{ Params: { id: string }; Body: PathsBody }>(
    '/api/projects/:id/git/stage',
    async (req, reply) =>
      mutate(
        reply,
        req.params.id,
        req.body ?? {},
        'stage',
        PLAIN,
        () => `Stage ${(req.body.paths as string[]).length} path(s)`,
        (ctx) => stagePaths(ctx, req.body.paths as string[]),
        (t) => badPath(t.worktreePath, req.body.paths),
      ),
  )

  app.post<{ Params: { id: string }; Body: PathsBody }>(
    '/api/projects/:id/git/unstage',
    async (req, reply) =>
      mutate(
        reply,
        req.params.id,
        req.body ?? {},
        'unstage',
        PLAIN,
        () => `Unstage ${(req.body.paths as string[]).length} path(s)`,
        (ctx) => unstagePaths(ctx, req.body.paths as string[]),
        (t) => badPath(t.worktreePath, req.body.paths),
      ),
  )

  app.post<{ Params: { id: string }; Body: PathsBody }>(
    '/api/projects/:id/git/discard',
    async (req, reply) =>
      mutate(
        reply,
        req.params.id,
        req.body ?? {},
        'discard',
        PLAIN,
        () => `Discard changes to ${(req.body.paths as string[]).length} path(s)`,
        (ctx) => discardPaths(ctx, req.body.paths as string[]),
        (t) => badPath(t.worktreePath, req.body.paths),
      ),
  )

  app.post<{ Params: { id: string }; Body: { worktree?: unknown; message?: unknown } }>(
    '/api/projects/:id/git/commit',
    async (req, reply) =>
      mutate(
        reply,
        req.params.id,
        req.body ?? {},
        'commit',
        COMMITS,
        () => 'Commit staged changes',
        (ctx) => commitStaged(ctx, req.body.message as string),
        () => nonEmpty(req.body?.message, 'message'),
      ),
  )

  app.post<{
    Params: { id: string }
    Body: { worktree?: unknown; message?: unknown; includeStaged?: unknown }
  }>('/api/projects/:id/git/amend', async (req, reply) =>
    mutate(
      reply,
      req.params.id,
      req.body ?? {},
      'amend',
      REWRITES_AND_COMMITS,
      () => 'Amend the last commit',
      (ctx) =>
        amendHead(
          ctx,
          typeof req.body.message === 'string' ? req.body.message : null,
          req.body.includeStaged === true,
        ),
      () =>
        req.body?.message === undefined || typeof req.body.message === 'string'
          ? null
          : 'message must be a string when given',
    ),
  )

  app.post<{
    Params: { id: string }
    Body: { worktree?: unknown; from?: unknown; to?: unknown; message?: unknown }
  }>('/api/projects/:id/git/squash', async (req, reply) =>
    mutate(
      reply,
      req.params.id,
      req.body ?? {},
      'squash',
      REWRITES_AND_COMMITS,
      () => 'Squash a range of commits',
      (ctx) =>
        squashRange(
          ctx,
          req.body.from as string,
          req.body.to as string,
          req.body.message as string,
        ),
      () =>
        badSha(req.body?.from, 'from') ??
        badSha(req.body?.to, 'to') ??
        nonEmpty(req.body?.message, 'message'),
    ),
  )

  app.post<{
    Params: { id: string }
    Body: { worktree?: unknown; sha?: unknown; message?: unknown }
  }>('/api/projects/:id/git/reword', async (req, reply) =>
    mutate(
      reply,
      req.params.id,
      req.body ?? {},
      'reword',
      REWRITES_AND_COMMITS,
      () => 'Reword the last commit',
      (ctx) => rewordCommit(ctx, req.body.sha as string, req.body.message as string),
      () => badSha(req.body?.sha, 'sha') ?? nonEmpty(req.body?.message, 'message'),
    ),
  )

  app.post<{ Params: { id: string }; Body: { worktree?: unknown; sha?: unknown } }>(
    '/api/projects/:id/git/drop',
    async (req, reply) =>
      mutate(
        reply,
        req.params.id,
        req.body ?? {},
        'drop',
        REWRITES,
        () => 'Drop the last commit',
        (ctx) => dropCommit(ctx, req.body.sha as string),
        () => badSha(req.body?.sha, 'sha'),
      ),
  )

  app.post<{ Params: { id: string }; Body: { worktree?: unknown } }>(
    '/api/projects/:id/git/stash',
    async (req, reply) =>
      mutate(
        reply,
        req.params.id,
        req.body ?? {},
        'stash',
        PLAIN,
        () => 'Stash working-tree changes',
        (ctx) => stashPush(ctx),
      ),
  )

  app.post<{ Params: { id: string }; Body: { worktree?: unknown } }>(
    '/api/projects/:id/git/stash/pop',
    async (req, reply) =>
      mutate(
        reply,
        req.params.id,
        req.body ?? {},
        'stashPop',
        PLAIN,
        () => 'Restore the most recent stash',
        (ctx) => stashPop(ctx),
      ),
  )

  app.post<{
    Params: { id: string }
    Body: { worktree?: unknown; name?: unknown; from?: unknown }
  }>('/api/projects/:id/git/branch', async (req, reply) =>
    mutate(
      reply,
      req.params.id,
      req.body ?? {},
      'createBranch',
      PLAIN,
      () => `Create branch ${req.body.name}`,
      (ctx) =>
        createBranch(
          ctx,
          req.body.name as string,
          typeof req.body.from === 'string' ? req.body.from : null,
        ),
      () => {
        const name = req.body?.name
        const missing = nonEmpty(name, 'name')
        if (missing !== null) return missing
        if ((name as string).startsWith('-')) return 'name may not start with "-"'
        return req.body?.from === undefined ? null : badSha(req.body.from, 'from')
      },
    ),
  )

  app.post<{ Params: { id: string }; Body: { name?: unknown } }>(
    '/api/projects/:id/git/branch/delete',
    async (req, reply) => {
      const p = project(req.params.id)
      if (!p) return reply.code(404).send({ error: 'Project not found' })

      const name = req.body?.name
      const branches = await listBranches(p.repoPath)
      if (typeof name !== 'string' || !branches.some((b) => b.name === name)) {
        // Checked against the real branch list, not a character filter — the
        // same rule the read-only log route already applies to `ref`.
        return reply.code(400).send({ error: 'Not a branch of this repository' })
      }

      const owner = ownerOfBranch(name, ownedObjectives(p.id))
      const guard = guardOperation('deleteBranch', owner)
      if (!guard.allowed) return reply.code(403).send({ error: guard.reason })
      if (owner.kind === 'vadd') {
        return reply.code(403).send({
          error:
            "Cannot delete an objective's own branch — use integrate: discard, which also clears " +
            "the objective's rows.",
        })
      }

      // Deliberately outside `withGitMutation`: the target is a branch, not a
      // worktree, so there is no HEAD to record an undo against and nothing
      // the gate could be evaluated over.
      try {
        await deleteBranch(p.repoPath, name)
      } catch (err) {
        const message = err instanceof GitError ? err.message : String(err)
        return reply.code(400).send({ error: message })
      }
      bus.emit({ type: 'git_mutation', payload: { describes: `Delete branch ${name}` } })
      return reply.code(200).send({ report: { describes: `Delete branch ${name}` } })
    },
  )

  app.post<{ Params: { id: string }; Body: { worktree?: unknown; branch?: unknown } }>(
    '/api/projects/:id/git/checkout',
    async (req, reply) => {
      const p = project(req.params.id)
      if (!p) return reply.code(404).send({ error: 'Project not found' })
      const branches = await listBranches(p.repoPath)
      const branch = req.body?.branch
      const known = typeof branch === 'string' && branches.some((b) => b.name === branch)

      return mutate(
        reply,
        req.params.id,
        req.body ?? {},
        'checkout',
        PLAIN,
        () => `Check out ${branch}`,
        (ctx) => checkoutBranch(ctx, branch as string),
        () => (known ? null : 'Not a branch of this repository'),
      )
    },
  )

  app.post<{ Params: { id: string }; Body: { path?: unknown; branch?: unknown } }>(
    '/api/projects/:id/git/worktree',
    async (req, reply) => {
      const p = project(req.params.id)
      if (!p) return reply.code(404).send({ error: 'Project not found' })

      const path = req.body?.path
      const branch = req.body?.branch
      if (typeof path !== 'string' || path === '' || !isAbsolute(path)) {
        return reply.code(400).send({ error: 'path must be an absolute directory path' })
      }
      if (typeof branch !== 'string' || branch === '' || branch.startsWith('-')) {
        return reply.code(400).send({ error: 'branch is required' })
      }
      // Only a path VADD does not manage. A new worktree under the VADD root
      // would be indistinguishable from an objective's own once created.
      if (!relative(rootFor(p), resolve(path)).startsWith('..')) {
        return reply
          .code(403)
          .send({ error: "Cannot create a worktree inside VADD's own worktree root" })
      }

      try {
        await createWorktree(p.repoPath, path, branch)
      } catch (err) {
        const message = err instanceof GitError ? err.message : String(err)
        return reply.code(400).send({ error: message })
      }
      const describes = `Create worktree at ${path}`
      bus.emit({ type: 'git_mutation', payload: { describes } })
      return reply.code(200).send({ report: { describes } })
    },
  )

  app.post<{ Params: { id: string }; Body: { worktree?: unknown } }>(
    '/api/projects/:id/git/worktree/remove',
    async (req, reply) => {
      const p = project(req.params.id)
      if (!p) return reply.code(404).send({ error: 'Project not found' })

      const resolved = await resolveTarget(p, req.body?.worktree)
      if (!resolved.ok) return reply.code(resolved.status).send({ error: resolved.error })
      const { target } = resolved

      const guard = guardOperation('removeWorktree', target.owner)
      if (!guard.allowed) return reply.code(403).send({ error: guard.reason })
      if (resolve(target.worktreePath) === resolve(p.repoPath)) {
        return reply.code(403).send({ error: 'Cannot remove the main checkout' })
      }

      try {
        // `null` keeps the branch: removing a worktree is not a request to
        // delete the work that was on it.
        await removeWorktree(p.repoPath, target.worktreePath, null)
      } catch (err) {
        const message = err instanceof GitError ? err.message : String(err)
        return reply.code(500).send({ error: message })
      }
      const describes = `Remove worktree ${target.worktreePath}`
      bus.emit({ type: 'git_mutation', payload: { describes } })
      return reply.code(200).send({ report: { describes } })
    },
  )

  app.post<{ Params: { id: string }; Body: { worktree?: unknown } }>(
    '/api/projects/:id/git/undo',
    async (req, reply) => {
      const p = project(req.params.id)
      if (!p) return reply.code(404).send({ error: 'Project not found' })

      const resolved = await resolveTarget(p, req.body?.worktree)
      if (!resolved.ok) return reply.code(resolved.status).send({ error: resolved.error })
      const { target } = resolved

      const record = db
        .select()
        .from(gitUndo)
        .where(eq(gitUndo.worktreePath, target.worktreePath))
        .get()
      if (!record) {
        // 404 with a message naming the thing that is missing. A status alone
        // would be indistinguishable from an unregistered route.
        return reply.code(404).send({ error: 'No undo record for this worktree' })
      }

      const guard = guardOperation('undo', target.owner)
      if (!guard.allowed) return reply.code(403).send({ error: guard.reason })

      // Undo is itself a mutation and goes through the same wrapper, gate
      // included: an undo must not land mid-`executing` either.
      const out = await withGitMutation(
        { db, bus },
        target,
        REWRITES,
        `Undo: ${record.describes}`,
        (ctx) => undoTo(ctx, record.beforeSha),
      )
      if (!out.ok) return reply.code(out.status).send({ error: out.error })
      return reply.code(200).send({ report: out.report })
    },
  )

  // ---------------------------------------------------------------------
  // Remote operations (amendment A20).
  // ---------------------------------------------------------------------

  /** A push changes nothing locally, so there is nothing an undo could restore. */
  const REMOTE_PLAIN: MutationKind = {
    rewritesHistory: false,
    createsCommit: false,
    undoable: false,
  }
  /** A fast-forward only advances the local ref, which `reset --hard` returns. */
  const REMOTE_PULL: MutationKind = {
    rewritesHistory: false,
    createsCommit: false,
    undoable: true,
  }

  /**
   * A remote name, checked against what the repository already has.
   *
   * This is the mechanism amendment A20 rests on: no route accepts a URL, so
   * there is no input through which VADD can be pointed at a host the user did
   * not configure with their own hands. Same rule as `ref` on the log route —
   * validated against a real list, never against a character filter.
   *
   * The list check alone does NOT make the value safe to place in an argv,
   * which is what this comment used to claim. Measured on git 2.43.0: `git
   * remote add -- '--upload-pack=/bin/echo' <url>` succeeds and `git remote`
   * prints that name back verbatim, so a listed name really can be
   * option-shaped. `remote.ts` puts `--` in front of every remote it passes to
   * git, which is the fix that matters; the leading-`-` refusal below is the
   * second layer, and it also keeps `listRemotes` — which asks git for each
   * url by name — from being handed one.
   */
  async function knownRemote(p: Project, value: unknown): Promise<string | null> {
    if (typeof value !== 'string' || value === '') return null
    if (value.startsWith('-')) return null
    const remotes = await listRemotes(p.repoPath)
    return remotes.some((r) => r.name === value) ? value : null
  }

  app.get<{ Params: { id: string } }>('/api/projects/:id/git/remotes', async (req, reply) => {
    const p = project(req.params.id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })
    return { remotes: await listRemotes(p.repoPath) }
  })

  /**
   * The two states VADD's own bookkeeping goes wrong in.
   *
   * Its own route rather than a field on the topology response, deliberately.
   * The filesystem scan behind it has failure modes genuinely unrelated to
   * git's — an EACCES on a directory whose permissions changed, or a blocking
   * stat on a stale network mount, which is also the condition that would fake
   * a `vanished` reading. Folding it into `GET /api/projects/:id/git` means one
   * such failure blanks the whole console, including the screen a user would
   * open to work out why. Same argument the remotes route already makes.
   */
  app.get<{ Params: { id: string } }>('/api/projects/:id/git/strays', async (req, reply) => {
    const p = project(req.params.id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })
    const strays = await readStrays({
      objectives: ownedObjectives(p.id),
      repoPath: p.repoPath,
      worktreeRoot: rootFor(p),
    })
    return { strays }
  })

  app.post<{ Params: { id: string }; Body: { remote?: unknown } }>(
    '/api/projects/:id/git/fetch',
    async (req, reply) => {
      const p = project(req.params.id)
      if (!p) return reply.code(404).send({ error: 'Project not found' })
      const remote = await knownRemote(p, req.body?.remote)
      if (remote === null) {
        return reply.code(400).send({ error: 'Not a remote of this repository' })
      }

      // Deliberately outside `withGitMutation`, the same way `branch/delete`
      // is: a fetch updates remote-tracking refs only, so it has no worktree
      // to be gated against and no HEAD an undo could be recorded from. It
      // still emits its own event, so the console sees it like any other.
      try {
        await fetchRemote(p.repoPath, remote)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return reply.code(declaredStatus(err)).send({ error: message })
      }
      const describes = `Fetch ${remote}`
      bus.emit({ type: 'git_mutation', payload: { describes } })
      return reply.code(200).send({ report: { describes } })
    },
  )

  app.post<{ Params: { id: string }; Body: { worktree?: unknown; remote?: unknown } }>(
    '/api/projects/:id/git/pull',
    async (req, reply) => {
      const p = project(req.params.id)
      if (!p) return reply.code(404).send({ error: 'Project not found' })
      const remote = await knownRemote(p, req.body?.remote)
      if (remote === null) {
        return reply.code(400).send({ error: 'Not a remote of this repository' })
      }
      // No branch argument: `pullFastForward` resolves the worktree's own
      // current branch, so there is no way to ask one worktree to pull
      // another branch into itself.
      return mutate(
        reply,
        req.params.id,
        req.body ?? {},
        'pull',
        REMOTE_PULL,
        () => `Pull from ${remote}`,
        (ctx) => pullFastForward(ctx.worktreePath, remote),
      )
    },
  )

  app.post<{
    Params: { id: string }
    Body: { worktree?: unknown; remote?: unknown; branch?: unknown; setUpstream?: unknown }
  }>('/api/projects/:id/git/push', async (req, reply) => {
    const p = project(req.params.id)
    if (!p) return reply.code(404).send({ error: 'Project not found' })
    const remote = await knownRemote(p, req.body?.remote)
    if (remote === null) {
      return reply.code(400).send({ error: 'Not a remote of this repository' })
    }
    const branches = await listBranches(p.repoPath)
    const branch = req.body?.branch
    const known = typeof branch === 'string' && branches.some((b) => b.name === branch)

    // The in-flight gate, resolved from the BRANCH rather than the worktree.
    //
    // `withGitMutation`'s own gate keys on `target.objective`, which
    // `resolveTarget` fills in from `ownerOfWorktree`. Push is the one
    // operation whose subject is not the worktree it runs in: the console
    // sends `worktree: mainRepoPath` for every branch row, whose owner is
    // `user`, so `target.objective` was null and **no gate ran at all** — an
    // objective mid-`executing` could have its half-written checkpoints
    // published to a shared remote, with `undoable: false` and no route
    // anywhere in VADD that deletes a remote branch.
    //
    // Fixed here rather than in the console, and deliberately: an exclusion
    // that lives only in the UI leaves the HTTP path open, which this project
    // has already had to correct once (A15's `integrate: commit`, refused in
    // `IntegrationChooser` while the route still accepted it).
    if (known) {
      const branchOwner = ownerOfBranch(branch as string, ownedObjectives(p.id))
      if (branchOwner.kind === 'vadd') {
        const verdict = gateForStatus(branchOwner.objectiveStatus)
        if (!verdict.allowed) {
          return reply
            .code(409)
            .send({ error: verdict.reason, objectiveId: branchOwner.objectiveId })
        }
      }
    }

    return mutate(
      reply,
      req.params.id,
      req.body ?? {},
      'push',
      REMOTE_PLAIN,
      () => `Push ${branch} to ${remote}`,
      (ctx) =>
        pushBranch(ctx.worktreePath, remote, branch as string, req.body?.setUpstream === true),
      () => (known ? null : 'Not a branch of this repository'),
    )
  })
}
