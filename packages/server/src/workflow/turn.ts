import { randomUUID } from 'node:crypto'
import type { AgentEventType } from '@vadd/core'
import { eq } from 'drizzle-orm'
import { AgentStoppedError } from '../agent/acp-agent-port.js'
import type { AgentRegistry } from '../agent/registry.js'
import type { Db } from '../db/client.js'
import { settings } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { errorMessage } from '../http/routes/objectives.js'
import {
  loadTemplate,
  type PromptTemplate,
  placeholdersIn,
  renderTemplate,
} from '../prompts/renderer.js'
import { buildRepairPrompt } from '../prompts/repair-prompt.js'

export class TurnRejected extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'TurnRejected'
  }
}

export type TurnOutcome =
  | { ok: true; turnId: string }
  | { ok: false; turnId: string; reason: 'timeout' | 'agent_crash' | 'error'; message: string }

/**
 * Design §6.6: M0's `prompt()` can hang indefinitely, and a wedged agent must
 * surface as a failed task rather than a spinner. Default 20 minutes,
 * configurable in settings.
 */
export function turnTimeoutMs(db: Db): number {
  const row = db.select().from(settings).where(eq(settings.key, 'turnTimeoutSec')).get()
  const seconds = typeof row?.value === 'number' ? row.value : Number.NaN
  // A bad setting must not silently disable the timeout — that is the exact
  // wedge this exists to prevent.
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 20 * 60 * 1000
}

type Deps = { db: Db; bus: EventBus; agents: AgentRegistry }
type ObjectiveRef = { id: string; title: string; goalText: string; worktreePath: string | null }
type TurnInput = {
  phase?: string
  text?: string
  vars?: Record<string, string>
  timeoutMs?: number
}
type Entry = Awaited<ReturnType<AgentRegistry['ensure']>>

/**
 * Renders the turn's prompt text and its `expect` groups, or throws
 * `TurnRejected(msg, 400)` for a bad phase or an unresolved placeholder.
 *
 * Deliberately takes no live `AgentRegistry` entry: it only needs the
 * objective row and the turn request, so the route can call it — and let a
 * bad request 400 — *before* `agents.ensure()`. Spawning a real adapter child
 * process, an ACP handshake and an `agent_sessions` row for a request that
 * was always going to be rejected is a real resource cost, not just an
 * ordering nicety: a client retrying against a bad phase would otherwise
 * accumulate live agent processes for objectives that never get a valid
 * turn. This is exactly the check order the pre-refactor route used.
 */
export function renderTurnPrompt(
  objective: ObjectiveRef,
  turn: TurnInput,
): { text: string; expect: AgentEventType[][] } {
  let text = turn.text ?? ''
  let expect: AgentEventType[][] = []
  if (turn.phase !== undefined) {
    let template: PromptTemplate
    try {
      template = loadTemplate(turn.phase)
    } catch (err) {
      throw new TurnRejected(errorMessage(err), 400)
    }
    // The template's front-matter is the single source of truth for what the
    // turn must produce: the machine will read the same field in phase 3.
    expect = template.expects
    text = renderTemplate(template, {
      title: objective.title,
      goalText: objective.goalText,
      ...turn.vars,
    })

    // renderTemplate deliberately leaves an unknown placeholder in place — a
    // visibly broken prompt is debuggable, a silently empty one is not — but
    // "visible" only helps if someone looks. Sending it anyway is how
    // `verify.md` came to ship the literal string `{{verificationCommands}}`
    // to the agent. On the corpus run that would have measured the gate's
    // kill-switch number against a systematically broken prompt, and the
    // resulting low `evidence` recall would have been indistinguishable from
    // a genuine failure of the product bet.
    const unresolved = placeholdersIn(text)
    if (unresolved.length > 0) {
      throw new TurnRejected(
        `Prompt for phase "${turn.phase}" still contains ` +
          `${unresolved.map((n) => `{{${n}}}`).join(', ')}. Supply the value(s) in "vars".`,
        400,
      )
    }
  }

  return { text, expect }
}

/**
 * Everything a turn needs decided once a live entry exists: the rendered
 * prompt (recomputed here — a synchronous file read and a few string
 * substitutions, not a live process spawn, so doing it twice costs nothing)
 * plus whether a turn is even allowed to start right now. Kept as a plain
 * (non-async) function, not folded into `runTurn`'s body, so a rejection
 * here throws synchronously out of `runTurn(...)` — reaching the route's
 * `try/catch` even though the route calls `runTurn` as `void runTurn(...)`
 * and never awaits it. An `async` function can't do this: any throw inside
 * one, even before its first `await`, becomes a rejected promise instead of
 * a synchronous throw, and a `void`-ed promise's rejection never reaches an
 * enclosing `try/catch`.
 */
function prepareTurn(
  deps: Deps,
  entry: Entry,
  objective: ObjectiveRef,
  turn: TurnInput,
): { turnId: string; text: string } {
  const { text, expect } = renderTurnPrompt(objective, turn)

  // A second prompt while one is still open would have beginTurn silently
  // discard the first turn's buffered state (design rule 2: never drop
  // silently) — reject it visibly instead. Matches the 409 the `cancel`
  // branch already uses for "no active session".
  if (entry.pipeline.turnActive) {
    throw new TurnRejected('A turn is already in flight', 409)
  }

  const turnId = randomUUID()
  entry.pipeline.beginTurn({ turnId, expect })
  // Published on the entry so the `cancel` request — a different request,
  // with no access to this closure — can end the same turn.
  entry.turnId = turnId

  deps.bus.emit({
    objectiveId: objective.id,
    type: 'prompt_sent',
    payload: { text, phase: turn.phase },
  })

  return { turnId, text }
}

/**
 * The prompt / repair / endTurn sequence, moved verbatim from the route's
 * `type === 'prompt'` branch. Resolves instead of throwing: by the time this
 * runs, the turn is already open, and every exit needs its own `endTurn`.
 */
async function settleTurn(
  deps: Deps,
  entry: Entry,
  objective: ObjectiveRef,
  turnId: string,
  text: string,
): Promise<TurnOutcome> {
  const { bus } = deps
  try {
    const r = await entry.port.prompt(entry.sessionId, text)
    // The repair runs before endTurn, while the turn is still open and its
    // expectations are still repairable. It is sent as repair_prompt_sent,
    // NOT prompt_sent: loadTranscript opens a turn on prompt_sent alone, and
    // a second turn here would shift every later turn and invalidate all 40
    // turn-indexed labels in the eval corpus (design §5.2).
    // Settle first: the scanner decides only on complete lines, so a
    // closing fence with no newline after it — the end of nearly every
    // agent message — is still buffered here. Without this the turn looks
    // empty and the repair demands an event the agent already sent.
    entry.pipeline.settle()
    const unmet = entry.pipeline.unmetExpectations()
    const dangling = entry.pipeline.danglingEvidenceRefs()
    // Read before the repair prompt is built: a turn can owe an event
    // *because* a block it sent was rejected, and saying only what is
    // missing invites the agent to substitute rather than correct.
    const rejected = entry.pipeline.schemaRejections()
    if (unmet.length > 0 || dangling.length > 0) {
      const parts = [
        ...unmet.map((group) => group.join(' or ')),
        ...dangling.map((ref) => `evidence matching "${ref}"`),
      ]
      const missing = parts.join(', ')
      try {
        const repair = buildRepairPrompt(
          renderTemplate(loadTemplate('repair'), { missing }),
          rejected,
        )
        bus.emit({
          objectiveId: objective.id,
          type: 'repair_prompt_sent',
          payload: { missing, rejected },
        })
        await entry.port.prompt(entry.sessionId, repair)
      } catch (err) {
        // A failed repair must not lose the turn's real work: fall through
        // to endTurn, which reports missing_expected exactly as before.
        bus.emit({
          objectiveId: objective.id,
          type: 'repair_failed',
          payload: { message: errorMessage(err) },
        })
      }
    }
    if (entry.turnId === turnId) entry.turnId = null
    await entry.pipeline.endTurn(turnId)
    bus.emit({ objectiveId: objective.id, type: 'prompt_finished', payload: r })
    return { ok: true, turnId }
  } catch (err) {
    // Flush before reporting: a turn that died mid-block still produced
    // text, and an unterminated fence is a finding, not noise.
    if (entry.turnId === turnId) entry.turnId = null
    await entry.pipeline.endTurn(turnId)
    bus.emit({
      objectiveId: objective.id,
      // A turn we ended is not a turn the agent lost. Reporting a discard
      // or a shutdown as a failure would corrupt the flakiness signal this
      // milestone exists to collect.
      type: err instanceof AgentStoppedError ? 'prompt_cancelled' : 'prompt_failed',
      payload: { message: errorMessage(err) },
    })
    if (err instanceof AgentStoppedError) {
      return { ok: false, turnId, reason: 'agent_crash', message: errorMessage(err) }
    }
    return { ok: false, turnId, reason: 'error', message: errorMessage(err) }
  }
}

/**
 * Races `settleTurn` against the per-turn timeout. `cancel()` alone does not
 * make a wedged `prompt()` settle — the fake peer's `hang-on-prompt` mode
 * treats `session/cancel` as the notification it is and never answers the
 * prompt, which is also how a real adapter can behave — so the timeout has
 * to resolve the turn itself rather than wait on `settleTurn` to notice.
 * `settleTurn` is left running: `ContractPipeline.endTurn` is a no-op on a
 * turn that already closed, so if the prompt eventually does settle, its own
 * bookkeeping stays safe. That is the same tolerance the `cancel` route
 * branch already relies on.
 */
async function raceTimeout(
  deps: Deps,
  entry: Entry,
  objective: ObjectiveRef,
  turn: TurnInput,
  turnId: string,
  text: string,
): Promise<TurnOutcome> {
  const timeout = turn.timeoutMs ?? turnTimeoutMs(deps.db)
  const settled = settleTurn(deps, entry, objective, turnId, text)

  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<true>((resolve) => {
    timer = setTimeout(() => resolve(true), timeout)
  })

  try {
    const outcome = await Promise.race([settled, timedOut])
    if (outcome !== true) return outcome

    deps.bus.emit({
      objectiveId: objective.id,
      type: 'turn_timed_out',
      payload: { turnId, timeoutMs: timeout, phase: turn.phase ?? null },
    })
    // Cancel rather than abandon: an un-cancelled prompt leaves the adapter
    // holding a turn no one will ever close.
    void entry.port.cancel(entry.sessionId).catch(() => undefined)
    if (entry.turnId === turnId) entry.turnId = null
    await entry.pipeline.endTurn(turnId)
    return { ok: false, turnId, reason: 'timeout', message: `Turn exceeded ${timeout}ms` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Deliberately not declared `async`: `prepareTurn` runs synchronously as the
 * first thing this function does, so a `TurnRejected` it throws propagates
 * synchronously out of `runTurn(...)` itself — the route calls this as
 * `void runTurn(...)` and relies on exactly that to keep returning its
 * existing 400/409 status codes.
 */
export function runTurn(
  deps: Deps,
  objective: ObjectiveRef,
  turn: TurnInput,
): Promise<TurnOutcome> {
  const entry = deps.agents.get(objective.id)
  if (!entry) throw new TurnRejected('No active agent session', 500)

  const { turnId, text } = prepareTurn(deps, entry, objective, turn)
  return raceTimeout(deps, entry, objective, turn, turnId, text)
}
