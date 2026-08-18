import { isProtectedPath } from './protected-paths.js'

/**
 * Spec §5's low-risk policy (amendment A12): the diff `awaitingReview →
 * integrating`'s auto-approve guard judges. Deliberately not the server's
 * richer `DiffSummary` (`packages/server/src/git/diff.ts`) — `core` has no
 * I/O and cannot import from `server`; this is the minimal shape a pure
 * classifier needs, built by the server from `objectiveDiff`'s real output.
 */
export type TaskDiffSummary = {
  changedFiles: string[]
  insertions: number
  deletions: number
  /** JS/TS only. `null` when the language has no export-line detector. */
  exportLinesRemoved: number | null
  exportLinesAdded: number | null
}

export type RiskPolicyConfig = {
  /** From the resolved `VerificationSpec`'s `policy.protectedGlobs`. */
  protectedGlobs: string[]
  /** From `policy.maxFastFixLines`. */
  maxLines: number
}

/** Fixed alongside, not inside, the configurable `protectedGlobs` — spec §5 lists these as their own category. */
const DEFAULT_PROTECTED_GLOBS = ['**/migrations/**', '**/*.sql']

const LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Cargo.lock',
  'go.sum',
])

const DEPENDENCY_MANIFESTS = new Set([
  'package.json',
  'composer.json',
  'Gemfile',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
])

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * Spec §5's low-risk policy, amendment A12. First violation wins; see the
 * design doc's §3.1 table for why each rule reads what it reads.
 *
 * "No new dependencies" is deliberately coarse: any dependency-manifest
 * *touch* escalates, not just an addition — a version bump escalates too,
 * but the failure direction is safe (falls back to manual review).
 *
 * "No deleted public exports" applies only when both counts are non-null
 * (JS/TS, amendment A12's export-line heuristic). For any other language this
 * rule does not fire — it is not treated as a violation, since the real
 * backstop against a real breakage is `integrating → done` still requiring a
 * full green evidence set regardless of which path approved the task.
 */
export function classifyTaskRisk(diff: TaskDiffSummary, policy: RiskPolicyConfig): 'low' | 'high' {
  const protectedGlobs = [...DEFAULT_PROTECTED_GLOBS, ...policy.protectedGlobs]
  if (diff.changedFiles.some((f) => isProtectedPath(f, protectedGlobs))) return 'high'
  if (diff.changedFiles.some((f) => LOCKFILES.has(basename(f)))) return 'high'
  if (diff.changedFiles.some((f) => DEPENDENCY_MANIFESTS.has(basename(f)))) return 'high'
  if (diff.insertions + diff.deletions > policy.maxLines) return 'high'
  if (
    diff.exportLinesRemoved !== null &&
    diff.exportLinesAdded !== null &&
    diff.exportLinesRemoved > diff.exportLinesAdded
  ) {
    return 'high'
  }
  return 'low'
}
