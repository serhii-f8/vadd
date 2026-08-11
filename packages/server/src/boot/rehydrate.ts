import type { MachineStateName } from '@vadd/core'
import { TERMINAL_STATES } from '@vadd/core'
import type { Db } from '../db/client.js'
import { objectives } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { errorMessage } from '../http/routes/objectives.js'
import type { WorkflowRunner } from '../workflow/runner.js'
import { loadSnapshot } from '../workflow/store.js'

/**
 * The three states whose entry action opens a turn. A snapshot sitting in one
 * of them means the server died with a prompt in flight: the worktree may hold
 * partial edits, and the turn's side effects are unknown.
 */
const MID_TURN_STATES: readonly MachineStateName[] = ['executing', 'verifying', 'revising']

export type RehydrateResult = { resumed: number; pausedAfterCrash: number }

/**
 * Design §6.5/§6.6. Runs after `reconcileOnBoot`, which has already deleted the
 * `creating` remnants and orphaned the previous process's agent sessions.
 *
 * **Crash mid-turn is not auto-retried.** An objective whose snapshot sits in
 * `executing`, `verifying` or `revising` resumes into `paused` with a
 * `resumed_after_crash` event, keeping its `resumeState` so the Focus View can
 * later offer continue or roll back. Re-sending the interrupted prompt would
 * be a guess about work that may already be half-done on disk.
 *
 * The agent is deliberately **not** re-established here. Spec §5 sanctions
 * resuming via ACP `session/load` where the adapter supports it, but
 * `AgentRegistry.ensure()` already starts a session lazily on the next turn,
 * and doing it at boot would spawn one adapter child per open objective before
 * anyone has asked for one. Either way the prior transcript is never replayed
 * into a new session — it is retained for the Level-3 view only.
 */
export async function rehydrateOnBoot(deps: {
  db: Db
  bus: EventBus
  runner: WorkflowRunner
}): Promise<RehydrateResult> {
  const { db, bus, runner } = deps
  const result: RehydrateResult = { resumed: 0, pausedAfterCrash: 0 }

  const open = db
    .select()
    .from(objectives)
    .all()
    .filter(
      (o) =>
        // `creating` belongs to `reconcileOnBoot`, which deletes those rows —
        // it is not a machine state and has no snapshot to resume from.
        o.status !== 'creating' && !(TERMINAL_STATES as readonly string[]).includes(o.status),
    )

  for (const objective of open) {
    const snapshot = loadSnapshot(db, objective.id)
    if (snapshot === null) {
      // Only reachable if someone edited the database, but silence would leave
      // an objective that looks live and cannot be driven, with nothing on the
      // record saying why.
      bus.emit({
        objectiveId: objective.id,
        type: 'rehydrate_skipped',
        payload: { status: objective.status, reason: 'no machine_snapshots row' },
      })
      continue
    }

    let state: MachineStateName
    try {
      const actor = runner.resume(objective.id, snapshot)
      state = String(actor.getSnapshot().value) as MachineStateName
    } catch (err) {
      // One unreadable snapshot must not leave every other objective dead.
      bus.emit({
        objectiveId: objective.id,
        type: 'rehydrate_failed',
        payload: { status: objective.status, message: errorMessage(err) },
      })
      continue
    }

    result.resumed += 1

    if (MID_TURN_STATES.includes(state)) {
      bus.emit({
        objectiveId: objective.id,
        type: 'resumed_after_crash',
        payload: { state },
      })
      // Routed through the machine's own TURN_FAILED rather than forcing the
      // state: that is what records `lastFailure` and stamps `resumeState`,
      // and it keeps "how an objective reaches paused" in one place.
      runner.send(objective.id, {
        type: 'TURN_FAILED',
        reason: 'agent_crash',
        message: 'Server restarted mid-turn',
      })
      result.pausedAfterCrash += 1
    }
  }

  bus.emit({ type: 'boot_rehydrated', payload: result })
  return result
}
