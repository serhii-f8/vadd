import type { RiskPolicyConfig } from '@vadd/core'
import { classifyTaskRisk } from '@vadd/core'
import { git, objectiveDiff } from '../git/diff.js'

const JS_TS_EXTENSION = /\.(ts|tsx|js|jsx)$/

/**
 * `null` unless every changed file is JS/TS — `classifyTaskRisk`'s export
 * rule only applies when this is non-null for both counts (amendment A12).
 */
async function exportLineDelta(
  worktreePath: string,
  ref: string,
  files: string[],
): Promise<{ added: number; removed: number } | null> {
  if (files.length === 0 || !files.every((f) => JS_TS_EXTENSION.test(f))) return null
  const diffText = await git(worktreePath, ['diff', ref, '--', ...files])
  let added = 0
  let removed = 0
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (/^\+\s*export\b/.test(line)) added++
    else if (/^-\s*export\b/.test(line)) removed++
  }
  return { added, removed }
}

/**
 * The real diff behind §5's low-risk policy (amendment A12), scoped to one
 * task's own checkpoint — not the objective's `baseSha`, so a plan's earlier,
 * already-approved tasks never count against a later one's risk. Reuses
 * `objectiveDiff` exactly as `/diff` does; `checkpointRef` is just another
 * starting ref to it.
 *
 * Fails closed to `'high'` on any git error — same direction as
 * `command-policy.ts`'s unclassifiable-tool branch.
 */
export async function computeTaskRisk(
  worktreePath: string,
  checkpointRef: string,
  policy: RiskPolicyConfig,
): Promise<'low' | 'high'> {
  try {
    const summary = await objectiveDiff(worktreePath, checkpointRef)
    const changedFiles = summary.files.map((f) => f.path)
    const delta = await exportLineDelta(worktreePath, checkpointRef, changedFiles)
    return classifyTaskRisk(
      {
        changedFiles,
        insertions: summary.totals.added,
        deletions: summary.totals.removed,
        exportLinesRemoved: delta?.removed ?? null,
        exportLinesAdded: delta?.added ?? null,
      },
      policy,
    )
  } catch {
    return 'high'
  }
}
