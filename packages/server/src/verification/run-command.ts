import { execa } from 'execa'

export type CommandRun = {
  output: string
  exitCode: number
  timedOut: boolean
  /** True when an `AbortSignal` stopped this command before it finished. */
  aborted: boolean
}

/** How long a SIGTERM is given to work before the group is killed outright. */
const GRACE_MS = 5_000

/**
 * Kills the whole process group, not just the leader.
 *
 * `execa`'s own `timeout` and `cancelSignal` signal the *shell* VADD spawned,
 * and a shell dying does not take `phpunit` — or `vitest`, or `sleep` — with
 * it. Worse, the surviving grandchild holds the output pipe open, so `await`
 * on the subprocess resolves only when the command finishes naturally: a
 * `timeoutSec` of 60 against a suite that runs for ten minutes waited the full
 * ten minutes and then reported a timeout. Measured, not theorised — `sleep 5`
 * under a 1s timeout took 5006ms, and left the `sleep` running.
 *
 * `detached: true` makes the shell a process-group leader, which is what makes
 * `kill(-pid)` reach every descendant.
 */
function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, signal)
  } catch {
    // ESRCH: the group is already gone, which is the outcome we wanted.
  }
}

/**
 * Runs one shell command under a real time bound, in its own process group.
 *
 * Never rejects for an ordinary non-zero exit — a failing suite is a result,
 * not an exception. A spawn failure (a `cwd` that does not exist, say) still
 * throws, and both callers turn that into a `fail` row with the message.
 */
export async function runCommand(
  run: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandRun> {
  const child = execa(run, { shell: true, cwd, all: true, reject: false, detached: true })

  let timedOut = false
  let escalation: NodeJS.Timeout | undefined
  const stop = (): void => {
    killGroup(child.pid, 'SIGTERM')
    escalation ??= setTimeout(() => killGroup(child.pid, 'SIGKILL'), GRACE_MS)
    // Nothing should be kept alive purely to deliver a follow-up kill.
    escalation.unref()
  }

  const timer = setTimeout(() => {
    timedOut = true
    stop()
  }, timeoutMs)
  const onAbort = (): void => stop()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const result = await child
    return {
      output: result.all ?? '',
      // A signalled process reports no exit code; it did not pass, so 1.
      exitCode: result.exitCode ?? 1,
      timedOut,
      aborted: signal?.aborted === true,
    }
  } finally {
    clearTimeout(timer)
    if (escalation) clearTimeout(escalation)
    signal?.removeEventListener('abort', onAbort)
  }
}
