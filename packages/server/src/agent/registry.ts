import { randomUUID } from 'node:crypto'
import type { AgentPort } from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agentSessions } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import type { ExitInfo, PermissionDecision } from './acp-agent-port.js'
import { AcpAgentPort } from './acp-agent-port.js'
import { ensureAgentProfile } from './profile.js'

type PortWithExit = AgentPort & { onExit?(cb: (e: ExitInfo) => void): () => void }

/**
 * `onPermission` is supplied by the registry, not chosen by the factory, so the
 * permission-logging path is identical in production and under test. A factory
 * that built its own callback would let the two diverge silently — and the
 * milestone requires every out-of-worktree rejection to be logged.
 */
export type PortFactory = (o: {
  worktreePath: string
  objectiveId: string
  onPermission: (d: PermissionDecision) => void
}) => PortWithExit

type Entry = { port: PortWithExit; sessionId: string; rowId: string }

export type ObjectiveRef = { id: string; worktreePath: string | null }

/**
 * Owns one live AgentPort per objective. Tests inject `factory` to back the
 * port with the fake ACP peer instead of spawning the real adapter.
 */
export class AgentRegistry {
  readonly #live = new Map<string, Entry>()
  /** Starts that have been requested but have not yet reached `#live`. */
  readonly #starting = new Map<string, Promise<Entry>>()
  private readonly factory: PortFactory

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    factory?: PortFactory,
  ) {
    this.factory =
      factory ??
      (({ worktreePath, onPermission }) =>
        new AcpAgentPort({
          worktreePath,
          onPermission,
          // Isolation, not preference: with the user's global ~/.claude in
          // scope, third-party skills load into VADD sessions and contaminate
          // the eval corpus the M1 gate reads (vadd-spec-phase2.md §2).
          env: { CLAUDE_CONFIG_DIR: ensureAgentProfile() },
        }))
  }

  /**
   * Starting an agent spans two awaits (spawn, then handshake), so a bare
   * check-then-set on `#live` is not atomic: two concurrent prompts — a
   * double-click on Send is enough — both missed, both spawned, and the second
   * `set` overwrote the first. The first port then became unreachable, so
   * `stop()` and `stopAll()` could never kill it, leaving an orphan adapter and
   * two agents editing one worktree.
   *
   * The in-flight promise is recorded synchronously, before any await, so a
   * second caller joins the first start instead of racing it.
   */
  async ensure(objective: ObjectiveRef): Promise<Entry> {
    const existing = this.#live.get(objective.id)
    if (existing) return existing

    const inFlight = this.#starting.get(objective.id)
    if (inFlight) return inFlight

    if (!objective.worktreePath) throw new Error('Objective has no worktree')

    const startup = this.#start({ ...objective, worktreePath: objective.worktreePath })
    this.#starting.set(objective.id, startup)
    try {
      return await startup
    } finally {
      this.#starting.delete(objective.id)
    }
  }

  async #start(objective: ObjectiveRef & { worktreePath: string }): Promise<Entry> {
    // Answering the agent's permission callbacks is not enough on its own: the
    // milestone requires an out-of-worktree request to be rejected *and logged*,
    // and the decision's `reason` is the only record of why it was refused.
    const port = this.factory({
      worktreePath: objective.worktreePath,
      objectiveId: objective.id,
      onPermission: (d) =>
        this.bus.emit({ objectiveId: objective.id, type: 'permission_decision', payload: d }),
    })

    port.onUpdate((u) => {
      this.bus.emit({ objectiveId: objective.id, type: 'agent_update', payload: u })
    })

    port.onExit?.((info) => {
      // `stop()` removes the entry from #live *before* killing the child, so an
      // exit that still finds an entry here was not intentional. Emitting
      // unconditionally would write a false crash on every discard and corrupt
      // the agent-flakiness signal this milestone exists to measure.
      const entry = this.#live.get(objective.id)
      if (!entry) return

      this.db
        .update(agentSessions)
        .set({ status: 'failed', endedAt: new Date().toISOString() })
        .where(eq(agentSessions.id, entry.rowId))
        .run()
      this.#live.delete(objective.id)
      this.bus.emit({
        objectiveId: objective.id,
        type: 'agent_failed',
        payload: { code: info.code, signal: info.signal, stderr: info.stderr },
      })
    })

    await port.start()
    const { sessionId } = await port.newSession({ cwd: objective.worktreePath })

    const rowId = randomUUID()
    this.db
      .insert(agentSessions)
      .values({
        id: rowId,
        objectiveId: objective.id,
        acpSessionId: sessionId,
        status: 'running',
        startedAt: new Date().toISOString(),
        endedAt: null,
      })
      .run()

    const entry: Entry = { port, sessionId, rowId }
    this.#live.set(objective.id, entry)
    this.bus.emit({
      objectiveId: objective.id,
      type: 'agent_session_started',
      payload: { sessionId },
    })
    return entry
  }

  get(objectiveId: string): Entry | undefined {
    return this.#live.get(objectiveId)
  }

  async stop(objectiveId: string): Promise<void> {
    // A discard can land while the adapter is still handshaking. Without this
    // wait, `#live` is still empty, stop() returns having done nothing, and the
    // child that finishes starting a moment later is an orphan no one holds a
    // reference to. Swallow the start's failure — a start that threw has no
    // child to stop.
    const starting = this.#starting.get(objectiveId)
    if (starting) await starting.catch(() => undefined)

    const entry = this.#live.get(objectiveId)
    if (!entry) return
    this.#live.delete(objectiveId)
    await entry.port.stop()
    this.db
      .update(agentSessions)
      .set({ status: 'stopped', endedAt: new Date().toISOString() })
      .where(eq(agentSessions.id, entry.rowId))
      .run()
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#live.keys()].map((id) => this.stop(id)))
  }
}
