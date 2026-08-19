import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { type AgentPort, decideCommand, type RawAgentUpdate } from '@vadd/core'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  sessionNotificationSchema,
  type ToolCallContent,
} from '@zed-industries/agent-client-protocol'
import { claudeCodeConfig } from './kinds/claude-code.js'
import type { AgentKindConfig } from './kinds/types.js'
import { decidePermission, isInsideWorktree, pathsFromToolCall } from './permissions.js'

let notificationSchemaRelaxed = false

/**
 * Stops the SDK from silently discarding session updates it cannot parse.
 *
 * `ClientSideConnection` validates every `session/update` against a strict zod
 * schema *before* dispatching it, and a parse failure throws instead of calling
 * the handler — so the update never reaches `onUpdate` and only the SDK's own
 * `console.error` records that anything happened.
 *
 * This is not hypothetical. agent-client-protocol@0.4.5 declares
 * `rawOutput: z.record(z.unknown())`, while claude-code-acp@0.16.2 sends
 * `rawOutput` as an array, and as a plain string when a tool fails. Six of
 * twenty-five updates were lost this way in the session recorded as M0's
 * evidence — including a tool failure, which is precisely the agent-flakiness
 * signal this milestone exists to measure.
 *
 * M0 stores updates raw (`RawAgentUpdate.update` is `unknown`), so client-side
 * validation buys nothing here and costs data. Well-formed updates still take
 * the validated path; the rest now pass through untouched instead of vanishing.
 * When M1's Output Contract starts narrowing these, it must do its own
 * validation rather than relying on the SDK's.
 */
function relaxNotificationSchema(): void {
  if (notificationSchemaRelaxed) return
  notificationSchemaRelaxed = true
  const target = sessionNotificationSchema as unknown as { parse: (p: unknown) => unknown }
  const strict = target.parse.bind(target)
  target.parse = (params: unknown) => {
    try {
      return strict(params)
    } catch {
      return params
    }
  }
}

export type PermissionDecision = {
  allowed: boolean
  paths: string[]
  command?: string
  reason?: string
}

/**
 * Raised into an in-flight `prompt()` when the port is stopped on purpose.
 *
 * Distinct from a crash so callers can report a turn that *we* ended rather
 * than one the agent lost — the difference matters to the flakiness signal
 * this milestone exists to collect.
 */
export class AgentStoppedError extends Error {
  constructor() {
    super('Agent was stopped before the turn finished')
    this.name = 'AgentStoppedError'
  }
}
export type ExitInfo = { code: number | null; signal: NodeJS.Signals | null; stderr: string }

export type AcpAgentPortOptions = {
  /** Root of the objective's worktree; the boundary for the permission policy. */
  worktreePath: string
  /** Which agent this port drives. Defaults to Claude Code — every existing
   * caller that never set this keeps today's exact behavior. */
  config?: AgentKindConfig
  /** Test seam. Omit in production so the pinned adapter is resolved by path. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  onPermission?: (d: PermissionDecision) => void
}

/**
 * Absolute path to the adapter's entry script.
 *
 * Never spawn `npx`. The Task 2 spike found that with `cwd` set to a worktree —
 * which has no `node_modules`, and that is every objective we create — npx falls
 * back to the public registry and silently runs an unrelated package of the same
 * name, with no error. Resolving against this module's own dependency graph is
 * independent of the child's cwd.
 *
 * See docs/superpowers/notes/acp-handshake.md, "Deviation from the brief's script".
 */
export function resolveAdapterBin(packageName: string): string {
  const missing = `Cannot find the ACP adapter for ${packageName}. Install it with: pnpm add -Dw ${packageName}`
  let pkgPath: string
  try {
    pkgPath = fileURLToPath(import.meta.resolve(`${packageName}/package.json`))
  } catch {
    throw new Error(missing)
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin ?? {})[0]
  if (!bin) throw new Error(missing)
  return resolve(dirname(pkgPath), bin)
}

export class AcpAgentPort implements AgentPort {
  #child?: ChildProcess
  #conn?: ClientSideConnection
  #stopped = false
  /** Last 20 lines of stderr, kept for the exit event. */
  #stderr: string[] = []
  readonly #updateSubs = new Set<(u: RawAgentUpdate) => void>()
  readonly #exitSubs = new Set<(e: ExitInfo) => void>()
  /** toolCallId → paths, harvested from the `tool_call` stream. */
  readonly #knownLocations = new Map<string, string[]>()
  /** Rejects an in-flight prompt when the process dies under it. */
  #rejectPending?: (err: Error) => void
  /** Rejects `start()` if the process dies before the handshake completes. */
  #rejectStart?: (err: Error) => void
  readonly #config: AgentKindConfig

  constructor(private readonly opts: AcpAgentPortOptions) {
    this.#config = opts.config ?? claudeCodeConfig()
  }

  /**
   * The adapter child's pid, or undefined before `start()`. Recorded on the
   * `agent_sessions` row (amendment A8) so boot reconciliation can kill an
   * orphan left by a `kill -9` — design §12 requires a crash-and-reboot leave
   * none, and a hard crash never runs any shutdown path.
   */
  get pid(): number | undefined {
    return this.#child?.pid
  }

  async start(): Promise<void> {
    // Tests inject `command`/`args`; production resolves the pinned adapter.
    const command = this.opts.command ?? process.execPath
    let args: string[]
    if (this.opts.command) {
      args = this.opts.args ?? []
    } else {
      // resolveAdapterBin's own error is generic (it doesn't know which agent
      // kind is asking); translate to the config's install instruction so a
      // missing adapter reads the same whether it's caught here (package not
      // resolvable at all) or in the spawn ENOENT handler below (resolves but
      // isn't actually runnable).
      try {
        args = [resolveAdapterBin(this.#config.packageName)]
      } catch {
        throw new Error(this.#config.missingAdapterMessage)
      }
    }

    const child = spawn(command, args, {
      cwd: this.opts.worktreePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.opts.env },
    })
    this.#child = child

    child.stderr?.on('data', (b: Buffer) => {
      this.#stderr.push(...b.toString().split('\n'))
      if (this.#stderr.length > 20) this.#stderr = this.#stderr.slice(-20)
    })

    child.on('error', (err) => {
      // ENOENT means the adapter is not installed. Design §5 requires a
      // one-line install instruction here, not a raw spawn stack trace.
      const isMissing = (err as NodeJS.ErrnoException).code === 'ENOENT'
      this.#fail(
        new Error(
          isMissing
            ? this.#config.missingAdapterMessage
            : `Failed to spawn ${command}: ${err.message}`,
        ),
      )
    })

    child.on('exit', (code, signal) => {
      const info: ExitInfo = { code, signal, stderr: this.#stderr.join('\n') }
      for (const cb of this.#exitSubs) cb(info)
      if (!this.#stopped) {
        // No auto-restart in M0 (design §5): resumption is M1's work, and a
        // silent restart would hide exactly the flakiness we are measuring.
        this.#fail(new Error(`Agent exited unexpectedly (code ${code}, signal ${signal})`))
      }
    })

    if (!child.stdin || !child.stdout) throw new Error('Agent process has no stdio pipes')

    // ndJsonStream(output, input): output is what we write (child stdin),
    // input is what we read (child stdout). Reversing these hangs silently.
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    )

    relaxNotificationSchema()
    this.#conn = new ClientSideConnection(() => this.#client(), stream)

    // Race the handshake against process death: a missing or immediately
    // crashing adapter must reject here rather than hang.
    const died = new Promise<never>((_, reject) => {
      this.#rejectStart = reject
    })
    try {
      await Promise.race([
        this.#conn.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: false,
          },
        }),
        died,
      ])
    } finally {
      this.#rejectStart = undefined
    }
  }

  #client() {
    return {
      sessionUpdate: async (params: { sessionId: string; update: unknown }) => {
        this.#rememberLocations(params.update)
        const u: RawAgentUpdate = {
          sessionId: params.sessionId,
          receivedAt: new Date().toISOString(),
          update: params.update,
        }
        for (const cb of this.#updateSubs) cb(u)
      },

      requestPermission: async (params: {
        options: { optionId: string; kind: string }[]
        toolCall: {
          toolCallId?: string
          locations?: { path: string }[] | null
          rawInput?: Record<string, unknown>
          // The real, pinned SDK's own type for this field — a `ToolCallContent`
          // union of content-block/diff/terminal variants, only the "diff" arm
          // of which carries `path`. `pathsFromToolCall` only reads a `path` off
          // whatever's here (and drops anything that doesn't have one), so it's
          // narrowed to just that shape at the call site below.
          content?: ToolCallContent[] | null
        }
      }) => {
        // Amendment A3: a tool carrying a command (Bash and friends have no
        // `locations` and no path-bearing `rawInput`, which used to fail closed
        // outright) is evaluated against the command denylist instead of the
        // path policy. Everything else — including a tool with neither — falls
        // through to M0's path policy, which already fails closed on an empty
        // path set.
        const rawCommand = params.toolCall.rawInput?.command
        const command =
          typeof rawCommand === 'string' && rawCommand.trim() !== '' ? rawCommand : undefined

        let allowed: boolean
        let reason: string | undefined
        let paths: string[] = []
        if (command) {
          ;({ allowed, reason } = decideCommand(command, this.opts.worktreePath))
        } else {
          paths = pathsFromToolCall(
            params.toolCall as {
              toolCallId?: string
              locations?: { path: string }[] | null
              rawInput?: Record<string, unknown>
              content?: { path?: string }[] | null
            },
            this.#knownLocations,
          )
          ;({ allowed, reason } = decidePermission(this.opts.worktreePath, paths))
        }
        this.opts.onPermission?.({ allowed, paths, command, reason })

        // An allow is only ever granted ONCE. The previous fallback to
        // `allow_always` was a containment kill-switch: in this adapter that
        // option maps to `acceptEdits`, which sets the session's permission mode
        // and thereafter bypasses requestPermission entirely for every Edit and
        // Write — so one missing `allow_once` would have silently disabled the
        // whole policy for the rest of the session. Not reachable with the
        // pinned 0.16.2, which always offers `allow_once`, but a policy whose
        // job is containment must not have a broader grant as its fallback.
        //
        // Rejection may still fall back to `reject_always`: that is strictly
        // more restrictive, so it fails in the safe direction.
        const option = allowed
          ? params.options.find((o) => o.kind === 'allow_once')
          : (params.options.find((o) => o.kind === 'reject_once') ??
            params.options.find((o) => o.kind === 'reject_always'))
        if (!option) return { outcome: { outcome: 'cancelled' as const } }
        return { outcome: { outcome: 'selected' as const, optionId: option.optionId } }
      },

      readTextFile: async (params: { path: string }) => {
        this.#assertInside(params.path)
        return { content: await readFile(params.path, 'utf8') }
      },

      writeTextFile: async (params: { path: string; content: string }) => {
        this.#assertInside(params.path)
        await writeFile(params.path, params.content)
        return {}
      },
    }
  }

  /**
   * Records `toolCallId → paths` off the `tool_call` stream so a later
   * `requestPermission` for the same id can be judged even when its own
   * request carries none of them — the exact case the spike observed for
   * Claude Code's `locations`, and the exact case the real, installed
   * `@agentclientprotocol/codex-acp@1.4.0` hits structurally for every file
   * edit: `CodexToolCallMapper.createFileChangeUpdate` puts each changed
   * file's path on this notification's `content[].path`, and
   * `CodexApprovalHandler.buildFileChangePermissionRequest` sends a
   * `toolCall` with no `locations` and no `content` at all — so without this,
   * `pathsFromToolCall` at the request site always comes back empty and
   * `decidePermission` fails closed on every Codex edit. `pathsFromToolCall`
   * already knows how to read every source (`locations`, `content`,
   * `rawInput`), so this delegates to it rather than re-implementing one of
   * its branches by hand. Ordering is safe: the adapter's own
   * `waitForSessionNotifications` blocks the approval handler on the pending
   * notification queue for the same session, so this notification is always
   * processed before the matching permission request arrives.
   */
  #rememberLocations(update: unknown): void {
    const u = update as {
      sessionUpdate?: string
      toolCallId?: string
      locations?: { path: string }[] | null
      rawInput?: Record<string, unknown>
      content?: { path?: string }[] | null
    }
    if (u?.sessionUpdate !== 'tool_call' || !u.toolCallId) return
    const paths = pathsFromToolCall(u)
    if (paths.length > 0) this.#knownLocations.set(u.toolCallId, paths)
  }

  #assertInside(path: string): void {
    if (!isInsideWorktree(this.opts.worktreePath, path)) {
      // Same `reason` shape the requestPermission path logs. Without it this
      // rejection reached the event log with reason undefined, while the
      // milestone requires every refusal to be logged with why.
      const reason = `Outside the objective worktree: ${path}`
      this.opts.onPermission?.({ allowed: false, paths: [path], reason })
      throw new Error(`Path is outside the objective worktree: ${path}`)
    }
  }

  /**
   * Surfaces a process-level failure to whoever is currently waiting. Both
   * hooks matter: without `#rejectStart`, a spawn ENOENT would leave
   * `initialize()` awaiting a reply that can never arrive.
   */
  #fail(err: Error): void {
    this.#rejectStart?.(err)
    this.#rejectStart = undefined
    this.#rejectPending?.(err)
    this.#rejectPending = undefined
  }

  async newSession(o: { cwd: string }): Promise<{ sessionId: string }> {
    if (!this.#conn) throw new Error('AgentPort.start() has not been called')
    const res = await this.#conn.newSession({ cwd: o.cwd, mcpServers: [] })
    return { sessionId: res.sessionId }
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
    if (!this.#conn) throw new Error('AgentPort.start() has not been called')
    const conn = this.#conn

    // Race the prompt against process death so a crash rejects instead of hanging.
    const died = new Promise<never>((_, reject) => {
      this.#rejectPending = reject
    })
    try {
      const res = await Promise.race([
        conn.prompt({ sessionId, prompt: [{ type: 'text', text }] }),
        died,
      ])
      return { stopReason: res.stopReason }
    } finally {
      this.#rejectPending = undefined
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#conn?.cancel({ sessionId })
  }

  async stop(): Promise<void> {
    if (this.#stopped) return
    this.#stopped = true

    // Settle any in-flight turn. The exit handler deliberately skips #fail()
    // once #stopped is set, and the pinned SDK does not reject pending requests
    // when the stream closes — so without this the prompt promise never
    // settles at all: discarding mid-turn emitted no terminal event, the page
    // showed the turn running forever, and the promise leaked with its closure.
    this.#rejectPending?.(new AgentStoppedError())
    this.#rejectPending = undefined

    const child = this.#child
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }

  onUpdate(cb: (u: RawAgentUpdate) => void): () => void {
    this.#updateSubs.add(cb)
    return () => {
      this.#updateSubs.delete(cb)
    }
  }

  onExit(cb: (e: ExitInfo) => void): () => void {
    this.#exitSubs.add(cb)
    return () => {
      this.#exitSubs.delete(cb)
    }
  }
}
