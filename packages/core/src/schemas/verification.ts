import { z } from 'zod'

/**
 * Spec §6's final format, plus amendment A1's optional `cwd` and `setup`.
 *
 * `cwd` defaults to `"."` rather than being left undefined so that every
 * consumer — EvidenceCollector, the Evidence Panel, the machine's guard — reads
 * one shape and no caller has to remember the default.
 */
const Command = z.object({
  id: z.string().min(1).max(40),
  run: z.string().min(1).max(500),
  required: z.boolean(),
  allowWarn: z.boolean().default(false),
  cwd: z.string().max(200).default('.'),
})
export type VerifyCommand = z.infer<typeof Command>

const SetupCommand = z.object({
  id: z.string().min(1).max(40),
  run: z.string().min(1).max(500),
  cwd: z.string().max(200).default('.'),
})

export const VerificationSpec = z
  .object({
    verify: z.object({
      setup: z.array(SetupCommand).default([]),
      commands: z.array(Command).default([]),
      checks: z.array(z.string().min(1).max(300)).default([]),
      timeoutSec: z.number().int().positive().max(3600).default(600),
    }),
    policy: z
      .object({
        protectedGlobs: z.array(z.string()).default([]),
        maxFastFixLines: z.number().int().positive().default(150),
      })
      .default({ protectedGlobs: [], maxFastFixLines: 150 }),
  })
  // Two rows claiming the same command id make `evidenceComplete` ambiguous:
  // one green and one red `test` would let the guard pass on whichever it found
  // first. Refuse the spec instead of resolving it arbitrarily.
  .refine((s) => new Set(s.verify.commands.map((c) => c.id)).size === s.verify.commands.length, {
    message: 'verify.commands[].id must be unique',
  })
export type VerificationSpec = z.infer<typeof VerificationSpec>

/**
 * Spec §6 keeps `checks` a list of strings. Amendment A5 derives their ids
 * positionally, so a check can be linked to the `evidence_items` row that
 * satisfies it without changing the spec's format.
 */
export function normalizeChecks(spec: VerificationSpec): { id: string; text: string }[] {
  return spec.verify.checks.map((text, i) => ({ id: `check-${i}`, text }))
}
