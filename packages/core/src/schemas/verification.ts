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
 * Spec §6's per-objective override — the third resolution source, merged over
 * repo config or auto-detection and winning leaf by leaf (design §3.3).
 *
 * Deliberately **not** `VerificationSpec` itself: that schema's defaults fill
 * `setup`/`commands`/`checks` with `[]`, so an override meaning only "raise the
 * timeout" would arrive carrying three empty arrays and the leaf-replacing
 * merge would erase everything config or detection had found. Every leaf here
 * is optional, and absent means "no opinion" rather than "empty".
 *
 * The individual commands still carry `Command`'s own defaults, so an override
 * that supplies commands supplies them whole.
 */
export const VerificationOverride = z.object({
  verify: z
    .object({
      setup: z.array(SetupCommand).optional(),
      commands: z
        .array(Command)
        // Same reason as the spec's own refinement: two rows claiming one id
        // make `evidenceComplete` ambiguous. Commands replace wholesale, so
        // checking the override's own array is enough.
        .refine((c) => new Set(c.map((x) => x.id)).size === c.length, {
          message: 'verify.commands[].id must be unique',
        })
        .optional(),
      checks: z.array(z.string().min(1).max(300)).optional(),
      timeoutSec: z.number().int().positive().max(3600).optional(),
    })
    .optional(),
  policy: z
    .object({
      protectedGlobs: z.array(z.string()).optional(),
      maxFastFixLines: z.number().int().positive().optional(),
    })
    .optional(),
})
export type VerificationOverride = z.infer<typeof VerificationOverride>

/**
 * Spec §6 keeps `checks` a list of strings. Amendment A5 derives their ids
 * positionally, so a check can be linked to the `evidence_items` row that
 * satisfies it without changing the spec's format.
 */
export function normalizeChecks(spec: VerificationSpec): { id: string; text: string }[] {
  return spec.verify.checks.map((text, i) => ({ id: `check-${i}`, text }))
}
