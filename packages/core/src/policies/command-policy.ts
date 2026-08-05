import { isAbsolute, relative, resolve } from 'node:path'

export type CommandDecision = { allowed: boolean; reason?: string }

const SUDO = /\bsudo\b/
const PIPED_SHELL_INSTALLER = /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|python3?)\b/
const GIT_PUSH = /\bgit\s+push\b/
const GIT_HISTORY_REWRITE = /\bgit\s+(rebase|filter-branch)\b/
const SSH_PATH = /\.ssh(\/|$)/
const SSH_WRITE_VERB = /(>>?|\bcp\b|\bmv\b|\btee\b|\brsync\b|\binstall\b)/

/** Splits on shell statement separators. Not a real parser — good enough for a denylist. */
function statements(command: string): string[] {
  return command
    .split(/&&|\|\||;|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Whitespace tokens, with simple quoting respected. */
function tokenize(statement: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  // biome-ignore lint: assignment-in-expression is the standard regex exec loop
  while ((m = re.exec(statement))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

function isOutsideWorktree(target: string, worktreeRoot: string): boolean {
  const rel = relative(worktreeRoot, resolve(worktreeRoot, target))
  return rel === worktreeRoot ? false : rel.startsWith('..') || isAbsolute(rel)
}

function rmRfTargetsOutsideWorktree(statement: string, worktreeRoot: string): boolean {
  const tokens = tokenize(statement)
  if (tokens[0] !== 'rm') return false
  const flags = tokens.slice(1).filter((t) => t.startsWith('-'))
  const hasR = flags.some((f) => f.includes('r') || f === '--recursive')
  const hasF = flags.some((f) => f.includes('f') || f === '--force')
  if (!(hasR && hasF)) return false
  const targets = tokens.slice(1).filter((t) => !t.startsWith('-'))
  return targets.some((t) => isOutsideWorktree(t, worktreeRoot))
}

/**
 * Design §7.5 / spec amendment A3: commands are allowed by default, cwd
 * pinned to the worktree by the caller, refused only against a vendored
 * denylist. Isolation, not a sandbox — the worktree bounds mistakes, not a
 * determined escape.
 */
export function decideCommand(command: string, worktreeRoot: string): CommandDecision {
  const trimmed = command.trim()
  if (trimmed === '') {
    return { allowed: false, reason: 'Empty command' }
  }
  if (SUDO.test(trimmed)) {
    return { allowed: false, reason: 'sudo is not permitted' }
  }
  if (PIPED_SHELL_INSTALLER.test(trimmed)) {
    return { allowed: false, reason: 'Piped-shell installers are not permitted' }
  }
  if (GIT_PUSH.test(trimmed)) {
    return { allowed: false, reason: 'git push is not permitted from an agent session' }
  }
  if (GIT_HISTORY_REWRITE.test(trimmed)) {
    return { allowed: false, reason: 'History-rewriting git commands are not permitted' }
  }
  if (SSH_PATH.test(trimmed) && SSH_WRITE_VERB.test(trimmed)) {
    return { allowed: false, reason: 'Writes to ~/.ssh are not permitted' }
  }
  for (const s of statements(trimmed)) {
    if (rmRfTargetsOutsideWorktree(s, worktreeRoot)) {
      return { allowed: false, reason: 'rm -rf targeting outside the worktree is not permitted' }
    }
  }
  return { allowed: true }
}
