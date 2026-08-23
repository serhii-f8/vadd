import { dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { objectives, projects } from '../../db/schema.js'
import { listBranches, listWorktreesDetailed, readLog, readStatus } from '../../git/inspect.js'
import { type OwnedObjective, ownerOfBranch, ownerOfWorktree } from '../../git/provenance.js'
import { GitError } from '../../git/run.js'
import { worktreePathFor } from '../../paths.js'
import type { AppDeps } from '../app.js'

const SHA = /^[0-9a-f]{4,40}$/
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function registerGitRoutes(app: FastifyInstance, { db }: AppDeps): void {
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
}
