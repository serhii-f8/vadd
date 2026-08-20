import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeSpec, type VerificationOverride, VerificationSpec } from '@vadd/core'
import { detectVerification } from './detect.js'

export type Resolution =
  | { kind: 'resolved'; spec: VerificationSpec; source: 'config' | 'detected' }
  | { kind: 'none'; scanned: string[] }
  | { kind: 'invalid'; reason: string }

const EMPTY: VerificationSpec = {
  verify: { setup: [], commands: [], checks: [], timeoutSec: 600 },
  policy: { protectedGlobs: [], maxFastFixLines: 150 },
}

/**
 * Investigation-mode objectives (amendment A15) have nothing to run — no
 * commands, ever — so resolution for them never goes through
 * `resolveVerification`'s repo auto-detection at all (see the route). This is
 * their fixed default, mergeable with a per-objective override the same way
 * any other resolved spec is (D10).
 */
export const INVESTIGATION_VERIFICATION_SPEC: VerificationSpec = {
  verify: {
    setup: [],
    commands: [],
    checks: ['Findings read and confirmed accurate'],
    timeoutSec: 600,
  },
  policy: { protectedGlobs: [], maxFastFixLines: 150 },
}

type ConfigRead = { found: false } | { found: true; raw: unknown } | Resolution

function readConfig(rootPath: string): ConfigRead {
  const path = join(rootPath, '.vadd', 'config.json')
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { found: false }
  }
  try {
    return { found: true, raw: JSON.parse(text) as unknown }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { kind: 'invalid', reason: `.vadd/config.json is not valid JSON: ${detail}` }
  }
}

/**
 * M1 design §7.1's disambiguation of spec §6, verbatim: the base is the repo's
 * `.vadd/config.json` when present, otherwise auto-detection; the per-objective
 * override then merges on top and wins leaf by leaf.
 *
 * A malformed or invalid config **refuses** and never falls back to detection
 * (design §3.6). A broken committed config quietly becoming a set of
 * auto-detected commands is how an objective ends up green against a suite
 * nobody authored.
 */
export function resolveVerification(
  rootPath: string,
  override: VerificationOverride | null,
): Resolution {
  const config = readConfig(rootPath)
  if ('kind' in config) return config

  if (config.found) {
    const parsed = VerificationSpec.safeParse(config.raw)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const where = first?.path.join('.')
      return {
        kind: 'invalid',
        reason: `.vadd/config.json failed validation${where ? ` at ${where}` : ''}: ${
          first?.message ?? 'unknown rule'
        }`,
      }
    }
    return { kind: 'resolved', spec: mergeSpec(parsed.data, override), source: 'config' }
  }

  const detected = detectVerification(rootPath)
  const base = detected.kind === 'detected' ? detected.spec : EMPTY
  const merged = mergeSpec(base, override)

  // Nothing detected and nothing overridden is spec §6's explicit "none" — not
  // an empty, and therefore trivially green, command set.
  if (merged.verify.commands.length === 0 && merged.verify.checks.length === 0) {
    return { kind: 'none', scanned: detected.kind === 'none' ? detected.scanned : ['.'] }
  }

  // When detection found nothing but an override supplied commands, the spec
  // came from the user, and `'config'` is the closer of the two labels.
  return {
    kind: 'resolved',
    spec: merged,
    source: detected.kind === 'detected' ? 'detected' : 'config',
  }
}
