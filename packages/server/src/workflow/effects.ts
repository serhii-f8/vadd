import { randomUUID } from 'node:crypto'
import type { EvidenceItemLike, WorkflowContext, WorkflowEvent } from '@vadd/core'
import { normalizeChecks, VerificationSpec, workflowMachine } from '@vadd/core'
import { and, eq } from 'drizzle-orm'
import { fromPromise } from 'xstate'
import type { AgentRegistry } from '../agent/registry.js'
import type { Db } from '../db/client.js'
import { decisions, evidenceItems, objectives, planTasks } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { checkpointCommit, resetHard } from '../git/git-manager.js'
import { collectEvidence } from '../verification/collector.js'
import { runTurn, type TurnOutcome } from './turn.js'

type Deps = { db: Db; bus: EventBus; agents: AgentRegistry }
type ObjectiveRow = typeof objectives.$inferSelect
/** The minimum `WorkflowRunner` surface these actions need. */
type RunnerLike = { send(objectiveId: string, event: WorkflowEvent): void }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Re-reads the objective row rather than trusting a value captured once at
 * actor-construction time (Task 7's review flagged exactly this as worth
 * fixing here): `title`/`goalText` rarely change, but `worktreePath` is the
 * one field every git-touching action needs fresh, and nothing prevents a
 * caller from pointing an objective at a different path between turns.
 */
function loadObjective(db: Db, objectiveId: string): ObjectiveRow {
  const row = db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()
  if (!row) throw new Error(`No objective row for ${objectiveId}`)
  return row
}

/**
 * `checkpoint` and `sendPrompt`'s `execute-task` branch are two separate named
 * actions XState fires back-to-back, synchronously, from `executing`'s entry
 * array — there is no way for one to "block" the other at the machine level.
 * `bindEffects` closes over this map so `checkpoint` can publish its outcome
 * and `sendPrompt` can await it before ever calling `runTurn`: "never proceed
 * to the prompt with no checkpoint" is enforced here, not in the machine.
 *
 * The same map also gives `checkpoint` and `rollbackToCheckpoint` a shared
 * queue: `rollingBack`'s `always: 'executing'` re-enters `executing` (and so
 * fires `checkpoint` again) synchronously, before `rollbackToCheckpoint`'s own
 * `git reset --hard` has necessarily finished, and two git commands racing on
 * one worktree is a real hazard, not a hypothetical one.
 */
type GitGate = {
  /** Chains `fn` after whatever git operation is currently pending for this objective. */
  enqueue<T>(objectiveId: string, fn: () => Promise<T>): Promise<T>
  /** The outcome of the most recently enqueued checkpoint, consumed once by `sendPrompt`. */
  pendingCheckpoint: Map<string, Promise<boolean>>
}

function createGitGate(): GitGate {
  const queue = new Map<string, Promise<unknown>>()
  return {
    enqueue<T>(objectiveId: string, fn: () => Promise<T>): Promise<T> {
      const prior = queue.get(objectiveId) ?? Promise.resolve()
      const result = prior.then(fn, fn)
      // Stored value never rejects: a failed op must not poison the chain for
      // whatever runs after it (a retry, a later task's checkpoint, ...).
      queue.set(
        objectiveId,
        result.catch(() => undefined),
      )
      return result
    },
    pendingCheckpoint: new Map(),
  }
}

/**
 * `execute-task`'s prompt vars, plus the `reviseInstruction` amendment.
 *
 * Reads `context.tasks[context.currentTaskIndex]` — **never `tasks[0]`**. The
 * corpus-recording harness's `tasks[0]` assumption cost a label in the phase
 * 2d gate run (CLAUDE.md, "Traps Task 14 paid for"); the machine advances
 * `currentTaskIndex` on every `APPROVE_TASK`, so a fixed index is wrong from
 * the second task on.
 */
function executeTaskVars(
  context: WorkflowContext,
): { taskTitle: string; taskDescription: string } | null {
  const task = context.tasks[context.currentTaskIndex]
  if (!task) return null
  const description = context.reviseInstruction
    ? `${task.description}\n\nRevision note: ${context.reviseInstruction}`
    : task.description
  return { taskTitle: task.title, taskDescription: description }
}

/**
 * One `check-<index>: text` line per `verify.checks` entry, per `verify.md`.
 *
 * The commands are EvidenceCollector's now, so the agent's verify turn is asked
 * only for what a command cannot produce: a judgement on the acceptance checks.
 * Null when there is nothing to judge — the caller then sends no verify prompt
 * at all rather than one with an empty list.
 */
function verificationChecksVar(context: WorkflowContext): string | null {
  if (!context.verificationSpec) return null
  const checks = normalizeChecks(context.verificationSpec)
  if (checks.length === 0) return null
  return checks.map((c) => `${c.id}: ${c.text}`).join('\n')
}

async function sendPromptEffect(
  deps: Deps,
  objectiveId: string,
  runner: RunnerLike,
  context: WorkflowContext,
  phase: string,
  gitGate: GitGate,
): Promise<void> {
  // Never proceed to the prompt with no checkpoint: this is the other half of
  // `checkpoint`'s failure handling (see `GitGate`'s doc comment above).
  if (phase === 'execute-task') {
    const pending = gitGate.pendingCheckpoint.get(objectiveId)
    if (pending) {
      gitGate.pendingCheckpoint.delete(objectiveId)
      const ok = await pending
      if (!ok) return
    }
  }

  let vars: Record<string, string> = {}
  if (phase === 'execute-task') {
    const taskVars = executeTaskVars(context)
    if (!taskVars) {
      const message = `No task at index ${context.currentTaskIndex} to execute`
      deps.bus.emit({
        objectiveId,
        type: 'task_index_invalid',
        payload: { currentTaskIndex: context.currentTaskIndex, message },
      })
      runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
      return
    }
    vars = taskVars
  } else if (phase === 'plan' && context.reviseInstruction) {
    // Amendment A10: a REVISE from awaitingPlanApproval re-enters `planning`,
    // whose template only has `{{goalText}}` — override the default merge
    // (`renderTurnPrompt` spreads `turn.vars` after it) rather than adding a
    // new placeholder, the same reuse `executeTaskVars` already relies on.
    vars = { goalText: `${context.goalText}\n\nRevision note: ${context.reviseInstruction}` }
  } else if (phase === 'verify') {
    const verificationChecks = verificationChecksVar(context)
    // A null spec, or one with no checks, must never let the literal
    // `{{verificationChecks}}` placeholder reach the agent — this repo has
    // already shipped that bug once with the commands placeholder (CLAUDE.md's
    // "Traps Task 14 paid for"). The machine's `hasChecks` guard means this
    // branch should be unreachable; it stays because "should be" is not a
    // guarantee, and the failure mode is a silently broken prompt.
    if (verificationChecks === null) {
      const message = 'No verification checks resolved for this objective'
      deps.bus.emit({ objectiveId, type: 'verification_unresolved', payload: { message } })
      runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
      return
    }
    vars = { verificationChecks }
  }

  const row = loadObjective(deps.db, objectiveId)
  const objectiveRef = {
    id: row.id,
    title: row.title,
    goalText: row.goalText,
    worktreePath: row.worktreePath,
  }

  // `runTurn` requires a session that already exists — it calls `agents.get()`
  // and throws `TurnRejected('No active agent session', 500)` on a miss. The
  // prompt *route* satisfies that by calling `ensure()` itself; nothing did on
  // the machine path, so every machine-driven objective failed its very first
  // `sendPrompt` and fell straight to `paused`. Both this file's tests and the
  // runner's pre-called `ensure()` in their setup, which hid it.
  //
  // Guarded by `get()` rather than always awaiting `ensure()`: an unconditional
  // await defers the `prompt()` call by a microtask even when a session is
  // already live, and every existing turn-driving test settles the fake prompt
  // synchronously after `send()`. Skipping the await on the hot path keeps that
  // contract and confines the asynchrony to the one turn that genuinely starts
  // an adapter.
  if (!deps.agents.get(objectiveId)) {
    try {
      await deps.agents.ensure(objectiveRef)
    } catch (err) {
      const message = errorMessage(err)
      deps.bus.emit({ objectiveId, type: 'agent_start_failed', payload: { message } })
      runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
      return
    }
  }

  let attempt: Promise<TurnOutcome>
  try {
    attempt = runTurn(deps, objectiveRef, { phase, vars })
  } catch (err) {
    // `runTurn` can throw synchronously (`TurnRejected` — e.g. a turn already
    // in flight, or a bad phase). No turn was opened, so there is nothing to
    // settle — report it directly.
    const message = errorMessage(err)
    deps.bus.emit({ objectiveId, type: 'prompt_rejected', payload: { message } })
    runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
    return
  }

  const outcome = await attempt.catch(
    (err): TurnOutcome => ({ ok: false, turnId: '', reason: 'error', message: errorMessage(err) }),
  )

  if (outcome.ok) {
    runner.send(objectiveId, { type: 'TURN_FINISHED' })
  } else {
    runner.send(objectiveId, {
      type: 'TURN_FAILED',
      reason: outcome.reason,
      message: outcome.message,
    })
  }
}

async function checkpointEffect(
  deps: Deps,
  objectiveId: string,
  context: WorkflowContext,
  runner: RunnerLike,
): Promise<boolean> {
  const task = context.tasks[context.currentTaskIndex]
  if (!task) {
    const message = `No current task to checkpoint (index ${context.currentTaskIndex})`
    deps.bus.emit({ objectiveId, type: 'checkpoint_failed', payload: { message } })
    runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
    return false
  }

  const row = loadObjective(deps.db, objectiveId)
  if (!row.worktreePath) {
    const message = `Objective ${objectiveId} has no worktree path`
    deps.bus.emit({ objectiveId, type: 'checkpoint_failed', payload: { message } })
    runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
    return false
  }

  try {
    const sha = await checkpointCommit(row.worktreePath, `vadd-checkpoint: ${task.title}`)
    deps.db
      .update(planTasks)
      .set({ checkpointRef: sha, status: 'running', startedAt: new Date().toISOString() })
      // Scoped by objective as well as by task id, for the same reason
      // `recordDecisionChoice` is: `task.id` comes out of the actor's context,
      // which a rehydrated or hand-edited snapshot can carry from anywhere.
      // While ids were bare ordinals this write really did land on a different
      // objective's row — it is the reason `plan_tasks` now has an
      // objective-scoped identity at all, and the scope stays regardless.
      .where(and(eq(planTasks.id, task.id), eq(planTasks.objectiveId, objectiveId)))
      .run()
    return true
  } catch (err) {
    const message = errorMessage(err)
    deps.bus.emit({ objectiveId, type: 'checkpoint_failed', payload: { message } })
    runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
    return false
  }
}

async function rollbackEffect(
  deps: Deps,
  objectiveId: string,
  context: WorkflowContext,
  runner: RunnerLike,
): Promise<void> {
  const task = context.tasks[context.currentTaskIndex]
  // Not `task?.checkpointRef`: the machine's own `PLAN` handler always seeds
  // context's copy as null (see `workflow-machine.ts`'s `tasks:` assign) and
  // nothing in the machine ever updates it — `checkpoint`'s real sha only
  // ever lands in the `plan_tasks` row, so that is the source of truth here.
  const taskRow = task
    ? deps.db
        .select()
        .from(planTasks)
        .where(and(eq(planTasks.id, task.id), eq(planTasks.objectiveId, objectiveId)))
        .get()
    : undefined
  const ref = taskRow?.checkpointRef ?? null
  if (!ref) {
    const message = 'No checkpoint to roll back to'
    deps.bus.emit({
      objectiveId,
      type: 'rollback_unavailable',
      payload: { taskId: task?.id ?? null, message },
    })
    runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
    return
  }

  const row = loadObjective(deps.db, objectiveId)
  if (!row.worktreePath) {
    const message = `Objective ${objectiveId} has no worktree path`
    deps.bus.emit({ objectiveId, type: 'rollback_unavailable', payload: { message } })
    runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
    return
  }

  try {
    await resetHard(row.worktreePath, ref)
  } catch (err) {
    const message = errorMessage(err)
    deps.bus.emit({ objectiveId, type: 'rollback_failed', payload: { message } })
    runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
  }
}

/**
 * The evidence set the guard is allowed to see right now (design §5.4).
 *
 * Command rows are scoped to the **current run**: verification evidence must be
 * freshly produced, or a green run recorded before a `ROLLBACK` would still be
 * sitting in the table to satisfy the guard after a later red one. The link is
 * the log path — every collector row's log lives under
 * `<artifacts>/<objectiveId>/<runId>/`, a denied command's included — so a row
 * carries its own provenance and agent-emitted rows (which have no
 * `artifactPath`) cannot match.
 *
 * Check rows are scoped to the **epoch** instead, so a user's manual tick
 * survives a re-verify while commands are re-proven every time. The most recent
 * row per `checkId` wins, which is what makes an untick supersede a tick.
 *
 * Exported because the `integrate` route needs it too: the machine's
 * `context.evidence` is the snapshot taken in `verifying`, and a manual untick
 * afterwards sends no `EVIDENCE_RESULT`. Re-reading the table is what makes the
 * user's own "this is not met" reach the guard before any git work happens.
 */
export function currentEvidence(
  db: Db,
  objectiveId: string,
  context: WorkflowContext,
): EvidenceItemLike[] {
  const rows = db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.objectiveId, objectiveId))
    .all()

  const commandIds = new Set(context.verificationSpec?.verify.commands.map((c) => c.id) ?? [])
  const epoch = context.verificationEpoch ?? ''
  const runId = context.verificationRunId

  const fromRun =
    runId === null
      ? []
      : rows.filter(
          (r) =>
            r.commandId !== null &&
            commandIds.has(r.commandId) &&
            r.artifactPath?.includes(`/${runId}/`) === true,
        )

  // Most recent row per checkId, at or after the epoch.
  const checks = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (row.kind !== 'check' || row.commandId === null) continue
    if (row.createdAt < epoch) continue
    const seen = checks.get(row.commandId)
    if (!seen || seen.createdAt <= row.createdAt) checks.set(row.commandId, row)
  }

  return [...fromRun, ...checks.values()].map((r) => ({
    commandId: r.commandId,
    kind: r.kind,
    status: r.status,
    taskId: r.taskId,
  }))
}

/**
 * Binds the machine's seven named side effects (design §6.1: `core` names
 * them, the server implements them) plus the prompt-rendering seam Task 7
 * used as a temporary stand-in. `objective` is read once, at bind time, only
 * to seed the very first turn's identity — every action that touches
 * `title`/`goalText`/`worktreePath` re-reads the row fresh (see
 * `loadObjective`).
 */
export function bindEffects(
  deps: Deps,
  objective: ObjectiveRow,
  runner: RunnerLike,
): typeof workflowMachine {
  const objectiveId = objective.id
  const gitGate = createGitGate()

  return workflowMachine.provide({
    actors: {
      /**
       * EvidenceCollector, invoked by `verifying`. `signal` is xstate's own —
       * it aborts when the state is exited, so a `PAUSE` mid-suite stops the
       * commands instead of leaving them running against a worktree nobody is
       * watching.
       */
      runVerification: fromPromise(
        async ({
          input,
          signal,
        }: {
          input: { objectiveId: string; taskId: string | null }
          signal: AbortSignal
        }) => {
          const row = loadObjective(deps.db, objectiveId)
          const spec = VerificationSpec.safeParse(row.verificationSpec)
          // An unresolved spec must not silently produce an empty — and so red,
          // but explicable-looking — set. Failing here routes to `paused` via
          // the invoke's onError, which is the honest outcome.
          if (!spec.success) {
            const message = 'No verification spec resolved for this objective'
            deps.bus.emit({ objectiveId, type: 'verification_unresolved', payload: { message } })
            throw new Error(message)
          }
          const result = await collectEvidence(deps, row, spec.data, {
            taskId: input.taskId,
            signal,
          })
          return { runId: result.runId }
        },
      ),
    },
    actions: {
      sendPrompt: ({ context }, params: { phase: string }) => {
        // Fire-and-forget: xstate actions are synchronous, and the turn's own
        // completion re-enters the machine later via `runner.send`.
        void sendPromptEffect(deps, objectiveId, runner, context, params.phase, gitGate)
      },

      checkpoint: ({ context }) => {
        const outcome = gitGate.enqueue(objectiveId, () =>
          checkpointEffect(deps, objectiveId, context, runner),
        )
        gitGate.pendingCheckpoint.set(objectiveId, outcome)
      },

      rollbackToCheckpoint: ({ context }) => {
        void gitGate.enqueue(objectiveId, () => rollbackEffect(deps, objectiveId, context, runner))
      },

      recordDecision: ({ event }) => {
        if (event.type !== 'DECISION_NEEDED') return
        try {
          const id = randomUUID()
          deps.db
            .insert(decisions)
            .values({
              id,
              objectiveId,
              question: event.event.question,
              options: event.event.options,
              recommendedId: event.event.recommendedId,
              chosenId: null,
              decidedAt: null,
              decidedBy: null,
              createdAt: new Date().toISOString(),
            })
            .run()
          // Carries the id so the UI (and `DECIDE`) can address this exact row.
          deps.bus.emit({ objectiveId, type: 'decision_recorded', payload: { id } })
        } catch (err) {
          deps.bus.emit({
            objectiveId,
            type: 'record_decision_failed',
            payload: { message: errorMessage(err) },
          })
        }
      },

      recordPlan: ({ context }) => {
        try {
          deps.db.transaction((tx) => {
            // Replace, not append: a re-planned objective must not accumulate
            // two generations of tasks.
            tx.delete(planTasks).where(eq(planTasks.objectiveId, objectiveId)).run()
            for (const task of context.tasks) {
              tx.insert(planTasks)
                .values({
                  id: task.id,
                  objectiveId,
                  ord: task.ord,
                  title: task.title,
                  description: task.description,
                  status: 'pending',
                  checkpointRef: null,
                  startedAt: null,
                  finishedAt: null,
                })
                .run()
            }
          })
        } catch (err) {
          const message = errorMessage(err)
          deps.bus.emit({ objectiveId, type: 'record_plan_failed', payload: { message } })
          // A plan the database refused is not a plan. Emitting and returning
          // let the machine walk on to `awaitingPlanApproval` and offer the
          // user an empty task list to approve — which is what shipped, and
          // what turned a `UNIQUE constraint failed` into a silently empty
          // plan. `TURN_FAILED` routes to `paused` with the reason attached,
          // the same way a failed checkpoint does.
          runner.send(objectiveId, { type: 'TURN_FAILED', reason: 'error', message })
        }
      },

      recordEvidence: ({ context, event }) => {
        if (event.type !== 'EVIDENCE') return
        try {
          const task = context.tasks[context.currentTaskIndex]
          // Amendment A6 narrows A5: a `check`-kind event naming a check the
          // spec actually declares carries the link the guard joins on. Every
          // other agent evidence stays unlinked — an unrecognised id is
          // ignored, never guessed at, so a check nothing claims stays unmet.
          const checks = context.verificationSpec
            ? normalizeChecks(context.verificationSpec).map((c) => c.id)
            : []
          const checkId =
            event.event.kind === 'check' &&
            event.event.checkId !== undefined &&
            checks.includes(event.event.checkId)
              ? event.event.checkId
              : null
          deps.db
            .insert(evidenceItems)
            .values({
              id: randomUUID(),
              objectiveId,
              taskId: task?.id ?? null,
              commandId: checkId,
              kind: event.event.kind,
              status: event.event.status,
              headline: event.event.headline,
              summary: event.event.summary,
              artifactPath: event.event.artifactPath ?? null,
              createdAt: new Date().toISOString(),
            })
            .run()
        } catch (err) {
          deps.bus.emit({
            objectiveId,
            type: 'record_evidence_failed',
            payload: { message: errorMessage(err) },
          })
        }
      },

      reconcileEvidence: ({ context }) => {
        try {
          runner.send(objectiveId, {
            type: 'EVIDENCE_RESULT',
            items: currentEvidence(deps.db, objectiveId, context),
          })
        } catch (err) {
          deps.bus.emit({
            objectiveId,
            type: 'reconcile_evidence_failed',
            payload: { message: errorMessage(err) },
          })
        }
      },

      finishObjective: (_, params: { action: 'commit' | 'keep' | 'discard' }) => {
        try {
          // The git mechanics live in `workflow/integrate.ts` and have already
          // run by the time this fires — the route does them between the
          // machine's guard check and the send. This action's whole job is the
          // durable record: what happened, and how.
          deps.db
            .update(objectives)
            .set({ integrateAction: params.action, updatedAt: new Date().toISOString() })
            .where(eq(objectives.id, objectiveId))
            .run()
          deps.bus.emit({
            objectiveId,
            type: 'objective_finished',
            payload: { action: params.action },
          })
          deps.db
            .update(planTasks)
            .set({ status: 'verified' })
            .where(eq(planTasks.objectiveId, objectiveId))
            .run()
        } catch (err) {
          deps.bus.emit({
            objectiveId,
            type: 'finish_objective_failed',
            payload: { message: errorMessage(err) },
          })
        }
      },
    },
  })
}

/**
 * `DECIDE` fills in `decisions.chosenId` — spec §5's `awaitingDecision` exit.
 * Not one of the machine's seven named actions (the `DECIDE` transition in
 * `workflow-machine.ts` only carries an `assign`), so `WorkflowRunner.send`
 * calls this directly before forwarding the event to the actor. Exported here
 * so every write to the `decisions` table stays in one file.
 */
export function recordDecisionChoice(
  db: Db,
  objectiveId: string,
  event: Extract<WorkflowEvent, { type: 'DECIDE' }>,
): void {
  // Scoped by objectiveId, not just the decision's own id: `decisionId` is
  // whatever a caller supplied, and a wrong one must update nothing rather
  // than a different objective's row.
  db.update(decisions)
    .set({ chosenId: event.optionId, decidedAt: new Date().toISOString(), decidedBy: 'user' })
    .where(and(eq(decisions.id, event.decisionId), eq(decisions.objectiveId, objectiveId)))
    .run()
}
