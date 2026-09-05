import { randomUUID } from 'node:crypto'
import type { AgentEvent, MachineStateName, VerificationSpec, WorkflowEvent } from '@vadd/core'
import {
  initialContext,
  MACHINE_STATES,
  TERMINAL_STATES,
  toMachineEvent,
  type workflowMachine,
} from '@vadd/core'
import { and, eq } from 'drizzle-orm'
import type { ActorRefFrom } from 'xstate'
import { createActor } from 'xstate'
import type { AgentRegistry } from '../agent/registry.js'
import type { ContractEmission } from '../contract/pipeline.js'
import type { Db } from '../db/client.js'
import { objectives, projectMemory } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { recordArtifact } from './artifacts.js'
import { bindEffects, recordDecisionChoice } from './effects.js'
import { commitTransition } from './store.js'
import { cancelOpenTurn } from './turn.js'

type Deps = { db: Db; bus: EventBus; agents: AgentRegistry }
type ObjectiveRow = typeof objectives.$inferSelect
type WorkflowActor = ActorRefFrom<typeof workflowMachine>

/** Marks every action `bindEffects` bound for one particular actor build as stale. */
type BindingToken = { cancelled: boolean }

/**
 * Rejects anything that is not a persisted snapshot of *this* machine.
 *
 * `value` naming one of spec §5's states is the cheapest check that separates a
 * real `getPersistedSnapshot()` payload from a hand-edited row, a snapshot of
 * some other machine, or a truncated write.
 */
function assertRestorable(objectiveId: string, snapshot: unknown): void {
  const value = (snapshot as { value?: unknown } | null)?.value
  if (typeof value !== 'string' || !(MACHINE_STATES as readonly string[]).includes(value)) {
    throw new Error(
      `Unrestorable snapshot for ${objectiveId}: value ${JSON.stringify(value)} is not a machine state`,
    )
  }
}

/**
 * One XState actor per objective — the only component that talks to both the
 * contract pipeline (via `ingest`, wired from `AgentRegistry`'s
 * `onContractEmission` hook) and the machine.
 *
 * `#bindMachine` supplies `bindEffects()` (Task 8) with a `send` that is
 * itself guarded by a `BindingToken` (see `#tokens`) rather than passing
 * `this.send` directly: `bindEffects`'s actions are async (turns, checkpoints,
 * git resets), and a `stop()` followed by a `resume()` rebuilds the actor —
 * and calls `#bindMachine` again — while one of the old binding's turns can
 * still be in flight. Without the token, that stale turn's eventual
 * `TURN_FINISHED`/`TURN_FAILED` would land on `this.send`, which resolves
 * `objectiveId` to whatever actor is *currently* registered — the *new* one —
 * and would advance it on behalf of a turn it never asked for.
 */
export class WorkflowRunner {
  readonly #db: Db
  readonly #bus: EventBus
  readonly #agents: AgentRegistry
  readonly #actors = new Map<string, WorkflowActor>()
  /** The live `BindingToken` per objective — see the class doc comment. */
  readonly #tokens = new Map<string, BindingToken>()

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
   *
   * Throws on a snapshot the machine cannot restore, rather than letting one
   * through: `createActor` does **not** reject an unrecognised object. It
   * returns an actor whose state value is `undefined` and then throws from
   * xstate's own scheduler *asynchronously*, outside any caller's try/catch —
   * an uncaught exception that can take the process down, on an actor that
   * already looked like it had resumed. Refusing up front keeps the failure
   * synchronous, attributable, and catchable by boot rehydration.
   */
  resume(objectiveId: string, snapshot: unknown): WorkflowActor {
    assertRestorable(objectiveId, snapshot)
    const row = this.#objective(objectiveId)
    const machine = this.#bindMachine(objectiveId, row)
    // `objectives.lowEnergy` can change without a state transition
    // (SET_LOW_ENERGY is context-only, amendment A12), so the persisted
    // snapshot's own copy of it can be stale by the time of a restart. The
    // row is the source of truth here, the same way `start()`'s
    // `initialContext` already treats it for a fresh actor.
    const resumable = snapshot as {
      context?: { lowEnergy?: boolean; clarifications?: unknown[] }
    }
    if (resumable.context) {
      resumable.context.lowEnergy = row.lowEnergy
      // Snapshots written before `clarifications` existed restore without
      // it; an `assign` spreading `undefined` would then throw mid-turn.
      resumable.context.clarifications ??= []
    }
    // xstate v5 types `input` as required on `ActorOptions` whenever the
    // machine's own input type isn't `undefined` (`RequiredActorOptionsKeys`
    // in createActor.d.ts), with no exemption for `snapshot` — even though at
    // runtime a resumed actor takes its context from the snapshot and never
    // touches `input` at all. `undefined as never` satisfies the type without
    // claiming a real value; same class of xstate v5 typing gap Task 3 hit
    // with `TS2883`/`GuardArgs`, just on `createActor` instead of `setup()`.
    const actor = createActor(machine, { snapshot: resumable as never, input: undefined as never })
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

  /**
   * Generic: user commands, `EVIDENCE_RESULT`, and the runner's own `TURN_*`
   * sends all go through this.
   *
   * `DECIDE` is special-cased: spec §5's `awaitingDecision` exit fills in
   * `decisions.chosenId`, but the machine's own `DECIDE` transition carries
   * only an `assign` — no named action bindEffects could hook — so the write
   * happens here, before the event reaches the actor. See
   * `effects.ts`'s `recordDecisionChoice` doc comment for why.
   */
  send(objectiveId: string, event: WorkflowEvent): void {
    if (event.type === 'DECIDE') recordDecisionChoice(this.#db, objectiveId, event)
    this.#actors.get(objectiveId)?.send(event)
  }

  stop(objectiveId: string): void {
    // Cleared unconditionally, not just when an actor is found: a turn can
    // still be in flight for an objective whose actor was already removed by
    // a prior `stop()` call (belt-and-braces — `#attach`'s TERMINAL_STATES
    // branch is the one call site that matters today).
    const token = this.#tokens.get(objectiveId)
    if (token) token.cancelled = true
    this.#tokens.delete(objectiveId)
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
    // A memory_note is project-scoped metadata, not a phase-transition signal
    // — the machine has no concept of it and none of the 7 existing
    // AgentEvent→WorkflowEvent mappings cover it. toMachineEvent's lookup
    // would silently return `{ type: undefined, event }` for an unmapped
    // type (no exhaustiveness check exists on that lookup object), so this
    // interception has to happen before toMachineEvent is ever called, not
    // rely on the machine ignoring an unrecognized event type gracefully.
    if (emission.event.type === 'memory_note') {
      this.#recordMemoryNote(objectiveId, emission.event)
      return
    }
    // An artifact is design material for the pending decision or plan, not a
    // phase-transition signal — intercepted before `toMachineEvent` exactly
    // like `memory_note`, and `toMachineEvent`'s parameter type excludes it so
    // this branch cannot silently go missing. The state recorded is the live
    // actor's; a late emission with no actor (after `stop()`) falls back to
    // the row's status rather than being dropped.
    if (emission.event.type === 'artifact') {
      const actor = this.#actors.get(objectiveId)
      const row = this.#db
        .select({ status: objectives.status })
        .from(objectives)
        .where(eq(objectives.id, objectiveId))
        .get()
      if (!row) return
      const state = actor ? String(actor.getSnapshot().value) : row.status
      recordArtifact(this.#db, objectiveId, state, emission.event)
      return
    }
    this.send(objectiveId, toMachineEvent(emission.event))
  }

  #recordMemoryNote(
    objectiveId: string,
    event: Extract<AgentEvent, { type: 'memory_note' }>,
  ): void {
    const objective = this.#db
      .select({ projectId: objectives.projectId })
      .from(objectives)
      .where(eq(objectives.id, objectiveId))
      .get()
    if (!objective) return
    const now = new Date().toISOString()
    // Same project, same kind, same headline: the agent re-learned a fact it
    // (or a predecessor) already recorded. Refresh that row — newest content,
    // newest timestamp, so it stays inside the five-per-kind injection window
    // — rather than adding a twin that would crowd a different fact out of
    // `buildProjectMemoryPromptBlock`'s cap. A22's design listed
    // deduplication as out of its own scope, not as undesirable.
    const existing = this.#db
      .select({ id: projectMemory.id })
      .from(projectMemory)
      .where(
        and(
          eq(projectMemory.projectId, objective.projectId),
          eq(projectMemory.kind, event.kind),
          eq(projectMemory.headline, event.headline),
        ),
      )
      .get()
    if (existing) {
      this.#db
        .update(projectMemory)
        .set({ content: event.content, sourceObjectiveId: objectiveId, createdAt: now })
        .where(eq(projectMemory.id, existing.id))
        .run()
      return
    }
    this.#db
      .insert(projectMemory)
      .values({
        id: randomUUID(),
        projectId: objective.projectId,
        kind: event.kind,
        headline: event.headline,
        content: event.content,
        sourceObjectiveId: objectiveId,
        createdAt: now,
      })
      .run()
  }

  #objective(objectiveId: string): ObjectiveRow {
    const row = this.#db.select().from(objectives).where(eq(objectives.id, objectiveId)).get()
    if (!row) throw new Error(`No objective row for ${objectiveId}`)
    return row
  }

  /**
   * Builds a fresh `BindingToken` for this actor and hands `bindEffects` a
   * `send` wrapped to check it — see the class doc comment. The prior
   * token (if any) is cancelled here unconditionally, not only from `stop()`:
   * `resume()` can rebuild an actor without an intervening `stop()` call, and
   * a stale binding must not survive whichever call happens to be the one
   * that creates its replacement.
   */
  #bindMachine(objectiveId: string, row: ObjectiveRow) {
    const prior = this.#tokens.get(objectiveId)
    if (prior) prior.cancelled = true
    const token: BindingToken = { cancelled: false }
    this.#tokens.set(objectiveId, token)

    return bindEffects({ db: this.#db, bus: this.#bus, agents: this.#agents }, row, {
      send: (id, event) => {
        if (token.cancelled) return
        this.send(id, event)
      },
    })
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
      // Pausing has to stop the turn, not just the machine. Without this,
      // `PAUSE` left the agent working, and `RESUME` re-entered a state whose
      // entry sends a prompt — which `runTurn` refused with "A turn is already
      // in flight", failing the turn and bouncing the objective straight back
      // to `paused`. Pause was therefore unusable in exactly the situation it
      // exists for: something is running and the user wants it to stop.
      //
      // Safe on the other two routes into `paused` (a failed turn, a red
      // evidence set): both arrive with the turn already closed, and
      // `cancelOpenTurn` is a no-op then.
      if (state === 'paused') {
        void cancelOpenTurn({ db: this.#db, bus: this.#bus, agents: this.#agents }, objectiveId)
      }
      if ((TERMINAL_STATES as readonly string[]).includes(state)) this.stop(objectiveId)
    })
  }
}
