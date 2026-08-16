import { randomUUID } from 'node:crypto'
import type { WorkflowEvent } from '@vadd/core'
import {
  assertSpecAllowed,
  CreateObjectiveBody,
  normalizeChecks,
  ObjectiveCommand,
  VerificationSpec,
} from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db/client.js'
import { decisions, evidenceItems, objectives, planTasks, projects } from '../../db/schema.js'
import { createWorktree } from '../../git/git-manager.js'
import { branchNameFor, worktreePathFor } from '../../paths.js'
import { resolveVerification } from '../../verification/resolve.js'
import { runSetup } from '../../verification/setup.js'
import { runIntegration } from '../../workflow/integrate.js'
import type { WorkflowRunner } from '../../workflow/runner.js'
import { loadSnapshot } from '../../workflow/store.js'
import { cancelOpenTurn, renderTurnPrompt, runTurn, TurnRejected } from '../../workflow/turn.js'
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

/**
 * Returns the live actor for an objective, building one if this process has
 * none yet.
 *
 * Objectives are created without an actor — creation is a git operation, not a
 * workflow step — so the first command an objective receives has to bring one
 * into existence. A persisted snapshot wins over a fresh `start()`: a server
 * that was restarted between two commands must not silently rewind an
 * objective to `idle`. (Boot rehydration does the same thing eagerly for every
 * non-terminal objective; this is the lazy path for one that was terminal, or
 * created since boot.)
 */
function ensureActor(runner: WorkflowRunner, db: Db, objectiveId: string) {
  const live = runner.get(objectiveId)
  if (live) return live
  const snapshot = loadSnapshot(db, objectiveId)
  return snapshot === null ? runner.start(objectiveId) : runner.resume(objectiveId, snapshot)
}

/**
 * Translates a validated API command into the machine's vocabulary, or returns
 * a `{ error }` for the two commands that carry references the machine cannot
 * check for itself.
 *
 * `decide` is validated here rather than in the machine because the machine has
 * no access to the `decisions` table: a `decisionId` naming another objective's
 * row, or an `optionId` the decision never offered, would otherwise be accepted
 * and written straight through `recordDecisionChoice` as a no-op update — a
 * silent failure on the one command that records a human's choice.
 */
function toWorkflowEvent(
  db: Db,
  objectiveId: string,
  command: ObjectiveCommand,
): { event: WorkflowEvent } | { error: string; status: number } {
  switch (command.type) {
    case 'start':
      return { event: { type: 'START' } }
    case 'answer_clarification':
      return { event: { type: 'ANSWER_CLARIFICATION', answer: command.answer } }
    case 'approve_task':
      return { event: { type: 'APPROVE_TASK' } }
    case 'revise':
      return { event: { type: 'REVISE', instruction: command.instruction } }
    case 'rollback':
      return { event: { type: 'ROLLBACK' } }
    case 'pause':
      return { event: { type: 'PAUSE' } }
    case 'resume':
      return { event: { type: 'RESUME' } }
    case 'approve_plan':
      return {
        event: {
          type: 'APPROVE_PLAN',
          // `id: String(ord)` matches the machine's own convention when it
          // builds tasks from a `plan` event; an edited list that numbered its
          // tasks differently would not line up with the `plan_tasks` rows.
          tasks: command.edits?.map((t, ord) => ({
            id: String(ord),
            ord,
            title: t.title,
            description: t.description,
            checkpointRef: null,
          })),
        },
      }
    case 'decide': {
      const row = db.select().from(decisions).where(eq(decisions.id, command.decisionId)).get()
      if (!row || row.objectiveId !== objectiveId) {
        return { error: `No decision "${command.decisionId}" on this objective`, status: 400 }
      }
      const options = (row.options ?? []) as { id?: unknown }[]
      if (!options.some((o) => o.id === command.optionId)) {
        return {
          error: `Decision "${command.decisionId}" offers no option "${command.optionId}"`,
          status: 400,
        }
      }
      return {
        event: { type: 'DECIDE', decisionId: command.decisionId, optionId: command.optionId },
      }
    }
    default:
      return { error: `Command "${command.type}" does not drive the machine`, status: 400 }
  }
}

export function registerObjectiveRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, bus } = deps

  // Spec §6's resolution, previewed before an objective exists — phase 5's
  // confirm/edit step reads this. Scans `repoPath`, the same input creation
  // uses (design §4.2), so the preview and the stored result cannot disagree.
  app.get<{ Params: { id: string } }>('/api/projects/:id/verification', async (req, reply) => {
    const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get()
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    return resolveVerification(project.repoPath, null)
  })

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

    // Design §4.2: resolve against repoPath *before* anything is created, and
    // assert the command policy against the worktree path we are about to use.
    // A denial or a malformed config must cost the user nothing.
    const resolution = resolveVerification(
      project.repoPath,
      parsed.data.verificationOverrides ?? null,
    )
    if (resolution.kind === 'invalid') {
      return reply.code(400).send({ error: `Verification spec rejected: ${resolution.reason}` })
    }
    if (resolution.kind === 'resolved') {
      const allowed = assertSpecAllowed(resolution.spec, path)
      if (!allowed.allowed) {
        return reply.code(400).send({
          error: `Verification command '${allowed.commandId}' rejected: ${allowed.reason}`,
        })
      }
    }

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
        mode: parsed.data.mode,
        // Null stays null: `evidenceComplete` treats an unresolved spec as
        // "not proven", never as trivially green.
        verificationSpec: resolution.kind === 'resolved' ? resolution.spec : null,
        lowEnergy: false,
        setupAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    if (resolution.kind === 'none') {
      bus.emit({
        objectiveId: id,
        type: 'verification_unresolved',
        payload: { scanned: resolution.scanned },
      })
    }

    let baseSha: string
    try {
      baseSha = await createWorktree(project.repoPath, path, branch)
    } catch (err) {
      const message = errorMessage(err)
      db.delete(objectives).where(eq(objectives.id, id)).run()
      bus.emit({ type: 'objective_create_failed', payload: { id, message } })
      return reply.code(500).send({ error: `Failed to create worktree: ${message}` })
    }

    const spec = resolution.kind === 'resolved' ? resolution.spec : null
    const hasSetup = (spec?.verify.setup.length ?? 0) > 0

    const row = db
      .update(objectives)
      .set({
        worktreePath: path,
        branchName: branch,
        // A8. Written here rather than in the `creating` insert: that insert
        // runs before any git work and has no sha to write.
        baseSha,
        // Stays `creating` while setup runs. A crash here leaves a `creating`
        // row that `reconcileOnBoot` deletes — correct, since no agent work,
        // evidence or worktree state worth recovering exists yet.
        status: hasSetup ? 'creating' : 'idle',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(objectives.id, id))
      .returning()
      .get()

    bus.emit({ objectiveId: id, type: 'objective_created', payload: row })

    if (hasSetup && spec) {
      // Fire-and-forget: the 201 must not wait on `composer install`.
      void runSetup({ db, bus }, row, spec).catch((err) =>
        bus.emit({
          objectiveId: id,
          type: 'setup_failed',
          payload: { message: errorMessage(err) },
        }),
      )
    }

    return reply.code(201).send(row)
  })

  // Spec §7's "full aggregate (state, decisions, tasks, evidence)". The Focus
  // View mirrors this and performs no client-side transitions, so `state` is
  // read from the live actor where there is one and falls back to the mirrored
  // `objectives.status` column otherwise — the two agree by construction,
  // because `commitTransition` writes them in the same transaction.
  app.get<{ Params: { id: string } }>('/api/objectives/:id', async (req, reply) => {
    const row = db.select().from(objectives).where(eq(objectives.id, req.params.id)).get()
    if (!row) return reply.code(404).send({ error: 'Objective not found' })

    const actor = deps.runner?.get(row.id)
    return {
      objective: row,
      state: actor ? String(actor.getSnapshot().value) : row.status,
      tasks: db
        .select()
        .from(planTasks)
        .where(eq(planTasks.objectiveId, row.id))
        .orderBy(planTasks.ord)
        .all(),
      decisions: db.select().from(decisions).where(eq(decisions.objectiveId, row.id)).all(),
      evidence: db.select().from(evidenceItems).where(eq(evidenceItems.objectiveId, row.id)).all(),
    }
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

    // Spec §6's manual tick. Handled before anything reaches the actor: it is
    // not a machine event at all, it writes a row the next reconciliation
    // reads. An untick supersedes with a failing row rather than deleting, so
    // `currentEvidence`'s most-recent-per-checkId rule flips the answer while
    // the Evidence Panel keeps the history.
    if (parsed.data.type === 'tick_check') {
      const command = parsed.data
      const spec = VerificationSpec.safeParse(objective.verificationSpec)
      if (!spec.success) {
        return reply.code(400).send({ error: 'Objective has no verification spec' })
      }
      const known = normalizeChecks(spec.data).some((c) => c.id === command.checkId)
      if (!known) {
        return reply.code(400).send({ error: `Unknown check '${command.checkId}'` })
      }
      db.insert(evidenceItems)
        .values({
          id: randomUUID(),
          objectiveId: objective.id,
          taskId: null,
          commandId: command.checkId,
          kind: 'check',
          status: command.satisfied ? 'pass' : 'fail',
          headline: command.satisfied ? 'Confirmed by the user' : 'Marked unmet by the user',
          summary: [],
          artifactPath: null,
          // Amendment A7, spec §6's "recorded as decidedBy: user".
          decidedBy: 'user',
          createdAt: new Date().toISOString(),
        })
        .run()
      bus.emit({
        objectiveId: objective.id,
        type: 'check_ticked',
        payload: { checkId: command.checkId, satisfied: command.satisfied },
      })
      return reply.code(202).send({ ok: true })
    }

    if (parsed.data.type === 'integrate') {
      const { action } = parsed.data
      if (action === 'pr' || action === 'merge') {
        // Accepted by the schema only so this message can say why — spec §8.1
        // assigns both to M2. A union rejection would 400 with a zod issue
        // tree that never mentions the milestone.
        return reply
          .code(400)
          .send({ error: `integrate via "${action}" is M2; use commit, keep or discard` })
      }
      const runner = deps.runner
      if (!runner) return reply.code(500).send({ error: 'Workflow runner is not configured' })

      const project = db.select().from(projects).where(eq(projects.id, objective.projectId)).get()
      if (!project) return reply.code(500).send({ error: 'Objective has no project' })

      const actor = ensureActor(runner, db, objective.id)
      const event: WorkflowEvent = { type: 'INTEGRATE', action }
      if (!actor.getSnapshot().can(event)) {
        return reply
          .code(409)
          .send({ error: `Cannot integrate from state "${String(actor.getSnapshot().value)}"` })
      }

      // The git work happens here, between the guard check and the send. A
      // failure must claim nothing: the objective stays in `integrating` and
      // the user can retry. Doing this inside `finishObjective` instead would
      // mean `done` is reached before the worktree is dealt with.
      const outcome = await runIntegration({ db, bus }, objective, project, action)
      if (!outcome.ok) {
        return reply.code(500).send({ error: outcome.message })
      }

      // A PAUSE can land during the git work. Report both halves rather than
      // presenting either as the whole — the "never drop silently" rule
      // applied to a window that genuinely exists.
      if (!actor.getSnapshot().can(event)) {
        return reply.code(409).send({
          error:
            `The "${action}" git work completed, but the objective moved to ` +
            `"${String(actor.getSnapshot().value)}" and did not advance to done. ` +
            'Resume and integrate again to finish.',
        })
      }

      runner.send(objective.id, event)
      return reply.code(202).send({ ok: true, state: String(actor.getSnapshot().value) })
    }

    // Everything except `prompt`, `cancel` and `integrate` is a machine command.
    //
    // `cancel` is deliberately NOT among them. M0's `cancel` cancels the
    // in-flight *turn* and is what the hand-driven corpus-recording path uses
    // to unwedge a slow turn; spec §7's `cancel` in the machine's command list
    // means abandoning the whole objective, which is terminal. Two different
    // verbs collided on one name, and mapping this one to the machine's
    // `CANCEL` would destroy an objective every time a recording session
    // stopped a turn. The turn meaning is kept; reaching the machine's
    // `CANCEL` is left to phase 5's Focus View, which has room for both.
    // (`integrate` is already fully handled above — every action, `discard`
    // included, now goes through the machine — so it cannot reach here; TS
    // narrows it out.)
    if (parsed.data.type !== 'prompt' && parsed.data.type !== 'cancel') {
      const runner = deps.runner
      if (!runner) return reply.code(500).send({ error: 'Workflow runner is not configured' })

      const translated = toWorkflowEvent(db, objective.id, parsed.data)
      if ('error' in translated) {
        return reply.code(translated.status).send({ error: translated.error })
      }

      const actor = ensureActor(runner, db, objective.id)
      const state = String(actor.getSnapshot().value)
      // A command the machine will not accept must not answer 200. An ignored
      // command reported as success is the "never drop silently" failure this
      // codebase has paid for more than once — and the state name is the only
      // thing that tells a caller why.
      if (!actor.getSnapshot().can(translated.event)) {
        return reply
          .code(409)
          .send({ error: `Command "${parsed.data.type}" is not accepted in state "${state}"` })
      }

      runner.send(objective.id, translated.event)
      return reply.code(202).send({ ok: true, state: String(actor.getSnapshot().value) })
    }

    const agents = deps.agents
    if (!agents) return reply.code(500).send({ error: 'Agent registry is not configured' })

    if (parsed.data.type === 'cancel') {
      // Requesting a cancel is not the same event as a turn ending, and
      // conflating them broke both ways — see `cancelOpenTurn`, which owns the
      // sequence now that the machine's `paused` entry needs it too. Emitting
      // `prompt_cancelled` here put a *second* terminal record in the turn once
      // the in-flight prompt settled and emitted its own, and `loadTranscript`
      // closes a turn on the first terminal, so every update streamed in
      // between was replayed outside the turn while the live pipeline had
      // counted it. Emissions could vanish from scoring, which raises precision
      // by hiding a false positive.
      const cancelled = await cancelOpenTurn({ db, bus, agents }, objective.id)
      if (!cancelled) return reply.code(409).send({ error: 'No active agent session' })
      return reply.code(200).send({ ok: true })
    }

    // type === 'prompt'
    const { text: rawText, phase } = parsed.data
    if ((rawText === undefined) === (phase === undefined)) {
      return reply.code(400).send({ error: 'Provide exactly one of "text" or "phase"' })
    }

    try {
      // Validate the phase/placeholders *before* touching the agent registry:
      // a bad request must 400 without spawning (or reusing) a real adapter
      // child process, an ACP handshake, or an `agent_sessions` row.
      renderTurnPrompt(objective, { phase, text: rawText, vars: parsed.data.vars })

      const { sessionId } = await agents.ensure(objective)
      // Do not await the turn: it can run for minutes, and progress is
      // observable over SSE. The response only confirms the prompt was
      // accepted. `runTurn` throws synchronously (before returning its
      // promise) for the caller-error cases below, so this `try` still
      // catches them even though the call itself is `void`-ed.
      void runTurn({ db, bus, agents }, objective, {
        phase,
        text: rawText,
        vars: parsed.data.vars,
      })
      return reply.code(202).send({ ok: true, sessionId })
    } catch (err) {
      if (err instanceof TurnRejected) return reply.code(err.status).send({ error: err.message })
      const message = errorMessage(err)
      bus.emit({ objectiveId: objective.id, type: 'agent_start_failed', payload: { message } })
      return reply.code(500).send({ error: message })
    }
  })
}
