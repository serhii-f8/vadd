import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { VerificationSpec } from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { gitUndo, objectives, projects } from '../../db/schema.js'
import { createWorktree, removeWorktree } from '../../git/git-manager.js'
import { listBranches, listWorktreesDetailed, readLog, readStatus } from '../../git/inspect.js'
import {
  amendHead,
  checkoutBranch,
  commitStaged,
  createBranch,
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
import { guardOperation, type OperationName } from '../../git/mutation-guards.js'
import { type OwnedObjective, ownerOfBranch, ownerOfWorktree } from '../../git/provenance.js'
import { GitError } from '../../git/run.js'
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

    return {
      mainRepoPath: p.repoPath,
      currentBranch: branches.find((b) => b.isCurrent)?.name ?? null,
      branches: branches.map((b) => ({ ...b, owner: ownerOfBranch(b.name, rows) })),
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

    // Read exactly the way `excludeProtected` reads it, so a manual commit and
    // the squash cannot disagree about what is protected.
    const spec = VerificationSpec.safeParse(objectiveRow?.verificationSpec)
    const protectedGlobs = spec.success ? spec.data.policy.protectedGlobs : []

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
        protectedGlobs,
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

  const PLAIN: MutationKind = { rewritesHistory: false, createsCommit: false }
  const COMMITS: MutationKind = { rewritesHistory: false, createsCommit: true }
  const REWRITES_AND_COMMITS: MutationKind = { rewritesHistory: true, createsCommit: true }
  const REWRITES: MutationKind = { rewritesHistory: true, createsCommit: false }

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
}
