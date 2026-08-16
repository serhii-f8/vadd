import type { VerificationOverride, VerificationSpec } from '../schemas/verification.js'
import { decideCommand } from './command-policy.js'

/**
 * Leaf-field replacement. Spec §6 says overrides win "field by field"; design
 * §3.3 settles which fields — `verify.setup`, `verify.commands`,
 * `verify.checks`, `verify.timeoutSec`, `policy.protectedGlobs`,
 * `policy.maxFastFixLines`.
 *
 * Arrays replace wholesale rather than merging by id, so a user drops a
 * wrongly-detected command by simply not listing it. A deep merge could not
 * express removal without a delete sentinel the spec does not have.
 *
 * An explicitly-`undefined` leaf is dropped rather than spread over the base:
 * `{...base, ...{commands: undefined}}` would otherwise erase `commands`
 * entirely, and an override that mentions a field only to leave it unset means
 * "no opinion", not "empty".
 */
export function mergeSpec(
  base: VerificationSpec,
  override: VerificationOverride | null,
): VerificationSpec {
  if (!override) return base
  return {
    verify: { ...base.verify, ...defined(override.verify) },
    policy: { ...base.policy, ...defined(override.policy) },
  }
}

function defined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {}
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

export type SpecAllowed = { allowed: true } | { allowed: false; commandId: string; reason: string }

/**
 * Design §3.7: amendment A3's predicate now governs commands VADD itself runs,
 * not only the agent's. Verification commands arrive from a file committed in
 * the target repo, from detection, or from a user override — one policy covers
 * all three.
 *
 * `setup` is checked first because it runs first: reporting the earliest
 * problem is more useful than reporting the alphabetically first one.
 */
export function assertSpecAllowed(spec: VerificationSpec, worktreeRoot: string): SpecAllowed {
  for (const command of [...spec.verify.setup, ...spec.verify.commands]) {
    const decision = decideCommand(command.run, worktreeRoot)
    if (!decision.allowed) {
      return {
        allowed: false,
        commandId: command.id,
        reason: decision.reason ?? 'Refused by the command policy',
      }
    }
  }
  return { allowed: true }
}
