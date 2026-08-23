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

/**
 * The bare exec. Rejects with execa's own error.
 *
 * Two copies of this existed — a private one in `git-manager.ts` that wrapped
 * failures, and an exported one in `diff.ts` that did not — which is why
 * `verification/risk.ts` imported from the diff module purely to borrow it.
 *
 * `globalFlags` are git's own top-level flags — the ones that only parse
 * correctly *before* `-C` (`--no-optional-locks` among them). They cannot be
 * smuggled into `args`, which always lands after `-C <cwd>`.
 */
export async function git(
  cwd: string,
  args: string[],
  globalFlags: string[] = [],
): Promise<string> {
  const { stdout } = await execa('git', [...globalFlags, '-C', cwd, ...args])
  return stdout
}

/** As `git`, but failures arrive as a typed `GitError` naming the command. */
export async function gitChecked(
  cwd: string,
  args: string[],
  globalFlags: string[] = [],
): Promise<string> {
  try {
    return await git(cwd, args, globalFlags)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new GitError(`git ${args.join(' ')} failed: ${detail}`, 'EGIT')
  }
}
