import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { execa } from 'execa'
import { GitError, gitChecked as git } from './run.js'

export { GitError } from './run.js'

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
 *
 * `startPoint`, when given, is any git-recognized ref (a branch name here) —
 * `-b branch` always creates a *new* branch name regardless, so there is no
 * "already checked out elsewhere" conflict even if `startPoint` itself is
 * checked out in another worktree.
 */
export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  startPoint?: string,
): Promise<string> {
  const baseSha = (await git(repoPath, ['rev-parse', startPoint ?? 'HEAD'])).trim()
  await mkdir(dirname(worktreePath), { recursive: true })
  const args = ['worktree', 'add', '-b', branch, worktreePath]
  if (startPoint) args.push(startPoint)
  await git(repoPath, args)
  return baseSha
}

/**
 * Idempotent teardown. `git worktree remove` fails if the directory has already
 * been deleted, so a prune-and-retry covers the crash-between-steps case; the
 * branch delete is best-effort because the branch may never have been created.
 *
 * Two post-conditions, because git-level success and filesystem-level success
 * are different facts and the leak-free lifecycle guarantee (spec §10) needs
 * both:
 *
 * 1. Still *registered*. `pruneWorktrees` only clears admin entries whose
 *    working directories are already gone, so it is a no-op when `remove`
 *    failed for a reason that left the directory intact — a stale
 *    `.git/worktrees/<name>/locked` file, say.
 * 2. Still *on disk*. `worktree remove --force` deletes the `.git` link file
 *    early and can then fail partway through the recursive delete — which is
 *    what a root-owned `vendor/` written by an in-container install does. The
 *    missing link file is precisely what makes prune deregister the worktree,
 *    so after that failure check 1 passes: git has forgotten a directory that
 *    is still there. This is not hypothetical; it leaked ~1.7GB across five
 *    directories under `~/.vadd/worktrees` while every teardown reported
 *    success.
 *
 * Either one is a loud `EGIT` failure. Nothing here retries the delete: if the
 * invoking user could not unlink those files, neither can we.
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
  if (existsSync(target)) {
    throw new GitError(
      `Worktree directory still on disk after removal: ${worktreePath}. ` +
        'Git has deregistered it, so nothing will retry this. Most likely it ' +
        'holds files this user cannot unlink (a root-owned vendor/ or ' +
        'node_modules/ written by an in-container install); check ownership ' +
        'and remove it by hand.',
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
