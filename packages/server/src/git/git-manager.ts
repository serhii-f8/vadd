import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { execa } from 'execa'

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: 'ENOENT' | 'ENOTREPO' | 'EGIT',
  ) {
    super(message)
    this.name = 'GitError'
  }
}

async function git(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execa('git', ['-C', repoPath, ...args])
    return stdout
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new GitError(`git ${args.join(' ')} failed: ${detail}`, 'EGIT')
  }
}

/**
 * Returns the repository toplevel. The two failure modes get distinct codes
 * because "not a git repo" is the error a first-time user hits most.
 */
export async function validateRepo(repoPath: string): Promise<string> {
  if (!existsSync(repoPath)) {
    throw new GitError(`Path does not exist: ${repoPath}`, 'ENOENT')
  }
  try {
    const { stdout } = await execa('git', ['-C', repoPath, 'rev-parse', '--show-toplevel'])
    return resolve(stdout.trim())
  } catch {
    throw new GitError(`Not a git repository: ${repoPath}`, 'ENOTREPO')
  }
}

/**
 * Creates the worktree and returns the sha it branched from (amendment A8).
 *
 * The sha is read from the source repo immediately before `worktree add`, not
 * derived afterwards: `/diff` and `integrate: commit`'s squash both mean
 * "since this objective started", and a `merge-base` computed later changes
 * its answer every time the base branch advances.
 */
export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
): Promise<string> {
  const baseSha = (await git(repoPath, ['rev-parse', 'HEAD'])).trim()
  await mkdir(dirname(worktreePath), { recursive: true })
  await git(repoPath, ['worktree', 'add', '-b', branch, worktreePath])
  return baseSha
}

/**
 * Idempotent teardown. `git worktree remove` fails if the directory has already
 * been deleted, so a prune-and-retry covers the crash-between-steps case; the
 * branch delete is best-effort because the branch may never have been created.
 *
 * `pruneWorktrees` only clears admin entries whose working directories are
 * already gone — it is a no-op if `remove` failed for any other reason (a
 * stale `.git/worktrees/<name>/locked` file, a permissions error, ...). Left
 * unchecked, this function would then resolve successfully while the
 * worktree stayed registered and on disk, silently violating the leak-free
 * lifecycle guarantee. The post-condition check below turns that into a
 * loud `EGIT` failure instead.
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  /** `null` removes the worktree but keeps the branch — `integrate: commit`. */
  branch: string | null,
): Promise<void> {
  try {
    await git(repoPath, ['worktree', 'remove', '--force', worktreePath])
  } catch {
    await pruneWorktrees(repoPath)
  }
  if (branch !== null) {
    try {
      await git(repoPath, ['branch', '-D', branch])
    } catch {
      // Branch absent or already deleted — not an error for teardown.
    }
  }
  await pruneWorktrees(repoPath)

  const target = resolve(worktreePath)
  if ((await listWorktrees(repoPath)).some((w) => resolve(w) === target)) {
    throw new GitError(
      `Worktree still registered after removal: ${worktreePath}. ` +
        'Check for a stale lock in .git/worktrees or a permissions problem.',
      'EGIT',
    )
  }
}

/** Absolute paths of every worktree, including the main one. */
export async function listWorktrees(repoPath: string): Promise<string[]> {
  const stdout = await git(repoPath, ['worktree', 'list', '--porcelain'])
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
}

export async function pruneWorktrees(repoPath: string): Promise<void> {
  await git(repoPath, ['worktree', 'prune'])
}

/**
 * Spec §5: `git add -A && git commit` with a `vadd-checkpoint:` prefix before
 * each `executing` entry, so `rollingBack` always has somewhere to land.
 *
 * Returns null on a clean tree. An empty commit would work but would leave the
 * task's `checkpointRef` pointing at a commit indistinguishable from its
 * predecessor, so a rollback could not tell whether it had undone anything.
 */
export async function checkpointCommit(
  worktreePath: string,
  message: string,
): Promise<string | null> {
  await git(worktreePath, ['add', '-A'])
  const staged = await git(worktreePath, ['status', '--porcelain'])
  if (staged.trim() === '') return null
  await git(worktreePath, ['commit', '-m', message])
  return (await git(worktreePath, ['rev-parse', 'HEAD'])).trim()
}

export async function resetHard(worktreePath: string, ref: string): Promise<void> {
  await git(worktreePath, ['reset', '--hard', ref])
}
