import { randomUUID } from 'node:crypto'
import { type AgentEventType, CreateObjectiveBody, ObjectiveCommand } from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { AgentStoppedError } from '../../agent/acp-agent-port.js'
import type { AgentRegistry } from '../../agent/registry.js'
import { agentSessions, objectives, projects } from '../../db/schema.js'
import { createWorktree, removeWorktree } from '../../git/git-manager.js'
import { branchNameFor, worktreePathFor } from '../../paths.js'
import {
  loadTemplate,
  type PromptTemplate,
  placeholdersIn,
  renderTemplate,
} from '../../prompts/renderer.js'
import { buildRepairPrompt } from '../../prompts/repair-prompt.js'
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

      // Requesting a cancel is not the same event as a turn ending, and
      // conflating them broke both ways. Emitting `prompt_cancelled` here put a
      // *second* terminal record in the turn once the in-flight prompt settled
      // and emitted its own — and `loadTranscript` closes a turn on the first
      // terminal, so every update streamed in between was replayed outside the
      // turn while the live pipeline had counted it. Emissions could vanish
      // from scoring, which raises precision by hiding a false positive.
      bus.emit({ objectiveId: objective.id, type: 'prompt_cancel_requested', payload: {} })

      // The other half: the pipeline's turn has to be closed here, because the
      // adapter may never settle the prompt at all. Verified with the
      // `hang-on-prompt` fake peer — cancel returned 200, `turnActive` stayed
      // true, and every later prompt on the objective 409'd permanently, with
      // `integrate: discard` (which destroys the worktree) the only recovery.
      // During hand-driven corpus recording, cancelling one slow turn cost the
      // whole transcript. `endTurn` is a no-op for a turn that already closed,
      // so the settle path's own call stays safe.
      const openTurn = live.turnId
      if (openTurn !== null) {
        live.turnId = null
        await live.pipeline.endTurn(openTurn)
      }
      return reply.code(200).send({ ok: true })
    }

    // type === 'prompt'
    const { text: rawText, phase } = parsed.data
    if ((rawText === undefined) === (phase === undefined)) {
      return reply.code(400).send({ error: 'Provide exactly one of "text" or "phase"' })
    }

    let text = rawText ?? ''
    let expect: AgentEventType[][] = []
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
        ...parsed.data.vars,
      })

      // renderTemplate deliberately leaves an unknown placeholder in place — a
      // visibly broken prompt is debuggable, a silently empty one is not — but
      // "visible" only helps if someone looks. Sending it anyway is how
      // `verify.md` came to ship the literal string `{{verificationCommands}}`
      // to the agent. On the corpus run that would have measured the gate's
      // kill-switch number against a systematically broken prompt, and the
      // resulting low `evidence` recall would have been indistinguishable from
      // a genuine failure of the product bet.
      const unresolved = placeholdersIn(text)
      if (unresolved.length > 0) {
        return reply.code(400).send({
          error:
            `Prompt for phase "${phase}" still contains ` +
            `${unresolved.map((n) => `{{${n}}}`).join(', ')}. Supply the value(s) in "vars".`,
        })
      }
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
    // Published on the entry so the `cancel` request — a different request,
    // with no access to this closure — can end the same turn.
    entry.turnId = turnId

    bus.emit({ objectiveId: objective.id, type: 'prompt_sent', payload: { text, phase } })

    // Do not await the turn: it can run for minutes, and progress is observable
    // over SSE. The response only confirms the prompt was accepted.
    void entry.port
      .prompt(entry.sessionId, text)
      .then(async (r) => {
        // The repair runs before endTurn, while the turn is still open and its
        // expectations are still repairable. It is sent as repair_prompt_sent,
        // NOT prompt_sent: loadTranscript opens a turn on prompt_sent alone, and
        // a second turn here would shift every later turn and invalidate all 40
        // turn-indexed labels in the eval corpus (design §5.2).
        const unmet = entry.pipeline.unmetExpectations()
        const dangling = entry.pipeline.danglingEvidenceRefs()
        // Read before the repair prompt is built: a turn can owe an event
        // *because* a block it sent was rejected, and saying only what is
        // missing invites the agent to substitute rather than correct.
        const rejected = entry.pipeline.schemaRejections()
        if (unmet.length > 0 || dangling.length > 0) {
          const parts = [
            ...unmet.map((group) => group.join(' or ')),
            ...dangling.map((ref) => `evidence matching "${ref}"`),
          ]
          const missing = parts.join(', ')
          try {
            const repair = buildRepairPrompt(
              renderTemplate(loadTemplate('repair'), { missing }),
              rejected,
            )
            bus.emit({
              objectiveId: objective.id,
              type: 'repair_prompt_sent',
              payload: { missing, rejected },
            })
            await entry.port.prompt(entry.sessionId, repair)
          } catch (err) {
            // A failed repair must not lose the turn's real work: fall through
            // to endTurn, which reports missing_expected exactly as before.
            bus.emit({
              objectiveId: objective.id,
              type: 'repair_failed',
              payload: { message: errorMessage(err) },
            })
          }
        }
        if (entry.turnId === turnId) entry.turnId = null
        await entry.pipeline.endTurn(turnId)
        bus.emit({ objectiveId: objective.id, type: 'prompt_finished', payload: r })
      })
      .catch(async (err: unknown) => {
        // Flush before reporting: a turn that died mid-block still produced
        // text, and an unterminated fence is a finding, not noise.
        if (entry.turnId === turnId) entry.turnId = null
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
