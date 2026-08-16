import { z } from 'zod'
import { VerificationOverride } from './verification.js'

export const RegisterProjectBody = z.object({
  repoPath: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
})
export type RegisterProjectBody = z.infer<typeof RegisterProjectBody>

export const CreateObjectiveBody = z.object({
  title: z.string().min(1).max(120),
  goalText: z.string().min(1).max(4000),
  /** D1's two paths (spec §7). Fast Fix skips proposing/awaitingDecision only. */
  mode: z.enum(['standard', 'fastfix']).default('standard'),
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
     * `execute-task` are unusable, and they are the only two templates that
     * solicit `evidence`, one of the two types the §9 gate binds on.
     */
    vars: z.record(z.string(), z.string().max(4000)).optional(),
  }),
  z.object({ type: z.literal('cancel') }),
  /**
   * `pr` and `merge` are accepted by the schema only so the route can refuse
   * them with a message that says *why* (they are M2, spec §8.1) rather than a
   * generic union-mismatch 400. `discard` keeps its M0 meaning — stop the
   * agent, remove the worktree, delete the rows — and never reaches the
   * machine; `commit` and `keep` are machine transitions.
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
      .array(z.object({ title: z.string().min(1).max(80), description: z.string().max(300) }))
      .min(1)
      .max(12)
      .optional(),
  }),
  z.object({ type: z.literal('approve_task') }),
  z.object({ type: z.literal('revise'), instruction: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('rollback') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  // Spec §6's manual tick. Not a machine event: it writes a row, and the next
  // reconciliation reads it.
  z.object({
    type: z.literal('tick_check'),
    checkId: z.string().min(1).max(40),
    satisfied: z.boolean(),
  }),
])
export type ObjectiveCommand = z.infer<typeof ObjectiveCommand>
