import { randomUUID } from 'node:crypto'
import { CreateObjectiveBody, ObjectiveCommand } from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { AgentRegistry } from '../../agent/registry.js'
import { agentSessions, objectives, projects } from '../../db/schema.js'
import { createWorktree, removeWorktree } from '../../git/git-manager.js'
import { worktreePathFor } from '../../paths.js'
import type { AppDeps } from '../app.js'

/** Branch names use the first 8 characters of the objective UUID. */
export function branchNameFor(objectiveId: string): string {
  return `vadd/${objectiveId.slice(0, 8)}`
}

export function registerObjectiveRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, bus } = deps

  app.post<{ Params: { id: string } }>('/api/projects/:id/objectives', async (req, reply) => {
    const parsed = CreateObjectiveBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }

    const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get()
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    const id = randomUUID()
    const now = new Date().toISOString()
    const path = worktreePathFor(project.id, id)
    const branch = branchNameFor(id)

    // DB-first: a crash after this insert leaves a visible 'creating' row that
    // boot reconciliation (Task 12) can clean up, not an orphan directory.
    db.insert(objectives)
      .values({
        id,
        projectId: project.id,
        title: parsed.data.title,
        goalText: parsed.data.goalText,
        worktreePath: null,
        branchName: null,
        status: 'creating',
        createdAt: now,
        updatedAt: now,
      })
      .run()

    try {
      await createWorktree(project.repoPath, path, branch)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      db.delete(objectives).where(eq(objectives.id, id)).run()
      bus.emit({ type: 'objective_create_failed', payload: { id, message } })
      return reply.code(500).send({ error: `Failed to create worktree: ${message}` })
    }

    const row = db
      .update(objectives)
      .set({
        worktreePath: path,
        branchName: branch,
        status: 'ready',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(objectives.id, id))
      .returning()
      .get()

    bus.emit({ objectiveId: id, type: 'objective_created', payload: row })
    return reply.code(201).send(row)
  })

  app.get<{ Params: { id: string } }>('/api/objectives/:id', async (req, reply) => {
    const row = db.select().from(objectives).where(eq(objectives.id, req.params.id)).get()
    if (!row) return reply.code(404).send({ error: 'Objective not found' })
    return row
  })

  app.post<{ Params: { id: string } }>('/api/objectives/:id/events', async (req, reply) => {
    const parsed = ObjectiveCommand.safeParse(req.body)
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Unsupported command in M0', details: parsed.error.issues })
    }

    const objective = db.select().from(objectives).where(eq(objectives.id, req.params.id)).get()
    if (!objective) return reply.code(404).send({ error: 'Objective not found' })

    if (parsed.data.type === 'integrate') {
      const project = db.select().from(projects).where(eq(projects.id, objective.projectId)).get()
      if (!project) return reply.code(500).send({ error: 'Objective has no project' })

      await deps.agents?.stop(objective.id)

      if (objective.worktreePath && objective.branchName) {
        await removeWorktree(project.repoPath, objective.worktreePath, objective.branchName)
      }
      // agent_sessions.objective_id has a foreign key on objectives.id with no
      // cascade, so a discard with a recorded session must clear those rows
      // first or the delete below fails the constraint.
      db.delete(agentSessions).where(eq(agentSessions.objectiveId, objective.id)).run()
      db.delete(objectives).where(eq(objectives.id, objective.id)).run()
      bus.emit({
        objectiveId: objective.id,
        type: 'objective_discarded',
        payload: { id: objective.id },
      })
      return reply.code(200).send({ ok: true })
    }

    const agents = deps.agents
    if (!agents) return reply.code(500).send({ error: 'Agent registry is not configured' })

    if (parsed.data.type === 'cancel') {
      const live = agents.get(objective.id)
      if (!live) return reply.code(409).send({ error: 'No active agent session' })
      await live.port.cancel(live.sessionId)
      bus.emit({ objectiveId: objective.id, type: 'prompt_cancelled', payload: {} })
      return reply.code(200).send({ ok: true })
    }

    // type === 'prompt'
    const text = parsed.data.text
    let entry: Awaited<ReturnType<AgentRegistry['ensure']>>
    try {
      entry = await agents.ensure(objective)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      bus.emit({ objectiveId: objective.id, type: 'agent_start_failed', payload: { message } })
      return reply.code(500).send({ error: message })
    }

    bus.emit({ objectiveId: objective.id, type: 'prompt_sent', payload: { text } })

    // Do not await the turn: it can run for minutes, and progress is observable
    // over SSE. The response only confirms the prompt was accepted.
    void entry.port
      .prompt(entry.sessionId, text)
      .then((r) => bus.emit({ objectiveId: objective.id, type: 'prompt_finished', payload: r }))
      .catch((err: unknown) =>
        bus.emit({
          objectiveId: objective.id,
          type: 'prompt_failed',
          payload: { message: err instanceof Error ? err.message : String(err) },
        }),
      )

    return reply.code(202).send({ ok: true, sessionId: entry.sessionId })
  })
}
