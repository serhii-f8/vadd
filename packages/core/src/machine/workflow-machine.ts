import { assign, enqueueActions, fromPromise, setup } from 'xstate'
// Workaround for a known xstate v5 typing issue (statelyai/xstate#5090): a
// custom guard's inferred type references xstate's internal, unexported
// `GuardArgs`, which TypeScript's declaration-emit portability check (TS2883)
// then refuses to name for this exported machine. Importing the module that
// declares it makes the type reachable/nameable; nothing from this import is
// used at runtime.
import 'xstate/guards'
import { fastFixPlanLooksSimple } from '../policies/fast-fix-plan.js'
import type { VerificationSpec } from '../schemas/verification.js'
import { evidenceComplete, isFastFix as isFastFixGuard } from './guards.js'
import {
  type MachineStateName,
  type PlanTaskLike,
  planTaskId,
  type WorkflowContext,
  type WorkflowEvent,
} from './types.js'

export type WorkflowInput = {
  objectiveId: string
  goalText: string
  mode: 'standard' | 'fastfix' | 'investigation'
  lowEnergy: boolean
  verificationSpec: VerificationSpec | null
  /** Set when rehydrating an objective whose plan is already in the DB. */
  tasks?: PlanTaskLike[]
}

export function initialContext(input: WorkflowInput): WorkflowContext {
  return {
    objectiveId: input.objectiveId,
    mode: input.mode,
    lowEnergy: input.lowEnergy,
    goalText: input.goalText,
    verificationSpec: input.verificationSpec,
    tasks: input.tasks ?? [],
    currentTaskIndex: 0,
    evidence: [],
    verificationRunId: null,
    verificationEpoch: null,
    taskRisk: null,
    approvals: [],
    pendingDecisionId: null,
    pendingClarification: null,
    turnEvents: [],
    lastFailure: null,
    resumeState: null,
    reviseInstruction: null,
  }
}

/**
 * The transition table. Spec §5's states verbatim; every side effect is *named*
 * here and implemented by the server with `.provide()` (design §6.1), so `core`
 * stays I/O-free and the table is unit-testable with every effect stubbed.
 */
export const workflowMachine = setup({
  types: {
    context: {} as WorkflowContext,
    events: {} as WorkflowEvent,
    input: {} as WorkflowContext,
  },
  guards: {
    isFastFix: ({ context }) => isFastFixGuard(context),
    sawClarification: ({ context }) => context.turnEvents.includes('clarification'),
    sawDecision: ({ context }) => context.turnEvents.includes('decision_needed'),
    sawPlan: ({ context }) => context.turnEvents.includes('plan'),
    sawFailure: ({ context }) => context.turnEvents.includes('failure'),
    /**
     * Re-evaluated at the moment of each transition that reads it — including
     * `integrating → done`, which spec §5 requires be unreachable without a
     * full green set. Never cache this into context.
     *
     * `verifying`'s `EVIDENCE_RESULT` transition carries this guard *and* the
     * context-updating assign on the same transition, so the guard cannot rely
     * on `context.evidence` there — XState evaluates a transition's guard
     * against the snapshot before that transition's own actions run, and
     * `context.evidence` is reset to `[]` on every `executing` entry. Reading
     * `event.items` when the event is `EVIDENCE_RESULT` gives the guard the
     * freshest data; `integrating`'s `INTEGRATE` guard still reads
     * `context.evidence`, which a *prior*, separate `EVIDENCE_RESULT`
     * transition already assigned.
     */
    evidenceComplete: ({ context, event }) =>
      evidenceComplete(
        context.verificationSpec,
        event.type === 'EVIDENCE_RESULT' ? event.items : context.evidence,
        // Amendment A11: the exemption applies only to the per-task check this
        // guard backs when it fires from `verifying`'s own `EVIDENCE_RESULT`.
        // `integrating`'s `INTEGRATE` uses this exact same named guard and must
        // stay strict — passing nothing here for that case is what keeps a
        // plan's last task from reaching `done` on a declared-but-unproven red.
        event.type === 'EVIDENCE_RESULT'
          ? (context.tasks[context.currentTaskIndex]?.expectFailing ?? [])
          : [],
      ),
    hasMoreTasks: ({ context }) => context.currentTaskIndex < context.tasks.length - 1,
    // Task 8's `rollbackToCheckpoint` is the real gate on a missing checkpoint
    // — a null `checkpointRef` there resolves to `rollback_unavailable` + pause.
    // This guard only needs to rule out rolling back when there's no current
    // task at all (e.g. paused from `exploring`/`proposing`/`planning`, before
    // any plan exists); it does not duplicate Task 8's null-ref check.
    hasCheckpoint: ({ context }) => context.tasks[context.currentTaskIndex] != null,
    /** Design §6.2: with no checks there is no agent turn in `verifying` at all. */
    hasChecks: ({ context }) => (context.verificationSpec?.verify.checks.length ?? 0) > 0,
  },
  actors: {
    /**
     * EvidenceCollector. Named here and implemented by the server (design
     * §6.1), like every other effect. The stub throws rather than resolving:
     * an unprovided collector must fail loudly, never report an empty — and
     * therefore red — evidence set that looks like a real verdict.
     */
    runVerification: fromPromise<
      { runId: string; taskRisk: 'low' | 'high' },
      { objectiveId: string; taskId: string | null }
    >(async () => {
      throw new Error('runVerification is not implemented in core')
    }),
  },
  actions: {
    /**
     * Every non-`paused`, non-final state stamps its own name into context on
     * entry, so `paused` always has a return address.
     *
     * An `assign` inside a transition cannot read the state it is leaving, and
     * `paused` is entered from three different places — a user `PAUSE`, a
     * `TURN_FAILED`, and a red evidence set. Stamping on entry gives all three
     * the same answer for free, and rehydration gets a readable "where was it"
     * without deserialising the snapshot's state value.
     *
     * Declared here (a named, params-based action) rather than as a
     * freestanding `assign<...>()` const referenced by identity: a shared
     * assign helper called from many differently-narrowed `on:`/`entry:`
     * positions needs an explicit `TExpressionEvent` generic to satisfy
     * `pnpm typecheck` under this repo's `noUncheckedIndexedAccess` +
     * `composite`/`declaration` settings, and that specific combination makes
     * the exported `workflowMachine`'s inferred type unnameable for
     * declaration emit (`TS2883`, referencing xstate's internal `GuardArgs`).
     * Defining the action inside `setup()`'s own map lets xstate's macro-level
     * inference wire the event type per call site instead.
     */
    enter: assign({
      resumeState: (_, params: { name: MachineStateName }) => params.name,
    }),
    /** Same rationale as `enter` above — kept alongside it for the same reason. */
    noteTurnEvent: assign({
      turnEvents: ({ context, event }) =>
        'event' in event ? [...context.turnEvents, event.event.type] : context.turnEvents,
    }),
    clearTurn: assign({ turnEvents: () => [] }),
    // Every one of these is a no-op here and bound for real by the server.
    // `setup()` needs an implementation to type the name; design §6.1 requires
    // that the implementation in `core` do nothing.
    sendPrompt: (_, _params: { phase: string }) => {},
    checkpoint: () => {},
    rollbackToCheckpoint: () => {},
    recordDecision: () => {},
    recordPlan: () => {},
    recordEvidence: () => {},
    reconcileEvidence: () => {},
    finishObjective: (_, _params: { action: 'commit' | 'keep' | 'discard' }) => {},
    noteToleratedFailures: () => {},
    markTaskVerified: () => {},
    // Amendment A12. Real implementation in `effects.ts` (Task 7): emits
    // `task_auto_approved` / `plan_auto_approved` on the event log, which
    // `GET /api/objectives/:id` reads back as `lastAutoApproval` for the UI.
    // These stay named + `.provide()`-able, unlike the two auto-approve
    // decisions themselves — see the comment on `autoApproveTaskIfLowRisk`
    // below for why those are inline rather than living in this map.
    noteAutoApprovedTask: () => {},
    noteAutoApprovedPlan: () => {},
  },
}).createMachine({
  id: 'workflow',
  context: ({ input }) => input,
  initial: 'idle',
  // PAUSE and CANCEL are legal from every non-final state, so they live at the
  // root rather than being repeated seventeen times. A child state that needs
  // different behaviour overrides them locally.
  on: {
    // `resumeState` is already correct — every state stamped it on entry.
    PAUSE: '.paused',
    CANCEL: '.cancelled',
    /**
     * Amendment A12. Context-only: no target, so `WorkflowRunner`'s subscribe
     * callback sees no state-value change and persists no snapshot row here —
     * `resume()` re-syncs this field from `objectives.lowEnergy` on every
     * restart instead, the same way `start()`'s `initialContext` already
     * seeds a fresh actor from it.
     */
    SET_LOW_ENERGY: {
      actions: assign({
        lowEnergy: ({ context, event }) =>
          event.type === 'SET_LOW_ENERGY' ? event.value : context.lowEnergy,
      }),
    },
    // Agent events accumulate into context wherever they arrive. A `status` in
    // `verifying` is not a transition, it is progress — see design §4.2.
    STATUS: { actions: 'noteTurnEvent' },
    FAILURE: {
      actions: [
        'noteTurnEvent',
        assign({
          lastFailure: ({ event }) =>
            event.type === 'FAILURE'
              ? { headline: event.event.headline, probableCause: event.event.probableCause }
              : null,
        }),
      ],
    },
    // A crashed or wedged turn is recoverable work, not a dead objective
    // (design §9): it pauses, and the Focus View offers continue or roll back.
    TURN_FAILED: {
      target: '.paused',
      actions: assign({
        lastFailure: ({ event }) =>
          event.type === 'TURN_FAILED'
            ? { headline: `Turn ${event.reason}`, probableCause: event.message }
            : null,
      }),
    },
  },
  states: {
    idle: {
      entry: { type: 'enter', params: { name: 'idle' } },
      on: { START: 'exploring' },
    },

    exploring: {
      entry: [
        { type: 'enter', params: { name: 'exploring' } },
        'clearTurn',
        { type: 'sendPrompt', params: { phase: 'explore' } },
      ],
      on: {
        CLARIFICATION: {
          actions: [
            'noteTurnEvent',
            assign({
              pendingClarification: ({ event }) =>
                event.type === 'CLARIFICATION' ? event.event.question : null,
            }),
          ],
        },
        TURN_FINISHED: [
          { guard: 'sawClarification', target: 'clarifying' },
          { guard: 'isFastFix', target: 'planning' },
          { target: 'proposing' },
        ],
      },
    },

    clarifying: {
      entry: { type: 'enter', params: { name: 'clarifying' } },
      on: {
        ANSWER_CLARIFICATION: {
          target: 'exploring',
          actions: assign({ pendingClarification: () => null }),
        },
      },
    },

    proposing: {
      entry: [
        { type: 'enter', params: { name: 'proposing' } },
        'clearTurn',
        { type: 'sendPrompt', params: { phase: 'propose' } },
      ],
      on: {
        DECISION_NEEDED: { actions: ['noteTurnEvent', { type: 'recordDecision' }] },
        TURN_FINISHED: [
          {
            guard: 'sawDecision',
            target: 'awaitingDecision',
            // A REVISE-triggered re-propose set this; a fresh proposal from
            // exploring never did, so clearing it here is always correct
            // rather than only sometimes a no-op (mirrors `planning`'s own
            // TURN_FINISHED clear).
            actions: assign({ reviseInstruction: () => null }),
          },
          // A propose turn that produced no decision is not a failure — it is a
          // turn that owes one. Pause rather than guess, so the user can
          // re-prompt or decide directly.
          { target: 'paused', actions: assign({ reviseInstruction: () => null }) },
        ],
      },
    },

    awaitingDecision: {
      entry: { type: 'enter', params: { name: 'awaitingDecision' } },
      on: {
        DECIDE: {
          target: 'planning',
          actions: assign({
            pendingDecisionId: ({ event }) => (event.type === 'DECIDE' ? event.decisionId : null),
          }),
        },
        // Mirrors amendment A10's `awaitingPlanApproval` REVISE: "the options
        // are wrong, think again" is cheapest right here, before any plan
        // exists. Re-enters `proposing`, whose entry sends the `propose`
        // phase prompt again.
        REVISE: {
          target: 'proposing',
          actions: assign({
            reviseInstruction: ({ event }) => (event.type === 'REVISE' ? event.instruction : null),
          }),
        },
      },
    },

    planning: {
      entry: [
        { type: 'enter', params: { name: 'planning' } },
        'clearTurn',
        { type: 'sendPrompt', params: { phase: 'plan' } },
      ],
      on: {
        PLAN: {
          actions: [
            'noteTurnEvent',
            assign({
              // `planTaskId`, never the bare ordinal: `plan_tasks.id` is a
              // global primary key, so positional ids collided across
              // objectives (see `planTaskId`'s comment).
              tasks: ({ context, event }) =>
                event.type === 'PLAN'
                  ? event.event.tasks.map((t, ord) => ({
                      id: planTaskId(context.objectiveId, ord),
                      ord,
                      title: t.title,
                      description: t.description,
                      checkpointRef: null,
                      expectFailing: t.expectFailing,
                    }))
                  : [],
            }),
            { type: 'recordPlan' },
          ],
        },
        TURN_FINISHED: [
          {
            guard: 'sawPlan',
            target: 'awaitingPlanApproval',
            // Amendment A10: a REVISE-triggered re-plan set this; a fresh
            // plan from awaitingDecision never did, so clearing it here is
            // always correct rather than only sometimes a no-op.
            actions: assign({ reviseInstruction: () => null }),
          },
          { target: 'paused', actions: assign({ reviseInstruction: () => null }) },
        ],
      },
    },

    awaitingPlanApproval: {
      entry: [
        { type: 'enter', params: { name: 'awaitingPlanApproval' } },
        /**
         * Amendment A12. Dispatches the exact event a human's click would
         * send — `APPROVE_PLAN`'s existing handler runs unmodified.
         * `enqueue.raise` processes synchronously within the same macrostep
         * that entered this state, so a snapshot-mirroring frontend never
         * renders `awaitingPlanApproval` here; `noteAutoApprovedPlan` is how
         * the fact still reaches the UI.
         *
         * Deliberately *inline* rather than a named entry in `setup()`'s
         * `actions:` map (statelyai/xstate#4820, confirmed upstream and
         * still open on 5.20.1, independently reproduced twice against the
         * real installed `xstate@5.20.1`): any `enqueueActions(...)` value
         * appearing as a named entry in `setup()`'s `actions:` map fails
         * with `TS2719` — regardless of whether it references a sibling
         * action, since even a raise-only `enqueueActions` with no
         * `enqueue(...)` call to another action fails identically — and
         * every other named action's `params` type widens to `unknown`,
         * breaking `enter`'s `params: { name: MachineStateName }` a few
         * lines above. That's why the workaround below is unconditional —
         * declared inline at both entry sites rather than only when a
         * sibling reference is present. Declaring the `enqueueActions(...)`
         * call inline at the entry site — as xstate's own maintainers
         * recommend as the workaround — sidesteps the failure entirely
         * while `enqueue({ type: 'noteAutoApprovedPlan' })` still resolves
         * through the *named*, `.provide()`-able action below, so Task 7
         * can bind a real effect server-side exactly as it would for any
         * other named action. Neither this action nor
         * `autoApproveTaskIfLowRisk` in `awaitingReview` below is itself
         * named or provided — the decision is pure domain logic, same as
         * `evidenceComplete` and every other guard, and never needs a
         * server-side override.
         */
        enqueueActions(({ context, enqueue }) => {
          if (isFastFixGuard(context) && fastFixPlanLooksSimple(context.tasks)) {
            enqueue({ type: 'noteAutoApprovedPlan' })
            enqueue.raise({ type: 'APPROVE_PLAN' })
          }
        }),
      ],
      on: {
        APPROVE_PLAN: {
          target: 'executing',
          actions: [
            assign({
              approvals: ({ context }) => [...context.approvals, 'plan'],
              tasks: ({ context, event }) =>
                event.type === 'APPROVE_PLAN' && event.tasks ? event.tasks : context.tasks,
              currentTaskIndex: () => 0,
            }),
            // Amendment A10: an edited list must reach `plan_tasks`, not just
            // context — the stored plan otherwise diverges from the one the
            // machine executes.
            { type: 'recordPlan' },
          ],
        },
        // Amendment A10: "the plan is wrong, think again" is cheapest right
        // here, before any work starts. Re-enters `planning`, whose entry
        // sends the `plan` phase prompt again.
        REVISE: {
          target: 'planning',
          actions: assign({
            reviseInstruction: ({ event }) => (event.type === 'REVISE' ? event.instruction : null),
          }),
        },
      },
    },

    executing: {
      // Spec §5: a `vadd-checkpoint:` commit before every `executing` entry, so
      // `rollingBack` always has somewhere to land.
      entry: [
        { type: 'enter', params: { name: 'executing' } },
        'clearTurn',
        assign({
          evidence: () => [],
          // New work invalidates the previous verification generation: command
          // rows and check rows alike (design §5.4).
          verificationRunId: () => null,
          verificationEpoch: () => new Date().toISOString(),
          taskRisk: () => null,
        }),
        { type: 'checkpoint' },
        {
          type: 'sendPrompt',
          params: ({ context }) => ({
            phase: context.mode === 'investigation' ? 'execute-task-investigation' : 'execute-task',
          }),
        },
      ],
      on: {
        TASK_RESULT: { actions: 'noteTurnEvent' },
        EVIDENCE: { actions: ['noteTurnEvent', { type: 'recordEvidence' }] },
        TURN_FINISHED: [{ guard: 'sawFailure', target: 'paused' }, { target: 'verifying' }],
      },
    },

    verifying: {
      entry: [{ type: 'enter', params: { name: 'verifying' } }, 'clearTurn'],
      // An invoked actor rather than an entry action, so a `PAUSE` — which
      // leaves this state — aborts a running suite through the signal xstate
      // hands the actor, instead of leaving `phpunit` running unattended.
      invoke: {
        src: 'runVerification',
        input: ({ context }) => ({
          objectiveId: context.objectiveId,
          // The collector stamps this on every row; the Evidence Panel groups
          // by it. `fromPromise` sees only `input`, never context.
          taskId: context.tasks[context.currentTaskIndex]?.id ?? null,
        }),
        onDone: [
          {
            guard: 'hasChecks',
            actions: [
              assign({
                verificationRunId: ({ event }) => event.output.runId,
                taskRisk: ({ event }) => event.output.taskRisk,
              }),
              // Commands are VADD's now; the agent is asked only for the one
              // thing a command cannot produce — a judgement on the checks.
              { type: 'sendPrompt', params: { phase: 'verify' } },
            ],
          },
          {
            actions: [
              assign({
                verificationRunId: ({ event }) => event.output.runId,
                taskRisk: ({ event }) => event.output.taskRisk,
              }),
              'reconcileEvidence',
            ],
          },
        ],
        onError: {
          target: 'paused',
          actions: assign({
            lastFailure: () => ({
              headline: 'Verification could not run',
              probableCause: 'EvidenceCollector failed before producing any evidence',
            }),
          }),
        },
      },
      on: {
        EVIDENCE: { actions: ['noteTurnEvent', { type: 'recordEvidence' }] },
        // The turn closing is not the verdict — the reconciled evidence set is.
        TURN_FINISHED: { actions: 'reconcileEvidence' },
        EVIDENCE_RESULT: [
          {
            guard: 'evidenceComplete',
            target: 'awaitingReview',
            actions: [
              assign({
                evidence: ({ event }) => (event.type === 'EVIDENCE_RESULT' ? event.items : []),
              }),
              { type: 'noteToleratedFailures' },
            ],
          },
          {
            // Spec §5 forbids a red set from entering awaitingReview. `paused`
            // offers the same two exits — REVISE and ROLLBACK — without
            // weakening the guard.
            target: 'paused',
            actions: assign({
              evidence: ({ event }) => (event.type === 'EVIDENCE_RESULT' ? event.items : []),
            }),
          },
        ],
      },
    },

    awaitingReview: {
      entry: [
        { type: 'enter', params: { name: 'awaitingReview' } },
        /** Amendment A12. Same pattern and rationale as `awaitingPlanApproval`'s inline `enqueueActions` above. */
        enqueueActions(({ context, enqueue }) => {
          if (context.lowEnergy && context.taskRisk === 'low') {
            enqueue({ type: 'noteAutoApprovedTask' })
            enqueue.raise({ type: 'APPROVE_TASK' })
          }
        }),
      ],
      on: {
        APPROVE_TASK: [
          {
            guard: 'hasMoreTasks',
            target: 'executing',
            actions: [
              { type: 'markTaskVerified' },
              assign({
                approvals: ({ context }) => [
                  ...context.approvals,
                  `task:${context.currentTaskIndex}`,
                ],
                currentTaskIndex: ({ context }) => context.currentTaskIndex + 1,
              }),
            ],
          },
          {
            target: 'integrating',
            actions: assign({
              approvals: ({ context }) => [
                ...context.approvals,
                `task:${context.currentTaskIndex}`,
              ],
            }),
          },
        ],
        REVISE: {
          target: 'revising',
          actions: assign({
            reviseInstruction: ({ event }) => (event.type === 'REVISE' ? event.instruction : null),
          }),
        },
        ROLLBACK: 'rollingBack',
      },
    },

    revising: {
      entry: [
        { type: 'enter', params: { name: 'revising' } },
        'clearTurn',
        {
          type: 'sendPrompt',
          params: ({ context }) => ({
            phase: context.mode === 'investigation' ? 'execute-task-investigation' : 'execute-task',
          }),
        },
      ],
      on: {
        TASK_RESULT: { actions: 'noteTurnEvent' },
        EVIDENCE: { actions: ['noteTurnEvent', { type: 'recordEvidence' }] },
        TURN_FINISHED: {
          target: 'verifying',
          actions: assign({ reviseInstruction: () => null }),
        },
      },
    },

    rollingBack: {
      // `git reset --hard <checkpointRef>` (spec §5), then retry the same task.
      entry: [{ type: 'rollbackToCheckpoint' }, assign({ evidence: () => [] })],
      always: 'executing',
    },

    integrating: {
      entry: { type: 'enter', params: { name: 'integrating' } },
      on: {
        // The set can go red between review and integration. Learning that must
        // not move the objective out of `integrating` — it must only make the
        // guard below refuse.
        EVIDENCE_RESULT: {
          actions: assign({
            evidence: ({ event }) => (event.type === 'EVIDENCE_RESULT' ? event.items : []),
          }),
        },
        INTEGRATE: [
          {
            // Re-evaluated here, not trusted from `verifying`. Spec §5 requires
            // `done` be unreachable without a full green set, and the evidence
            // could have been invalidated between review and integration.
            guard: 'evidenceComplete',
            target: 'done',
            actions: {
              type: 'finishObjective',
              params: ({ event }) => ({
                action: event.type === 'INTEGRATE' ? event.action : 'keep',
              }),
            },
          },
          { target: 'paused' },
        ],
      },
    },

    paused: {
      // No `enter(...)` here — `paused` must not overwrite the return address
      // the state it came from stamped.
      on: {
        RESUME: [
          { guard: ({ context }) => context.resumeState === 'exploring', target: 'exploring' },
          { guard: ({ context }) => context.resumeState === 'proposing', target: 'proposing' },
          { guard: ({ context }) => context.resumeState === 'planning', target: 'planning' },
          { guard: ({ context }) => context.resumeState === 'executing', target: 'executing' },
          { guard: ({ context }) => context.resumeState === 'verifying', target: 'verifying' },
          { guard: ({ context }) => context.resumeState === 'revising', target: 'revising' },
          {
            guard: ({ context }) => context.resumeState === 'awaitingReview',
            target: 'awaitingReview',
          },
          {
            guard: ({ context }) => context.resumeState === 'integrating',
            target: 'integrating',
          },
          { target: 'idle' },
        ],
        REVISE: {
          target: 'revising',
          actions: assign({
            reviseInstruction: ({ event }) => (event.type === 'REVISE' ? event.instruction : null),
          }),
        },
        ROLLBACK: { guard: 'hasCheckpoint', target: 'rollingBack' },
      },
    },

    done: { type: 'final' },
    cancelled: { type: 'final' },
    failed: { type: 'final' },
  },
})
