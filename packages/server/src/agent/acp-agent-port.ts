import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { AgentPort, RawAgentUpdate } from '@vadd/core'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@zed-industries/agent-client-protocol'
import { decidePermission, isInsideWorktree, pathsFromToolCall } from './permissions.js'

export type PermissionDecision = { allowed: boolean; paths: string[]; reason?: string }
export type ExitInfo = { code: number | null; signal: NodeJS.Signals | null; stderr: string }

export type AcpAgentPortOptions = {
  /** Root of the objective's worktree; the boundary for the permission policy. */
  worktreePath: string
  /** Test seam. Omit in production so the pinned adapter is resolved by path. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  onPermission?: (d: PermissionDecision) => void
}

/**
 * Absolute path to the pinned adapter's entry script.
 *
 * Never spawn `npx claude-code-acp`. The Task 2 spike found that with `cwd`
 * set to a worktree — which has no `node_modules`, and that is every objective
 * we create — npx falls back to the public registry and silently runs an
 * unrelated package of the same name, with no error. Resolving against this
 * module's own dependency graph is independent of the child's cwd.
 *
 * See docs/superpowers/notes/acp-handshake.md, "Deviation from the brief's script".
 */
function resolveAdapterBin(): string {
  const missing =
    'Cannot find the Claude Code ACP adapter. Install it with: pnpm add -Dw @zed-industries/claude-code-acp@0.16.2'
  let pkgPath: string
  try {
    pkgPath = fileURLToPath(import.meta.resolve('@zed-industries/claude-code-acp/package.json'))
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

  constructor(private readonly opts: AcpAgentPortOptions) {}

  async start(): Promise<void> {
    // Tests inject `command`/`args`; production resolves the pinned adapter.
    const command = this.opts.command ?? process.execPath
    const args = this.opts.command ? (this.opts.args ?? []) : [resolveAdapterBin()]

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
            ? `Cannot find the Claude Code ACP adapter. Install it with: pnpm add -Dw @zed-industries/claude-code-acp@0.16.2`
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
        }
      }) => {
        const paths = pathsFromToolCall(params.toolCall, this.#knownLocations)
        const { allowed, reason } = decidePermission(this.opts.worktreePath, paths)
        this.opts.onPermission?.({ allowed, paths, reason })

        const wanted = allowed ? 'allow_once' : 'reject_once'
        const option =
          params.options.find((o) => o.kind === wanted) ??
          params.options.find((o) => o.kind === (allowed ? 'allow_always' : 'reject_always'))
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
   * Records `toolCallId → locations` off the `tool_call` stream so a later
   * `requestPermission` for the same id can be judged even when its own
   * `toolCall.locations` is missing — the exact case the spike observed.
   */
  #rememberLocations(update: unknown): void {
    const u = update as {
      sessionUpdate?: string
      toolCallId?: string
      locations?: { path: string }[] | null
    }
    if (u?.sessionUpdate !== 'tool_call' || !u.toolCallId) return
    const paths = (u.locations ?? []).map((l) => l.path).filter(Boolean)
    if (paths.length > 0) this.#knownLocations.set(u.toolCallId, paths)
  }

  #assertInside(path: string): void {
    if (!isInsideWorktree(this.opts.worktreePath, path)) {
      this.opts.onPermission?.({ allowed: false, paths: [path] })
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
