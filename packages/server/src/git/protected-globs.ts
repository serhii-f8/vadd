import { VerificationSpec } from '@vadd/core'

/**
 * `policy.protectedGlobs`, or the fact that the stored spec cannot be read.
 *
 * The distinction is the whole point. Both call sites used to read the column
 * as `VerificationSpec.safeParse(...).success ? ....policy.protectedGlobs : []`,
 * which collapses two different facts into one: "this objective declares no
 * protected paths" and "VADD cannot tell what this objective protects". The
 * second is a fail-open on a security-adjacent policy, and it is invisible at
 * the point of use — a commit carrying a protected file reports
 * `excludedPaths: []`, which reads exactly like an exclusion that ran and
 * found nothing. Observed for real while hand-verifying the git surface.
 */
export type ProtectedGlobsRead = { ok: true; globs: string[] } | { ok: false; reason: string }

export function readProtectedGlobs(stored: unknown): ProtectedGlobsRead {
  // A spec that was never resolved is a legitimate "no opinion": the column is
  // nullable, and an objective created before verification resolution ran has
  // nothing stored. `safeParse(null)` fails, so this case has to be answered
  // before the parse rather than after it.
  if (stored === null || stored === undefined) return { ok: true, globs: [] }

  const spec = VerificationSpec.safeParse(stored)
  if (!spec.success) {
    return {
      ok: false,
      reason:
        "This objective's verification spec cannot be read, so VADD cannot tell " +
        'which paths it protects. Fix or clear the spec before committing here.',
    }
  }
  return { ok: true, globs: spec.data.policy.protectedGlobs }
}
