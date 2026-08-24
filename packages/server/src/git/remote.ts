import { execa } from 'execa'
import { git } from './run.js'

/**
 * A failure of a network-capable git command.
 *
 * Distinct from `GitError` so the routes can answer 502 rather than 500: "your
 * remote rejected this" and "VADD did something wrong" are different facts and
 * need different responses from the user.
 */
export class RemoteError extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean,
  ) {
    super(message)
    this.name = 'RemoteError'
  }
}

export type RemoteInfo = { name: string; fetchUrl: string; pushUrl: string }

/** Generous: a first fetch of a large repository is legitimately slow. */
const DEFAULT_TIMEOUT_MS = 120_000
/** How long a SIGTERM is given before the group is killed outright. */
const GRACE_MS = 5_000

/**
 * The environment that makes a credential failure fail *fast*.
 *
 * A network git command run from a server process can block forever: with no
 * TTY, git may still attempt a terminal prompt over HTTPS, and `ssh` may
 * prompt for a key passphrase. There is nobody to type an answer and no way to
 * surface the prompt, so the request hangs and the wrapper never reports.
 *
 * `GIT_ASKPASS` is set empty because it is consulted BEFORE any terminal
 * prompt and an askpass helper needs no TTY, so `GIT_TERMINAL_PROMPT=0`
 * alone does not stop it — measured hanging indefinitely against a server
 * that returns 401 while every other mitigation here was in place. `execa`
 * merges `env` with `process.env`, so a user's own askpass (GNOME keyring,
 * Git Credential Manager, an IDE integration) is inherited into this child
 * unless it is overridden here.
 *
 * `StrictHostKeyChecking` is deliberately left alone: auto-accepting an
 * unknown host key is a security decision that is not VADD's to make silently,
 * and in batch mode an unknown host fails with a message the user recognises.
 */
const NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  GIT_ASKPASS: '',
} as const

function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, signal)
  } catch {
    // ESRCH: the group is already gone, which is the outcome we wanted.
  }
}

/**
 * Runs one network-capable git command under a real time bound.
 *
 * **This is the only function in the codebase permitted to issue a git
 * subcommand that can reach a network**, and `network-allowlist.test.ts`
 * enforces that. Everything else goes through `run.ts`'s local `git`.
 *
 * `detached: true` makes the child a process-group leader, which is what makes
 * `kill(-pid)` reach every descendant — including the transport helper git
 * spawns. `execa`'s own `timeout` signals only the process it started; phase 4
 * measured that leaving a `sleep 5` alive under a 1s timeout for the full 5006ms.
 */
export async function gitRemote(
  cwd: string,
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const child = execa('git', ['-C', cwd, ...args], {
    env: NO_PROMPT_ENV,
    all: true,
    reject: false,
    detached: true,
  })

  let timedOut = false
  let escalation: NodeJS.Timeout | undefined
  const timer = setTimeout(() => {
    timedOut = true
    killGroup(child.pid, 'SIGTERM')
    escalation ??= setTimeout(() => killGroup(child.pid, 'SIGKILL'), GRACE_MS)
    escalation.unref()
  }, timeoutMs)

  try {
    const result = await child
    if (timedOut) {
      throw new RemoteError(`git ${args.join(' ')} timed out after ${timeoutMs}ms`, true)
    }
    if (result.exitCode !== 0) {
      throw new RemoteError(`git ${args.join(' ')} failed: ${result.all ?? ''}`.trim(), false)
    }
    return result.stdout
  } finally {
    clearTimeout(timer)
    if (escalation) clearTimeout(escalation)
  }
}

/**
 * The remotes this repository already has. Reads `.git/config`; no network.
 *
 * Names come from `git remote` one per line, then each url is asked for by
 * name rather than parsed out of `git remote -v`'s two-lines-per-remote
 * `name<TAB>url (fetch)` format — a url containing a space or a parenthesis
 * makes that format ambiguous, and this is the list every argument guard in
 * Pass C validates against.
 */
export async function listRemotes(repoPath: string): Promise<RemoteInfo[]> {
  const names = (await gitRemote(repoPath, ['remote']))
    .split('\n')
    .map((n) => n.trim())
    .filter((n) => n !== '')

  const out: RemoteInfo[] = []
  for (const name of names) {
    const fetchUrl = (await gitRemote(repoPath, ['remote', 'get-url', name])).trim()
    const pushUrl = (await gitRemote(repoPath, ['remote', 'get-url', '--push', name])).trim()
    out.push({ name, fetchUrl, pushUrl })
  }
  return out
}

/**
 * Updates remote-tracking refs. Touches no local branch and no working tree,
 * which is why the in-flight gate does not apply to it.
 */
export async function fetchRemote(repoPath: string, remote: string): Promise<void> {
  await gitRemote(repoPath, ['fetch', remote])
}

/**
 * Fast-forwards the worktree's current branch from `remote`.
 *
 * `--ff-only` is load-bearing, not a default. Dropping it does not produce a
 * loud failure: measured against a divergent branch, git made a clean merge
 * commit and exited 0, advancing HEAD with nothing to indicate a merge had
 * happened. A conflict is the case people expect; a silent merge is the one
 * that costs, and neither has a UI in this pass — conflict resolution is out
 * of scope (Pass B's §11). It also underwrites a guarantee elsewhere: a
 * fast-forward only advances a ref along existing history, so it invalidates
 * no recorded `checkpointRef` and needs no repair step.
 *
 * The branch is resolved and passed explicitly (via `run.ts`'s local,
 * network-free `git`) rather than left for `git pull` to infer, because a
 * VADD-created branch has no `branch.<name>.merge` upstream config — it was
 * never cloned into existence — and a bare `git pull --ff-only <remote>`
 * against one refuses with "you must specify a branch", found by running
 * this against a real repo rather than assumed.
 */
export async function pullFastForward(worktreePath: string, remote: string): Promise<void> {
  const branch = (await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  await gitRemote(worktreePath, ['pull', '--ff-only', remote, branch])
}

/**
 * Publishes `branch` to `remote`.
 *
 * No force, in any form, including `--force-with-lease`: it is irreversible on
 * a machine VADD does not control, and it sits outside the undo model
 * entirely — which is exactly why push declares `undoable: false`. A push that
 * would not fast-forward the remote is refused by git itself, and that refusal
 * is the correct outcome rather than something to work around.
 *
 * `--set-upstream` only when the caller explicitly asked. Inferring it would
 * silently give a branch a tracking relationship the user never chose, which
 * then changes what a later bare `pull` means.
 */
export async function pushBranch(
  worktreePath: string,
  remote: string,
  branch: string,
  setUpstream: boolean,
): Promise<void> {
  const args = ['push']
  if (setUpstream) args.push('--set-upstream')
  args.push(remote, branch)
  await gitRemote(worktreePath, args)
}
