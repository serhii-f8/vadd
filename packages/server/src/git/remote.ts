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
  /**
   * The HTTP status this failure deserves, read back by `declaredStatus`.
   *
   * Carried on the error rather than encoded into its message: the route only
   * ever sees `withGitMutation`'s stringified `error`, and a message that
   * legitimately begins with "502:" would be indistinguishable from a tag.
   *
   * Fixed at 502, which is the whole point of the class — the remote refused,
   * VADD did not fail. A local condition that blocks a remote operation
   * before it starts is a different fact and gets its own error type
   * (`WorktreeStateError`); carrying it here would make the class name a lie.
   */
  readonly status = 502

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
 * The ssh command the user's own git would have used, before VADD adds to it.
 *
 * Reproduces git's own precedence, measured on git 2.43.0 rather than assumed:
 * with `GIT_SSH_COMMAND` exported, a repository's `core.sshCommand` was not
 * consulted at all (a fake ssh recording its argv was never invoked); with the
 * env var unset it was, and ran as `-i <key> ... git@host git-upload-pack ...`.
 *
 * `GIT_SSH` — the legacy variable naming a bare program path rather than a
 * shell string — is deliberately NOT composed here, and a user who sets only
 * that one still has it superseded by the value below. Composing it would mean
 * shell-quoting a path under rules that differ from how git itself reads the
 * variable, and the realistic configurations (`core.sshCommand`,
 * `GIT_SSH_COMMAND`) are both already shell strings. Recorded rather than
 * silently papered over; design §4 states the same limitation.
 */
async function userSshCommand(cwd: string): Promise<string> {
  const fromEnv = process.env.GIT_SSH_COMMAND
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  try {
    const configured = (await git(cwd, ['config', '--get', 'core.sshCommand'])).trim()
    if (configured !== '') return configured
  } catch {
    // `config --get` exits 1 when the key is unset, which `execa` throws on.
  }
  return 'ssh'
}

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
 * unless it is overridden here. That override IS deliberate: an askpass
 * helper's whole purpose is to answer a prompt interactively, which is the
 * one thing this process cannot allow.
 *
 * `GIT_SSH_COMMAND` is COMPOSED, not replaced, and that is the difference
 * between this override and the askpass one. A fixed `ssh -o BatchMode=yes`
 * discards the user's own `core.sshCommand` wholesale — measured: a repo
 * configured with `-i <key>` saw its ssh command silently unused, which for a
 * real user means `Permission denied (publickey)` reported by VADD as a 502
 * blaming the remote for VADD's own substitution. Design §4 and amendment A20
 * both promise VADD "inherits whatever the user's own git already uses", so
 * the user's string is kept and `-o BatchMode=yes` appended to it: git
 * shell-interprets the value, so a trailing option binds as one more argument
 * (measured: `-i <key> -o BatchMode=yes ... git@host`). A `plink`-style
 * command that does not understand `-o` would be broken by the append — but
 * it was equally broken by the wholesale replacement it replaces.
 *
 * `StrictHostKeyChecking` is deliberately left alone: auto-accepting an
 * unknown host key is a security decision that is not VADD's to make silently,
 * and in batch mode an unknown host fails with a message the user recognises.
 *
 * Costs one extra local `git config` subprocess per network call. Measured in
 * milliseconds against a network operation bounded at two minutes, and the
 * alternative — caching per cwd — would hold a stale answer across a user
 * editing their own config.
 */
async function noPromptEnv(cwd: string): Promise<Record<string, string>> {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: `${await userSshCommand(cwd)} -o BatchMode=yes`,
    GIT_ASKPASS: '',
  }
}

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
    env: await noPromptEnv(cwd),
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
 * A url with any userinfo replaced by `***`, for display only.
 *
 * A remote url may embed a live credential — `https://user:token@host/x.git`,
 * and also `https://<token>@host/x.git`, where the whole userinfo *is* the
 * secret and there is no `:` to split on. VADD stores no credentials and
 * offers no field to enter one, so a token reaching the browser could only
 * ever have come from the user's own config; it would still be painted on
 * screen, and this project records demo GIFs of that screen. The whole
 * userinfo goes, not just the part after a colon, because either half can be
 * the secret.
 *
 * Anchored on `scheme://` deliberately. An scp-style remote,
 * `git@github.com:me/x.git`, contains an `@` and NO credential — it is the
 * ordinary ssh form — and a regex that merely strips everything before an `@`
 * mangles it into nonsense. It has no `://`, so it never matches here.
 * A local path (`/tmp/vadd-bare-xxxx`) has no `://` either.
 *
 * `[^/]+` is greedy and still cannot cross a `/`, so it takes the LAST `@`
 * before the path: an unencoded `@` inside a password
 * (`https://a:p@ssword@h/x`) is consumed rather than leaving `ssword@h` on
 * screen. Defence in depth rather than a live leak — git 2.43 rejects that
 * url outright ("URL rejected: Bad hostname"), measured, so no working
 * credential has this shape today. A url whose *path* contains an `@`
 * (`https://host/me/x@y.git`) still cannot match, because the class stops at
 * the first `/`.
 */
const URL_USERINFO = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/]+@/

function redactUserinfo(url: string): string {
  return url.replace(URL_USERINFO, '$1***@')
}

/**
 * `--` before every caller-supplied remote name, so git reads it as a value.
 *
 * Amendment A20 rests on "no route accepts a URL": every operation takes a
 * remote *name* validated against `git remote`'s own list. That guard was
 * written believing a listed name could not be option-shaped. **Measured on
 * git 2.43.0, it can:** `git remote add -- '--upload-pack=/bin/echo'
 * /tmp/nowhere.git` succeeds, `git remote` then prints the name verbatim, and
 * `git fetch '--upload-pack=/bin/echo'` really did execute `/bin/echo` as the
 * transport (`fatal: protocol error: bad line length character: /tmp` — that
 * is echo's own output being read as git protocol). With `--` in front, the
 * same argv resolves the configured url instead and fails as a value
 * (`fatal: '/tmp/nowhere.git' does not appear to be a git repository`).
 *
 * Reaching that state requires the user's own hostile `.git/config`, so the
 * practical risk is low — but the claim that a list-validated name cannot be
 * an option sits in the permanent spec, and this project records what was
 * observed rather than what was assumed. All three forms were verified to
 * parse: `fetch -- <remote>`, `pull --ff-only -- <remote> <branch>`,
 * `push [--set-upstream] -- <remote> <branch>`.
 */
const END_OF_OPTIONS = {
  fetch: ['fetch', '--'],
  pull: ['pull', '--ff-only', '--'],
} as const

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
    // Redacted here rather than in the UI: this is the only place a remote
    // url is read, so redacting at the source means no later caller has to
    // remember to. Nothing is lost functionally — every git argument VADD
    // builds names a remote by NAME and lets git read the url out of the
    // repository's own config, so no redacted string is ever passed back.
    const fetchUrl = redactUserinfo(
      (await gitRemote(repoPath, ['remote', 'get-url', '--', name])).trim(),
    )
    const pushUrl = redactUserinfo(
      (await gitRemote(repoPath, ['remote', 'get-url', '--push', '--', name])).trim(),
    )
    out.push({ name, fetchUrl, pushUrl })
  }
  return out
}

/**
 * Updates remote-tracking refs. Touches no local branch and no working tree,
 * which is why the in-flight gate does not apply to it.
 *
 * See `END_OF_OPTIONS` for why the `--` is load-bearing rather than habit.
 */
export async function fetchRemote(repoPath: string, remote: string): Promise<void> {
  await gitRemote(repoPath, [...END_OF_OPTIONS.fetch, remote])
}

/**
 * A local condition that blocks a remote operation before it starts.
 *
 * 409, following the design's taxonomy: 400 is a malformed argument, and a
 * detached HEAD's arguments are all perfectly well-formed — it is a *state*
 * that blocks the operation, the same category as the in-flight gate refusing
 * a busy objective. 502 would be worse still, naming a remote that was never
 * asked anything.
 *
 * Deliberately not a `RemoteError` with a different status: an error class
 * called `RemoteError` carrying a purely local condition misleads whoever
 * reads it next. It needs no shared base and no export — `declaredStatus` is
 * duck-typed precisely so that any thrown error can name its own status.
 */
class WorktreeStateError extends Error {
  readonly status = 409

  constructor(message: string) {
    super(message)
    this.name = 'WorktreeStateError'
  }
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
 * A detached HEAD is refused rather than half-supported: see the guard below
 * for what `--abbrev-ref` actually returns in that case.
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
  if (branch === 'HEAD') {
    // `rev-parse --abbrev-ref HEAD` answers the literal string `HEAD` on a
    // detached HEAD, so without this guard the line below runs
    // `git pull --ff-only <remote> HEAD`. Measured by removing the guard:
    // `fatal: couldn't find remote ref HEAD`, which the route then reported
    // as a 502 — blaming the remote for a purely local condition. Refused
    // instead of half-supported, the same way squash/reword/drop refuse a
    // mid-branch sha.
    throw new WorktreeStateError(
      'This worktree is on a detached HEAD, so there is no branch to fast-forward. ' +
        'Check out a branch first.',
    )
  }
  await gitRemote(worktreePath, [...END_OF_OPTIONS.pull, remote, branch])
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
  // `--` last, after every option this function adds: it ends option parsing,
  // so anything before it is still read as an option and anything after it is
  // not. See `END_OF_OPTIONS`.
  args.push('--', remote, branch)
  await gitRemote(worktreePath, args)
}
