import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

/**
 * Resolves the nearest existing ancestor of `p` through symlinks, then
 * re-appends the non-existent tail. Needed because writes target files that
 * do not exist yet, and `realpathSync` throws on those.
 */
function resolveThroughSymlinks(p: string): string {
  let current = resolve(p)
  const tail: string[] = []
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return resolve(p)
    tail.unshift(current.slice(parent.length + 1))
    current = parent
  }
  return resolve(realpathSync(current), ...tail)
}

/**
 * M0 policy (design §4.4): allow anything inside the objective's worktree,
 * reject everything else. Comparison is on fully resolved real paths so
 * `..` traversal and symlinks cannot escape.
 */
export function isInsideWorktree(worktreeRoot: string, target: string): boolean {
  const root = resolveThroughSymlinks(worktreeRoot)
  const path = resolveThroughSymlinks(target)
  if (path === root) return true
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Every filesystem path a tool call would touch.
 *
 * The Task 2 spike observed `requestPermission.toolCall.locations` **absent
 * entirely** — even for an Edit whose earlier `tool_call` notification for the
 * same `toolCallId` did carry locations. So three sources are consulted: the
 * request's own `locations`, locations remembered from the `tool_call` stream
 * by id, and `rawInput`'s path-bearing fields.
 *
 * See docs/superpowers/notes/acp-handshake.md §3.
 */
export function pathsFromToolCall(
  toolCall: {
    toolCallId?: string
    locations?: { path: string }[] | null
    rawInput?: Record<string, unknown>
  },
  known?: ReadonlyMap<string, string[]>,
): string[] {
  const out = new Set<string>()
  for (const l of toolCall.locations ?? []) out.add(l.path)
  if (toolCall.toolCallId) {
    for (const p of known?.get(toolCall.toolCallId) ?? []) out.add(p)
  }
  const raw = toolCall.rawInput ?? {}
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const v = raw[key]
    if (typeof v === 'string' && v.length > 0) out.add(v)
  }
  return [...out]
}

/**
 * The containment ruling for a set of paths.
 *
 * Fails closed on an empty set. This is not defensive padding: the spike
 * proved the path set can legitimately come back empty, and the obvious
 * `paths.every(isInside)` returns `true` for `[]` — silently allowing exactly
 * the writes this policy exists to stop.
 */
export function decidePermission(
  worktreeRoot: string,
  paths: string[],
): { allowed: boolean; reason?: string } {
  if (paths.length === 0) {
    return { allowed: false, reason: 'No filesystem path could be determined for this tool call' }
  }
  const outside = paths.filter((p) => !isInsideWorktree(worktreeRoot, p))
  if (outside.length > 0) {
    return { allowed: false, reason: `Outside the objective worktree: ${outside.join(', ')}` }
  }
  return { allowed: true }
}
