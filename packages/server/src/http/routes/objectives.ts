import { randomUUID } from 'node:crypto'
import { type AgentEventType, CreateObjectiveBody, ObjectiveCommand } from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { AgentStoppedError } from '../../agent/acp-agent-port.js'
import type { AgentRegistry } from '../../agent/registry.js'
import { agentSessions, objectives, projects } from '../../db/schema.js'
import { createWorktree, removeWorktree } from '../../git/git-manager.js'
import { branchNameFor, worktreePathFor } from '../../paths.js'
import { loadTemplate, type PromptTemplate, renderTemplate } from '../../prompts/renderer.js'
import type { AppDeps } from '../app.js'

/** ACP rejects with plain objects, so `String(err)` yields "[object Object]". */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; code?: unknown; data?: unknown }
    if (typeof o.message === 'string') {
      const head = o.code === undefined ? o.message : `${o.message} (code ${String(o.code)})`
      // `data` is where JSON-RPC puts the actionable part. The SDK's own
      // helpers pair a constant message ("Internal error", "Authentication
      // required") with a populated `data`, so dropping it discards everything
      // that would tell the user what to do. Truncated so a zod error tree
      // cannot flood the event log or the page's error banner.
      if (o.data !== undefined) {
        try {
          const detail = JSON.stringify(o.data)
          if (detail && detail !== '{}') {
            return `${head}: ${detail.length > 300 ? `${detail.slice(0, 300)}…` : detail}`
          }
        } catch {
          // A circular or unserialisable `data` is not worth failing over.
        }
      }
      return head
    }
    try {
      return JSON.stringify(err)
    } catch {
      return 'Unknown error'
    }
  }
  return String(err)
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
      const message = errorMessage(err)
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
    const { text: rawText, phase } = parsed.data
    if ((rawText === undefined) === (phase === undefined)) {
      return reply.code(400).send({ error: 'Provide exactly one of "text" or "phase"' })
    }

    let text = rawText ?? ''
    let expect: AgentEventType[] = []
    if (phase !== undefined) {
      let template: PromptTemplate
      try {
        template = loadTemplate(phase)
      } catch (err) {
        return reply.code(400).send({ error: errorMessage(err) })
      }
      // The template's front-matter is the single source of truth for what the
      // turn must produce: the machine will read the same field in phase 3.
      expect = template.expects
      text = renderTemplate(template, {
        title: objective.title,
        goalText: objective.goalText,
      })
    }

    let entry: Awaited<ReturnType<AgentRegistry['ensure']>>
    try {
      entry = await agents.ensure(objective)
    } catch (err) {
      const message = errorMessage(err)
      bus.emit({ objectiveId: objective.id, type: 'agent_start_failed', payload: { message } })
      return reply.code(500).send({ error: message })
    }

    // A second prompt while one is still open would have beginTurn silently
    // discard the first turn's buffered state (design rule 2: never drop
    // silently) — reject it visibly instead. Matches the 409 the `cancel`
    // branch already uses for "no active session".
    if (entry.pipeline.turnActive) {
      return reply.code(409).send({ error: 'A turn is already in flight' })
    }

    const turnId = randomUUID()
    entry.pipeline.beginTurn({ turnId, expect })

    bus.emit({ objectiveId: objective.id, type: 'prompt_sent', payload: { text, phase } })

    // Do not await the turn: it can run for minutes, and progress is observable
    // over SSE. The response only confirms the prompt was accepted.
    void entry.port
      .prompt(entry.sessionId, text)
      .then(async (r) => {
        await entry.pipeline.endTurn(turnId)
        bus.emit({ objectiveId: objective.id, type: 'prompt_finished', payload: r })
      })
      .catch(async (err: unknown) => {
        // Flush before reporting: a turn that died mid-block still produced
        // text, and an unterminated fence is a finding, not noise.
        await entry.pipeline.endTurn(turnId)
        bus.emit({
          objectiveId: objective.id,
          // A turn we ended is not a turn the agent lost. Reporting a discard
          // or a shutdown as a failure would corrupt the flakiness signal this
          // milestone exists to collect.
          type: err instanceof AgentStoppedError ? 'prompt_cancelled' : 'prompt_failed',
          payload: { message: errorMessage(err) },
        })
      })

    return reply.code(202).send({ ok: true, sessionId: entry.sessionId })
  })
}
