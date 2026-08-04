import { z } from 'zod'

export const RegisterProjectBody = z.object({
  repoPath: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
})
export type RegisterProjectBody = z.infer<typeof RegisterProjectBody>

export const CreateObjectiveBody = z.object({
  title: z.string().min(1).max(120),
  goalText: z.string().min(1).max(4000),
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
  }),
  z.object({ type: z.literal('cancel') }),
  z.object({ type: z.literal('integrate'), action: z.literal('discard') }),
])
export type ObjectiveCommand = z.infer<typeof ObjectiveCommand>
