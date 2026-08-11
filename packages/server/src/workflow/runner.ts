import type { MachineStateName, VerificationSpec, WorkflowEvent } from '@vadd/core'
import { initialContext, TERMINAL_STATES, toMachineEvent, workflowMachine } from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { ActorRefFrom } from 'xstate'
import { createActor } from 'xstate'
import type { AgentRegistry } from '../agent/registry.js'
import type { ContractEmission } from '../contract/pipeline.js'
import type { Db } from '../db/client.js'
import { objectives } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { commitTransition } from './store.js'
import { runTurn, type TurnOutcome } from './turn.js'

type Deps = { db: Db; bus: EventBus; agents: AgentRegistry }
type ObjectiveRow = typeof objectives.$inferSelect
type WorkflowActor = ActorRefFrom<typeof workflowMachine>

/**
 * One XState actor per objective — the only component that talks to both the
 * contract pipeline (via `ingest`, wired from `AgentRegistry`'s
 * `onContractEmission` hook) and the machine.
 *
 * `sendPrompt` is bound here to the minimum needed to prove the turn wiring:
 * a phase name and `{title, goalText}`, enough to drive `explore`/`propose`/
 * `plan`/`review` turns end to end and exercise the `TURN_FINISHED` /
 * `TURN_FAILED` guard this task exists to get right. Task 8's `bindEffects`
 * supplies the real per-phase vars (`taskTitle`, `verificationCommands`, …)
 * and the six other effects (`checkpoint`, `recordPlan`, …) — when it lands,
 * `#bindMachine` is the one place that needs to start calling it instead.
 */
export class WorkflowRunner {
  readonly #db: Db
  readonly #bus: EventBus
  readonly #agents: AgentRegistry
  readonly #actors = new Map<string, WorkflowActor>()
  /**
   * The in-flight `runTurn()` promise per objective, keyed by object identity
   * (not turn id — `runTurn`'s turn id is only known once it resolves, and
   * this guard has to exist *before* that).
   *
   * `#runPhaseTurn`'s completion handler only sends `TURN_FINISHED` /
   * `TURN_FAILED` if it is still the promise on file when it settles.
   * `stop()` deletes the entry, so a turn that was in flight when the actor
   * was stopped — a user `CANCEL`, or a `stop()` ahead of a `resume()` on
   * reboot — cannot advance whatever actor later answers to the same
   * objective id once it eventually settles. This is the runner's equivalent
   * of the `entry.turnId` guard `AgentRegistry` already uses to stop a
   * settle and a cancel from both closing the same turn.
   */
  readonly #activeRun = new Map<string, Promise<TurnOutcome>>()

  constructor(deps: Deps) {
    this.#db = deps.db
    this.#bus = deps.bus
    this.#agents = deps.agents
  }

  /** Fresh actor from `idle`, for an objective with no prior snapshot. */
  start(objectiveId: string): WorkflowActor {
    const row = this.#objective(objectiveId)
    const machine = this.#bindMachine(objectiveId, row)
    const actor = createActor(machine, {
      input: initialContext({
        objectiveId: row.id,
        goalText: row.goalText,
        mode: row.mode,
        lowEnergy: row.lowEnergy,
        verificationSpec: row.verificationSpec as VerificationSpec | null,
      }),
    })
    // `null`: entering the initial state is itself the first transition this
    // objective has ever had, and test coverage requires it be persisted.
    this.#attach(objectiveId, actor, null)
    actor.start()
    return actor
  }

  /**
   * Rebuilds an actor from a persisted snapshot (design §10: "assert the
   * resumed state and that no duplicate side effect fires"). XState does not
   * re-run entry actions for a snapshot-resumed actor, so `sendPrompt` does
   * not fire again and no duplicate turn starts.
   */
  resume(objectiveId: string, snapshot: unknown): WorkflowActor {
    const row = this.#objective(objectiveId)
    const machine = this.#bindMachine(objectiveId, row)
    // xstate v5 types `input` as required on `ActorOptions` whenever the
    // machine's own input type isn't `undefined` (`RequiredActorOptionsKeys`
    // in createActor.d.ts), with no exemption for `snapshot` — even though at
    // runtime a resumed actor takes its context from the snapshot and never
    // touches `input` at all. `undefined as never` satisfies the type without
    // claiming a real value; same class of xstate v5 typing gap Task 3 hit
    // with `TS2883`/`GuardArgs`, just on `createActor` instead of `setup()`.
    const actor = createActor(machine, { snapshot: snapshot as never, input: undefined as never })
    // Seeded from the snapshot's own state, not `null`: `actor.start()` on a
    // resumed actor still notifies subscribers once, and without this seed
    // that first notification — reporting the *same* state the snapshot
    // already had — would read as a transition and write a redundant
    // snapshot/event row on every boot rehydration (Task 10 calls `resume`
    // for every non-terminal objective on every restart).
    const seed = String(actor.getSnapshot().value) as MachineStateName
    this.#attach(objectiveId, actor, seed)
    actor.start()
    return actor
  }

  get(objectiveId: string): WorkflowActor | undefined {
    return this.#actors.get(objectiveId)
  }

  /** Generic: user commands, `EVIDENCE_RESULT`, and the runner's own `TURN_*` sends all go through this. */
  send(objectiveId: string, event: WorkflowEvent): void {
    this.#actors.get(objectiveId)?.send(event)
  }

  stop(objectiveId: string): void {
    // Cleared unconditionally, not just when an actor is found: a turn can
    // still be in flight for an objective whose actor was already removed by
    // a prior `stop()` call (belt-and-braces — `#attach`'s TERMINAL_STATES
    // branch is the one call site that matters today).
    this.#activeRun.delete(objectiveId)
    const actor = this.#actors.get(objectiveId)
    if (!actor) return
    this.#actors.delete(objectiveId)
    actor.stop()
  }

  stopAll(): void {
    for (const objectiveId of [...this.#actors.keys()]) this.stop(objectiveId)
  }

  /**
   * `AgentRegistry`'s `onContractEmission` hook calls this for every pipeline
   * emission. `toMachineEvent()` from `@vadd/core` is the only translation
   * from contract vocabulary to machine vocabulary — reimplementing the
   * mapping here would let it drift from the one the exhaustive transition
   * test checks. A `kind: 'violation'` emission is already a visible row via
   * the registry's own `onEmit`; it is not a machine input, so it is dropped
   * rather than translated.
   */
  ingest(objectiveId: string, emission: ContractEmission): void {
    if (emission.kind !== 'event') return
    this.send(objectiveId, toMachineEvent(emission.event))
  }

  #objective(objectiveId: string): ObjectiveRow {
    const row = this.#db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()
    if (!row) throw new Error(`No objective row for ${objectiveId}`)
    return row
  }

  #bindMachine(objectiveId: string, row: ObjectiveRow) {
    return workflowMachine.provide({
      actions: {
        sendPrompt: (_, params: { phase: string }) => {
          // Fire-and-forget: xstate actions are synchronous, and the turn's
          // own completion re-enters the machine later via `send()`.
          void this.#runPhaseTurn(objectiveId, row, params.phase)
        },
      },
    })
  }

  /**
   * Fires one turn and, once `runTurn()`'s promise settles, sends exactly
   * one of `TURN_FINISHED` / `TURN_FAILED` back into the machine — guarded
   * by `#activeRun` so a stale completion cannot advance a different actor
   * than the one that opened it (see that field's comment).
   */
  async #runPhaseTurn(objectiveId: string, row: ObjectiveRow, phase: string): Promise<void> {
    const deps = { db: this.#db, bus: this.#bus, agents: this.#agents }
    const objective = {
      id: row.id,
      title: row.title,
      goalText: row.goalText,
      worktreePath: row.worktreePath,
    }

    let attempt: Promise<TurnOutcome>
    try {
      attempt = runTurn(deps, objective, {
        phase,
        vars: { title: row.title, goalText: row.goalText },
      })
    } catch {
      // `runTurn` can throw synchronously (`TurnRejected` — e.g. a turn
      // already in flight). The pipeline never opened a turn in that case,
      // so there is nothing to guard or report through the machine.
      return
    }

    this.#activeRun.set(objectiveId, attempt)
    const outcome = await attempt.catch(
      (err): TurnOutcome => ({
        ok: false,
        turnId: '',
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      }),
    )

    // Superseded: `stop()` cleared this slot (terminal transition, or a
    // stop() ahead of a resume()), or — not reachable today, but the guard
    // does not assume it never will be — a second turn overwrote it.
    if (this.#activeRun.get(objectiveId) !== attempt) return
    this.#activeRun.delete(objectiveId)

    if (outcome.ok) {
      this.send(objectiveId, { type: 'TURN_FINISHED' })
    } else {
      this.send(objectiveId, {
        type: 'TURN_FAILED',
        reason: outcome.reason,
        message: outcome.message,
      })
    }
  }

  #attach(objectiveId: string, actor: WorkflowActor, seed: MachineStateName | null): void {
    this.#actors.set(objectiveId, actor)
    let last: MachineStateName | null = seed
    actor.subscribe((snap) => {
      const state = String(snap.value) as MachineStateName
      // An assign-only event (a `status` arriving mid-turn, root-level
      // FAILURE, a CLARIFICATION that doesn't leave `exploring`, …) fires
      // this callback without changing `state.value` — not a transition, so
      // no snapshot/event row.
      if (state === last) return
      const from = last
      last = state
      commitTransition(
        { db: this.#db, bus: this.#bus },
        {
          objectiveId,
          state,
          // `getPersistedSnapshot()`, never `getSnapshot()`: only the
          // persisted form round-trips through `createActor(machine,
          // { snapshot })` in `resume()` (and Task 10's boot rehydration).
          snapshot: actor.getPersistedSnapshot(),
          event: { type: 'state_changed', payload: { to: state, from } },
        },
      )
      if ((TERMINAL_STATES as readonly string[]).includes(state)) this.stop(objectiveId)
    })
  }
}
