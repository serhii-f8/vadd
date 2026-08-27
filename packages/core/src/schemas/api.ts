import { z } from 'zod'
import { VerificationOverride } from './verification.js'

export const AGENT_KINDS = ['claude-code', 'codex'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

export const RegisterProjectBody = z.object({
  repoPath: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  agentKind: z.enum(AGENT_KINDS).default('claude-code'),
})
export type RegisterProjectBody = z.infer<typeof RegisterProjectBody>

export const CreateObjectiveBody = z.object({
  title: z.string().min(1).max(120),
  goalText: z.string().min(1).max(4000),
  /** D1/A15: standard, Fast Fix (skips proposing/awaitingDecision), and investigation (read-only, no diff). */
  mode: z.enum(['standard', 'fastfix', 'investigation']).default('standard'),
  /**
   * Spec §6's per-objective override, merged over repo config or
   * auto-detection at creation and winning leaf by leaf.
   *
   * `VerificationOverride`, not `VerificationSpec`: the full schema's defaults
   * would turn "raise the timeout" into an override carrying three empty
   * arrays, and `mergeSpec` replaces leaves — so it would silently erase the
   * commands resolution had just found. A caller supplying a whole spec still
   * parses, because every leaf is optional rather than absent.
   */
  verificationOverrides: VerificationOverride.optional(),
  /**
   * A "Continue" follow-up's link to the objective it continued from. The
   * route resolves this to a worktree start point when the prior objective's
   * branch still exists, and records the link regardless — it is best-effort
   * context, not a hard dependency (a nonexistent id is stored as given, not
   * rejected).
   */
  continuedFromId: z.string().min(1).optional(),
})
export type CreateObjectiveBody = z.infer<typeof CreateObjectiveBody>

/**
 * Spec §7 defines many more commands. M1 phase 1 adds `phase` alongside the
 * raw `text` form: exactly one of the two must be present, which
 * `discriminatedUnion` cannot express (its members must be plain objects), so
 * the route enforces it and returns a 400 with a specific message.
 */
export const ObjectiveCommand = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('prompt'),
    text: z.string().min(1).max(20_000).optional(),
    phase: z.string().min(1).max(40).optional(),
    /**
     * Extra template variables, merged over the ones the server derives from
     * the objective row.
     *
     * Two bundled templates carry placeholders whose real sources — the
     * verification spec and `plan_tasks` — are milestone phases 3 and 4. Until
     * those exist this is how a caller supplies them; without it, `verify` and
     * `execute-task` are unusable. `verify.md`, `execute-task.md` and
     * `execute-task-investigation.md` are the three templates that solicit
     * `evidence`, one of the two types the §9 gate binds on.
     */
    vars: z.record(z.string(), z.string().max(4000)).optional(),
  }),
  z.object({ type: z.literal('cancel') }),
  /**
   * Amendment A9. Spec §7 called this `cancel`; M0 had already spent that name
   * on cancelling the in-flight *turn*, and the corpus-recording path depends
   * on the M0 meaning — one word cannot mean both "stop this turn" and
   * "destroy this objective". `abandon` carries the spec's semantics:
   * terminal, from any non-terminal state, ending at `cancelled`.
   */
  z.object({ type: z.literal('abandon') }),
  /**
   * `pr` and `merge` are accepted by the schema only so the route can refuse
   * them with a message that says *why* (they are M2, spec §8.1) rather than a
   * generic union-mismatch 400. All three of `commit`, `keep` and `discard`
   * are machine transitions from `integrating`, guarded by `evidenceComplete`;
   * `discard` means "this was proven and I do not want it", which is why the
   * rows survive. The destructive delete lives at `DELETE /api/objectives/:id`.
   */
  z.object({
    type: z.literal('integrate'),
    action: z.enum(['commit', 'keep', 'discard', 'pr', 'merge']),
  }),

  // --- spec §7's remaining user commands, all feeding the machine ---
  z.object({ type: z.literal('start') }),
  z.object({
    type: z.literal('decide'),
    decisionId: z.string().min(1),
    optionId: z.string().min(1),
  }),
  z.object({ type: z.literal('answer_clarification'), answer: z.string().min(1).max(2000) }),
  z.object({
    type: z.literal('approve_plan'),
    /** Spec §8's PlanApproval list is editable; absent means "approve as proposed". */
    edits: z
      .array(
        z.object({
          title: z.string().min(1).max(80),
          description: z.string().max(300),
          /** Amendment A11 — see the `plan` event's field of the same name. */
          expectFailing: z.array(z.string().max(40)).max(5).optional(),
        }),
      )
      .min(1)
      .max(12)
      .optional(),
  }),
  z.object({ type: z.literal('approve_task') }),
  z.object({ type: z.literal('revise'), instruction: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('rollback') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  /** Amendment A12: D8's toggle. */
  z.object({ type: z.literal('set_low_energy'), value: z.boolean() }),
  // Spec §6's manual tick. Not a machine event: it writes a row, and the next
  // reconciliation reads it.
  z.object({
    type: z.literal('tick_check'),
    checkId: z.string().min(1).max(40),
    satisfied: z.boolean(),
  }),
])
export type ObjectiveCommand = z.infer<typeof ObjectiveCommand>
