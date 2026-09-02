import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { WorkflowEvent } from '@vadd/core'
import {
  assertSpecAllowed,
  CreateObjectiveBody,
  evidenceComplete,
  mergeSpec,
  normalizeChecks,
  ObjectiveCommand,
  planTaskId,
  VerificationSpec,
} from '@vadd/core'
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db/client.js'
import {
  agentSessions,
  artifacts,
  decisions,
  events,
  evidenceItems,
  machineSnapshots,
  objectives,
  planTasks,
  projectMemory,
  projects,
} from '../../db/schema.js'
import { objectiveDiff, objectiveFileDiff } from '../../git/diff.js'
import { createWorktree, removeWorktree } from '../../git/git-manager.js'
import { branchExists } from '../../git/inspect.js'
import { branchNameFor, worktreePathFor } from '../../paths.js'
import {
  INVESTIGATION_VERIFICATION_SPEC,
  type Resolution,
  resolveVerification,
} from '../../verification/resolve.js'
import { runSetup } from '../../verification/setup.js'
import { currentEvidence } from '../../workflow/effects.js'
import { runIntegration } from '../../workflow/integrate.js'
import type { WorkflowRunner } from '../../workflow/runner.js'
import { loadSnapshot } from '../../workflow/store.js'
import { cancelOpenTurn, renderTurnPrompt, runTurn, TurnRejected } from '../../workflow/turn.js'
import { activityFor } from '../activity.js'
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
          // `planTaskId` matches the machine's own convention when it builds
          // tasks from a `plan` event; an edited list that numbered its tasks
          // differently would not line up with the `plan_tasks` rows, and a
          // bare ordinal here would no longer line up with them at all.
          tasks: command.edits?.map((t, ord) => ({
            id: planTaskId(objectiveId, ord),
            ord,
            title: t.title,
            description: t.description,
            checkpointRef: null,
            expectFailing: t.expectFailing,
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

  // D6, spec §8's `/today`: "counts of verified outcomes, decisions made,
  // checks passed. Text only. Not gamified." Local server time, deliberately
  // — this is a single-user localhost app, and a UTC-precise day boundary
  // would only confuse the one person reading the page. Every count is a
  // plain row count, not deduplicated by task/decision/check id, matching how
  // the Objective Board already treats its own verifiedCount/totalCount tally.
  app.get<{ Params: { id: string } }>('/api/projects/:id/today', async (req, reply) => {
    const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get()
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const since = startOfDay.toISOString()

    const y = startOfDay.getFullYear()
    const m = String(startOfDay.getMonth() + 1).padStart(2, '0')
    const d = String(startOfDay.getDate()).padStart(2, '0')
    const date = `${y}-${m}-${d}`

    const verifiedTasks = db
      .select({ id: planTasks.id })
      .from(planTasks)
      .innerJoin(objectives, eq(planTasks.objectiveId, objectives.id))
      .where(
        and(
          eq(objectives.projectId, project.id),
          eq(planTasks.status, 'verified'),
          gte(planTasks.finishedAt, since),
        ),
      )
      .all().length

    const decisionsMade = db
      .select({ id: decisions.id })
      .from(decisions)
      .innerJoin(objectives, eq(decisions.objectiveId, objectives.id))
      .where(and(eq(objectives.projectId, project.id), gte(decisions.decidedAt, since)))
      .all().length

    const checksPassed = db
      .select({ id: evidenceItems.id })
      .from(evidenceItems)
      .innerJoin(objectives, eq(evidenceItems.objectiveId, objectives.id))
      .where(
        and(
          eq(objectives.projectId, project.id),
          eq(evidenceItems.kind, 'check'),
          eq(evidenceItems.status, 'pass'),
          isNotNull(evidenceItems.commandId),
          gte(evidenceItems.createdAt, since),
        ),
      )
      .all().length

    return { date, verifiedTasks, decisionsMade, checksPassed }
  })

  // Deliberately not the capped/formatted prompt-injection helper
  // (`buildProjectMemoryPromptBlock`) — this is the full, uncapped list for a
  // human reading the project, not a bounded block for an agent's context.
  app.get<{ Params: { id: string } }>('/api/projects/:id/memory', async (req, reply) => {
    const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get()
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    const notes = db
      .select()
      .from(projectMemory)
      .where(eq(projectMemory.projectId, project.id))
      .orderBy(desc(projectMemory.createdAt))
      .all()

    return { notes }
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
    //
    // Design §3, amendment A15: investigation objectives have nothing to
    // run, ever — resolving against the repo's config or auto-detection
    // would offer commands that can never apply to a read-only objective.
    const resolution: Resolution =
      parsed.data.mode === 'investigation'
        ? {
            kind: 'resolved',
            spec: mergeSpec(
              INVESTIGATION_VERIFICATION_SPEC,
              parsed.data.verificationOverrides ?? null,
            ),
            source: 'detected',
          }
        : resolveVerification(project.repoPath, parsed.data.verificationOverrides ?? null)
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

    // "Continue" follow-ups (best-effort): the prior objective's own branch,
    // when it still exists, so the new worktree literally continues from
    // where the old one left off rather than the project's default branch.
    let startPoint: string | undefined
    if (parsed.data.continuedFromId) {
      const prior = db
        .select()
        .from(objectives)
        .where(eq(objectives.id, parsed.data.continuedFromId))
        .get()
      if (prior?.branchName && (await branchExists(project.repoPath, prior.branchName))) {
        startPoint = prior.branchName
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
        continuedFromId: parsed.data.continuedFromId ?? null,
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
      baseSha = await createWorktree(project.repoPath, path, branch, startPoint)
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

  /** Spec §8's board, unstyled: every objective, newest first. Registered
   * before `/api/objectives/:id` — a parameterised route registered first
   * would shadow this literal path and treat "objectives" as an id. */
  app.get<{ Querystring: { projectId?: string } }>('/api/objectives', async (req) => {
    const { projectId } = req.query
    const rows = db
      .select()
      .from(objectives)
      .where(projectId ? eq(objectives.projectId, projectId) : undefined)
      .orderBy(desc(objectives.createdAt))
      .all()
    const taskRows = db
      .select({ objectiveId: planTasks.objectiveId, status: planTasks.status })
      .from(planTasks)
      .all()
    const counts = new Map<string, { verified: number; total: number }>()
    for (const t of taskRows) {
      const c = counts.get(t.objectiveId) ?? { verified: 0, total: 0 }
      c.total += 1
      if (t.status === 'verified') c.verified += 1
      counts.set(t.objectiveId, c)
    }
    return rows.map((r) => ({
      ...r,
      verifiedCount: counts.get(r.id)?.verified ?? 0,
      totalCount: counts.get(r.id)?.total ?? 0,
    }))
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
    // Amendment A12: the only way the UI learns an auto-approval happened —
    // the raise that produces it means `awaitingReview`/`awaitingPlanApproval`
    // are never actually rendered, and the frontend never reads SSE payloads.
    const lastAutoApprovalEvent = db
      .select()
      .from(events)
      .where(
        and(
          eq(events.objectiveId, row.id),
          inArray(events.type, ['task_auto_approved', 'plan_auto_approved']),
        ),
      )
      .orderBy(desc(events.id))
      .limit(1)
      .get()

    return {
      objective: row,
      state: actor ? String(actor.getSnapshot().value) : row.status,
      // A clarification writes no `decisions` row — the question lives only in
      // the machine's context, so `clarifying` has nothing to render without
      // this. No live actor means no question to show.
      pendingClarification: actor ? actor.getSnapshot().context.pendingClarification : null,
      tasks: db
        .select()
        .from(planTasks)
        .where(eq(planTasks.objectiveId, row.id))
        .orderBy(planTasks.ord)
        .all(),
      decisions: db.select().from(decisions).where(eq(decisions.objectiveId, row.id)).all(),
      // Amendment A24: every artifact, newest first; the UI shows the newest
      // per state. The aggregate is the channel because the frontend never
      // reads SSE payloads (spec §7).
      artifacts: db
        .select()
        .from(artifacts)
        .where(eq(artifacts.objectiveId, row.id))
        .orderBy(desc(artifacts.createdAt))
        .all(),
      evidence: db.select().from(evidenceItems).where(eq(evidenceItems.objectiveId, row.id)).all(),
      ...activityFor(db, row.id),
      lastAutoApproval: lastAutoApprovalEvent
        ? {
            kind: (lastAutoApprovalEvent.type === 'task_auto_approved' ? 'task' : 'plan') as
              | 'task'
              | 'plan',
            taskOrd: (lastAutoApprovalEvent.payload as { ord?: number }).ord ?? null,
            at: lastAutoApprovalEvent.createdAt,
          }
        : null,
      /**
       * Whether the recorded worktree directory is gone.
       *
       * The aggregate is the channel because the frontend never reads SSE
       * payloads (spec §7) — the same reason amendment A12's
       * `lastAutoApproval` lives here.
       *
       * Deliberately `existsSync` and not a git call. This covers `vanished`
       * and not a claimed `stranded` worktree, which is equally broken for its
       * objective; covering that means asking git for its worktree list on a
       * route that sits on the Focus View's read path, where this is one
       * syscall and that is a subprocess. The field is named for exactly what
       * it tests, and `stranded` is the `/git` console's to report.
       *
       * Two different definitions of "gone" coexist in the codebase, and they
       * can disagree: this one is `existsSync`, which *follows* a symlink and
       * asks whether its target exists; `strays.ts`'s `vanished` is absence
       * from a `readdir` listing, which now also flags a symlink entry itself
       * (see its comment) regardless of what it points at. A worktree
       * relocated behind a live symlink reads healthy here — the target
       * exists — while `readdir` still lists the link. The `git/release`
       * route's own `existsSync` guard on the `vanished` branch is what stops
       * that kind of disagreement from being destructive: it re-checks the
       * disk immediately before nulling anything, rather than trusting either
       * read on its own.
       */
      worktreeMissing: row.worktreePath !== null && !existsSync(row.worktreePath),
    }
  })

  app.get<{ Params: { id: string } }>(
    '/api/objectives/:id/continuation-seed',
    async (req, reply) => {
      const objective = db.select().from(objectives).where(eq(objectives.id, req.params.id)).get()
      if (!objective) return reply.code(404).send({ error: 'Objective not found' })

      const rows = db
        .select({ payload: events.payload })
        .from(events)
        .where(and(eq(events.objectiveId, objective.id), eq(events.type, 'agent_event')))
        .orderBy(desc(events.id))
        .all()
      const claim =
        rows
          .map((r) => r.payload as { event?: { type?: string; claim?: string } })
          .find((p) => p.event?.type === 'task_result' && typeof p.event.claim === 'string')?.event
          ?.claim ?? null

      const tasks = db.select().from(planTasks).where(eq(planTasks.objectiveId, objective.id)).all()
      const verifiedCount = tasks.filter((t) => t.status === 'verified').length

      return {
        projectId: objective.projectId,
        title: objective.title,
        goalText: objective.goalText,
        status: objective.status,
        lastClaim: claim,
        verifiedCount,
        totalCount: tasks.length,
      }
    },
  )

  // Spec §7: "stats + file list; ?file= returns unified diff".
  app.get<{ Params: { id: string }; Querystring: { file?: string } }>(
    '/api/objectives/:id/diff',
    async (req, reply) => {
      const row = db.select().from(objectives).where(eq(objectives.id, req.params.id)).get()
      if (!row) return reply.code(404).send({ error: 'Objective not found' })
      if (!row.worktreePath || !row.baseSha) {
        // An objective that has been committed, discarded or predates
        // amendment A8 has nothing to diff. Saying so beats an empty list,
        // which reads as "no changes".
        return reply
          .code(409)
          .send({ error: 'Objective has no worktree or no recorded base commit' })
      }

      const summary = await objectiveDiff(row.worktreePath, row.baseSha)
      const wanted = req.query.file
      if (wanted === undefined) return summary

      // Matched against the list rather than interpolated into a git
      // invocation: a path that is not in the list 404s, so nothing
      // user-supplied reaches the command line.
      if (!summary.files.some((f) => f.path === wanted)) {
        return reply.code(404).send({ error: `No such file in this objective's diff: ${wanted}` })
      }
      const text = await objectiveFileDiff(row.worktreePath, row.baseSha, wanted)
      return reply.type('text/plain; charset=utf-8').send(text)
    },
  )

  // Spec §7's Level 3 escape hatch. The same shape the SSE stream emits, so
  // the raw view and the debug page cannot disagree about what happened.
  app.get<{ Params: { id: string }; Querystring: { since?: string } }>(
    '/api/objectives/:id/raw',
    async (req, reply) => {
      const row = db.select().from(objectives).where(eq(objectives.id, req.params.id)).get()
      if (!row) return reply.code(404).send({ error: 'Objective not found' })
      const parsed = Number.parseInt(req.query.since ?? '0', 10)
      const since = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
      return bus.since(row.id, since)
    },
  )

  /**
   * The destructive delete. Separate from `integrate: discard`, which since
   * amendment A9 means "this was proven and I do not want it" and keeps every
   * row — the evidence is worth keeping even when the code is not.
   */
  app.delete<{ Params: { id: string } }>('/api/objectives/:id', async (req, reply) => {
    const objective = db.select().from(objectives).where(eq(objectives.id, req.params.id)).get()
    if (!objective) return reply.code(404).send({ error: 'Objective not found' })

    const project = db.select().from(projects).where(eq(projects.id, objective.projectId)).get()
    if (!project) return reply.code(500).send({ error: 'Objective has no project' })

    // The machine is stopped before the rows go: an actor left running on a
    // deleted objective would still hold a binding whose next turn writes to
    // rows that no longer exist.
    deps.runner?.stop(objective.id)
    await deps.agents?.stop(objective.id)

    if (objective.worktreePath && objective.branchName) {
      await removeWorktree(project.repoPath, objective.worktreePath, objective.branchName)
    }
    // Every one of these tables has a foreign key on objectives.id with no
    // cascade, so each must be cleared before the objective row itself or the
    // delete fails the constraint. `evidence_items` goes first because it also
    // references `plan_tasks`. Against the real server this list being short by
    // four tables removed a worktree and then 500'd, leaving a row pointing at
    // a directory that no longer existed — hence one transaction. Amendment A24's
    // `artifacts` is the seventh.
    db.transaction((tx) => {
      tx.delete(artifacts).where(eq(artifacts.objectiveId, objective.id)).run()
      tx.delete(evidenceItems).where(eq(evidenceItems.objectiveId, objective.id)).run()
      tx.delete(planTasks).where(eq(planTasks.objectiveId, objective.id)).run()
      tx.delete(decisions).where(eq(decisions.objectiveId, objective.id)).run()
      tx.delete(machineSnapshots).where(eq(machineSnapshots.objectiveId, objective.id)).run()
      tx.delete(agentSessions).where(eq(agentSessions.objectiveId, objective.id)).run()
      tx.delete(objectives).where(eq(objectives.id, objective.id)).run()
    })
    bus.emit({
      objectiveId: objective.id,
      type: 'objective_discarded',
      payload: { id: objective.id },
    })
    return reply.code(200).send({ ok: true })
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

    // Amendment A12: D8's toggle. Not routed through `toWorkflowEvent` at all
    // — like `tick_check`, it needs a DB write the generic dispatch path
    // (below) doesn't do for anything else. `objectives.lowEnergy` must
    // survive a restart even though the machine's own SET_LOW_ENERGY assign
    // is context-only and fires no transition — `commitTransition` only
    // persists a snapshot on a real state-value change (`WorkflowRunner`'s
    // `#attach`), so nothing else would write this through to the row
    // `resume()` reads on reboot.
    if (parsed.data.type === 'set_low_energy') {
      const runner = deps.runner
      if (!runner) return reply.code(500).send({ error: 'Workflow runner is not configured' })
      db.update(objectives)
        .set({ lowEnergy: parsed.data.value, updatedAt: new Date().toISOString() })
        .where(eq(objectives.id, objective.id))
        .run()
      runner.get(objective.id)?.send({ type: 'SET_LOW_ENERGY', value: parsed.data.value })
      bus.emit({
        objectiveId: objective.id,
        type: 'low_energy_set',
        payload: { value: parsed.data.value },
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
      if (action === 'commit' && objective.mode === 'investigation') {
        // Design §4, amendment A15: an investigation objective has no diff by
        // construction — there is nothing for the squash to act on.
        return reply.code(400).send({
          error: 'integrate via "commit" is not available for an investigation-mode objective',
        })
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

      // `can()` answers "does a transition exist", never "did the guard pass" —
      // and `integrating`'s INTEGRATE is an array whose last branch is
      // unguarded, so it is true from `integrating` whatever the evidence says.
      // The real guard has to be evaluated here, *before* the git work:
      // `commit` squashes and removes the worktree and `discard` force-deletes
      // the branch, and doing either on an unproven objective and answering 2xx
      // is destructive work reported as success.
      //
      // Read from the table rather than from `context.evidence`, which is the
      // snapshot `verifying` took: a manual untick since then sends no
      // `EVIDENCE_RESULT`, so the context alone would never learn of it.
      const context = actor.getSnapshot().context
      const items = currentEvidence(db, objective.id, context)
      if (!evidenceComplete(context.verificationSpec, items)) {
        return reply.code(409).send({
          error:
            'The evidence set is not complete, so this objective cannot reach done. ' +
            'Every required command must pass and every check must be satisfied.',
        })
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

      // Hand the machine the same set this route just judged, so its own
      // `evidenceComplete` evaluates the table rather than the snapshot
      // `verifying` took. Without this the two agree only by an argument about
      // reachability — that `awaitingReview` is entered through a guarded
      // transition, so the context is green on arrival, and `tick_check` can
      // only make the table worse than the context, never better. That
      // argument holds today, but it is a fragile thing to rest a squash and a
      // worktree removal on. `integrating` has this handler for exactly this
      // reason: "the set can go red between review and integration".
      runner.send(objective.id, { type: 'EVIDENCE_RESULT', items })
      runner.send(objective.id, event)
      // Assert the outcome rather than assuming it. The machine re-evaluates
      // `evidenceComplete` against its *own* context, which the checks above
      // cannot speak for, and its unguarded fallback is `paused` — a silent
      // `{ok:true}` there would report an objective as done that is not.
      const settled = String(actor.getSnapshot().value)
      if (settled !== 'done') {
        return reply.code(409).send({
          error:
            `The "${action}" git work completed, but the objective settled in ` +
            `"${settled}" rather than done. Resume and integrate again to finish.`,
        })
      }
      return reply.code(202).send({ ok: true, state: settled })
    }

    if (parsed.data.type === 'abandon') {
      const runner = deps.runner
      if (!runner) return reply.code(500).send({ error: 'Workflow runner is not configured' })

      const project = db.select().from(projects).where(eq(projects.id, objective.projectId)).get()
      if (!project) return reply.code(500).send({ error: 'Objective has no project' })

      const actor = ensureActor(runner, db, objective.id)
      const event: WorkflowEvent = { type: 'CANCEL' }
      // `can()` alone is not enough: it resolves the transition table against
      // the state *value*, not the actor's runtime status, so a snapshot
      // resumed from an already-terminal state (`done`/`cancelled`/`failed`)
      // still reports `can({type:'CANCEL'})` as true — verified by hand, since
      // the root `on: { CANCEL: '.cancelled' }` transition is defined for
      // every value including `cancelled` itself. `status === 'done'` is the
      // actual terminality check.
      if (actor.getSnapshot().status === 'done' || !actor.getSnapshot().can(event)) {
        return reply.code(409).send({
          error: `Cannot abandon from state "${String(actor.getSnapshot().value)}"`,
        })
      }

      // Stop the turn before the machine goes terminal, for the same reason
      // `paused` does: a running prompt on an abandoned objective writes into
      // rows nobody is watching.
      if (deps.agents) {
        await cancelOpenTurn({ db, bus, agents: deps.agents }, objective.id).catch(() => false)
      }
      await deps.agents?.stop(objective.id)

      const outcome = await runIntegration({ db, bus }, objective, project, 'discard')
      if (!outcome.ok) return reply.code(500).send({ error: outcome.message })

      runner.send(objective.id, event)
      return reply.code(202).send({ ok: true, state: String(actor.getSnapshot().value) })
    }

    // Everything except `prompt`, `cancel` and `abandon` is a machine command.
    //
    // `cancel` is deliberately NOT among them. M0's `cancel` cancels the
    // in-flight *turn* and is what the hand-driven corpus-recording path uses
    // to unwedge a slow turn. Amendment A9 gives spec §7's "abandon the whole
    // objective, terminal" meaning its own name, `abandon`, precisely so it
    // does not collide with M0's `cancel` — mapping the M0 verb onto the
    // machine's `CANCEL` would destroy an objective every time a recording
    // session stopped a turn. `abandon` is handled in its own branch above,
    // before this one, so it never reaches the generic translator either.
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
