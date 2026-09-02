import {
  AgentEvent,
  type AgentEventType,
  agentEventJsonSchema,
  type RawAgentUpdate,
} from '@vadd/core'
import { type FenceBlock, FenceScanner } from './fence-scanner.js'

/** Filled in by Task 6. Injected so the pipeline itself stays I/O-free. */
export type Summarizer = {
  extract(rawText: string, schema: Record<string, unknown>): Promise<unknown>
}

export type ViolationReason =
  | 'parse'
  | 'schema'
  | 'unterminated'
  | 'missing_expected'
  | 'fence_drift'
  | 'dangling_evidence_ref'
  | 'unexpected_type'

export type ContractEmission =
  | {
      kind: 'event'
      turnId: string
      event: AgentEvent
      /** True when the summarizer produced it rather than a fenced block. */
      extracted: boolean
      sourceEventIds: number[]
    }
  | {
      kind: 'violation'
      turnId: string
      reason: ViolationReason
      raw: string
      issues?: unknown
      sourceEventIds: number[]
    }

/**
 * One short line an agent can act on: which event type was rejected, which
 * field, and the rule it broke.
 *
 * Zod issue paths are arrays (`['options', 0, 'label']`); they are joined with
 * dots because that is how the agent sees the JSON it wrote. Capped at three
 * issues so one badly-shaped block cannot flood the repair prompt.
 */
function describeRejection(item: unknown, issues: unknown): string {
  const type = (item as { type?: unknown })?.type
  const label = typeof type === 'string' ? type : 'unknown type'
  const list = Array.isArray(issues) ? issues : []
  const parts = list.slice(0, 3).map((issue) => {
    const i = issue as { path?: unknown[]; message?: string }
    const path = (i.path ?? []).join('.')
    return path === '' ? (i.message ?? 'invalid') : `${path} — ${i.message ?? 'invalid'}`
  })
  return parts.length === 0 ? `${label}: rejected` : `${label}: ${parts.join('; ')}`
}

/** Text of an assistant message chunk, or null for anything else. */
function chunkText(update: unknown): string | null {
  const u = update as {
    sessionUpdate?: string
    content?: { type?: string; text?: string }
  }
  // Thought chunks are deliberately excluded (design §3.3): a drafted event
  // inside reasoning is not a claim the user should be shown.
  if (u?.sessionUpdate !== 'agent_message_chunk') return null
  if (u.content?.type !== 'text' || typeof u.content.text !== 'string') return null
  return u.content.text
}

/**
 * Turns an agent's raw update stream into validated `AgentEvent`s.
 *
 * Two rules govern everything here:
 *
 * 1. **Validate ourselves.** M0 found the pinned ACP SDK validating
 *    `session/update` and *throwing before dispatch*, silently discarding six
 *    of twenty-five updates behind a `console.error` (M0 design §7.1 item 5).
 *    Nothing on this path may rely on the SDK's validation.
 * 2. **Never drop silently.** Every parse or validation failure becomes a
 *    `violation` emission carrying the raw text and the source update ids.
 */
export class ContractPipeline {
  readonly #scanner = new FenceScanner()
  readonly #onEmit: (e: ContractEmission) => void
  readonly #summarizer?: Summarizer

  #turnId: string | null = null
  #expect: AgentEventType[][] = []
  #permit: AgentEventType[] = []
  #seen = new Set<AgentEventType>()
  #evidenceHeadlines = new Set<string>()
  #claimedEvidenceRefs = new Set<string>()
  #schemaRejections: string[] = []
  #sources: number[] = []
  /** Full turn text, kept for the summarizer fallback and violation records. */
  #raw = ''

  constructor(deps: { summarizer?: Summarizer; onEmit: (e: ContractEmission) => void }) {
    this.#onEmit = deps.onEmit
    this.#summarizer = deps.summarizer
  }

  /**
   * `expect` is how spec §4's "missing block for an expected phase" becomes
   * concrete: the caller declares what this turn must produce. It comes from
   * the prompt template's `expects` front-matter (design §4.1).
   *
   * Each entry is an alternation group, satisfied by any one of its members.
   * `failure` is the documented alternative to a phase's success event, so a
   * flat AND over the same list made a successful turn permanently unable to
   * satisfy its own contract.
   *
   * `permit` (amendment A24) names types that may appear without being owed:
   * excluded from `unexpected_type`, invisible to `unmetExpectations()`.
   */
  beginTurn(t: { turnId: string; expect?: AgentEventType[][]; permit?: AgentEventType[] }): void {
    this.#scanner.flush()
    this.#turnId = t.turnId
    this.#expect = t.expect ?? []
    this.#permit = t.permit ?? []
    this.#seen = new Set()
    this.#evidenceHeadlines = new Set()
    this.#claimedEvidenceRefs = new Set()
    this.#schemaRejections = []
    this.#sources = []
    this.#raw = ''
  }

  ingest(u: RawAgentUpdate, sourceEventId?: number): void {
    if (this.#turnId === null) return
    const text = chunkText(u.update)
    if (text === null) return
    this.#raw += text
    if (sourceEventId !== undefined) this.#sources.push(sourceEventId)
    for (const block of this.#scanner.push(text)) this.#handleBlock(block)
  }

  /**
   * Parses whatever the scanner still holds, without closing the turn.
   *
   * Callers that inspect a turn before `endTurn` — the repair path reading
   * `unmetExpectations()`, `danglingEvidenceRefs()` and `schemaRejections()` —
   * must call this first. `FenceScanner.push()` decides only on complete
   * lines, so a closing fence with no newline after it stays buffered until
   * `flush()`, which runs inside `endTurn()`. Without settling, a turn whose
   * final block was its *only* block looks empty, and the repair fires
   * demanding an event the agent had in fact already sent — which is what the
   * agent then, reasonably, refuses to send twice.
   *
   * Safe to call repeatedly, and never reports `unterminated`: a block still
   * genuinely open is not a finding until the turn ends.
   */
  settle(): void {
    if (this.#turnId === null) return
    for (const block of this.#scanner.settle()) this.#handleBlock(block)
  }

  async endTurn(turnId: string): Promise<void> {
    if (this.#turnId !== turnId) return
    const { blocks, unterminated } = this.#scanner.flush()
    for (const block of blocks) this.#handleBlock(block)
    if (unterminated !== null) this.#violation('unterminated', unterminated)

    const dangling = this.danglingEvidenceRefs()
    if (dangling.length > 0) this.#violation('dangling_evidence_ref', dangling.join(', '))

    const missing = this.unmetExpectations()
    if (missing.length > 0) await this.#fallback(missing)

    this.#turnId = null
  }

  #handleBlock(block: FenceBlock): void {
    if (block.weldedRemainder !== undefined) {
      this.#violation('fence_drift', block.weldedRemainder)
    }
    const body = block.body
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      // No repair heuristics in v1 (design §3.3). Parse failures are a counted
      // eval metric, so the corpus decides whether repair is worth building.
      this.#violation('parse', body)
      return
    }
    const items = Array.isArray(parsed) ? parsed : [parsed]
    // An empty array is a degenerate payload, not a no-op: the array form
    // exists so one turn can carry several events, and nothing in the
    // contract documents "zero events" as a valid outcome of emitting a
    // fence at all. Falling through an empty loop here would silently
    // swallow a block that arrived — exactly what this pipeline exists to
    // prevent — so treat it as a schema violation instead of simplifying
    // this check back out.
    if (items.length === 0) {
      this.#violation('schema', body)
      return
    }
    for (const item of items) {
      const result = AgentEvent.safeParse(item)
      if (!result.success) {
        // Kept, not just reported: the repair turn needs to tell the agent what
        // was wrong with a block it believes it already sent. Only blocks the
        // agent itself emitted are recorded — the summarizer's rejections in
        // #fallback are not the agent's to correct.
        this.#schemaRejections.push(describeRejection(item, result.error.issues))
        this.#violation('schema', JSON.stringify(item), result.error.issues)
        continue
      }
      this.#seen.add(result.data.type)
      this.#trackClaims(result.data)
      // Reported, never gated and never suppressed: the event still goes to
      // the bus and to the scorer exactly as before. Filtering it here would
      // raise precision by hiding emissions rather than by changing what the
      // agent does, which is measurement fraud, not a fix. This counter is how
      // the turn-budget prompt line gets measured instead of assumed.
      if (
        this.#expect.length > 0 &&
        !this.#expect.some((g) => g.includes(result.data.type)) &&
        !this.#permit.includes(result.data.type)
      ) {
        this.#violation('unexpected_type', result.data.type)
      }
      this.#emitEvent(result.data, false)
    }
  }

  /**
   * Spec §4's fallback chain: fenced block → summarizer (flagged `extracted`)
   * → a status event pointing at the raw view.
   *
   * A failure anywhere here degrades to step 3 rather than failing the turn: a
   * missing key, a rate limit, or an unparseable reply must not lose the work
   * the agent already did.
   */
  async #fallback(missing: AgentEventType[][]): Promise<void> {
    const unmet = missing.map((group) => group.join(' or ')).join(', ')
    this.#violation('missing_expected', `expected ${unmet}`)

    if (this.#summarizer && this.#raw.trim().length > 0) {
      try {
        const reply = await this.#summarizer.extract(this.#raw, agentEventJsonSchema())
        const events = (reply as { events?: unknown[] })?.events ?? []
        let emitted = 0
        for (const item of events) {
          const result = AgentEvent.safeParse(item)
          if (!result.success) {
            this.#violation('schema', JSON.stringify(item), result.error.issues)
            continue
          }
          this.#seen.add(result.data.type)
          this.#trackClaims(result.data)
          this.#emitEvent(result.data, true)
          emitted += 1
        }
        if (emitted > 0) return
      } catch (err) {
        this.#violation('parse', err instanceof Error ? err.message : String(err))
      }
    }

    this.#emitEvent(
      { type: 'status', phase: 'executing', headline: 'Unstructured output — open raw view' },
      false,
    )
  }

  #trackClaims(event: AgentEvent): void {
    if (event.type === 'evidence') this.#evidenceHeadlines.add(event.headline)
    if (event.type === 'task_result') {
      for (const ref of event.evidenceRefs) this.#claimedEvidenceRefs.add(ref)
    }
  }

  #emitEvent(event: AgentEvent, extracted: boolean): void {
    this.#onEmit({
      kind: 'event',
      turnId: this.#turnId ?? '',
      event,
      extracted,
      sourceEventIds: [...this.#sources],
    })
  }

  #violation(reason: ViolationReason, raw: string, issues?: unknown): void {
    this.#onEmit({
      kind: 'violation',
      turnId: this.#turnId ?? '',
      reason,
      raw,
      issues,
      sourceEventIds: [...this.#sources],
    })
  }

  /** Exposed for the fallback path in Task 6. */
  get rawText(): string {
    return this.#raw
  }

  get hasSummarizer(): boolean {
    return this.#summarizer !== undefined
  }

  /**
   * True between `beginTurn` and `endTurn`. Callers must not start a second
   * turn while this is true: `beginTurn` resets all buffered state, so a
   * second call while one is open discards the first turn's unterminated
   * fence with no violation and mis-attributes its still-arriving chunks to
   * the new turnId.
   */
  get turnActive(): boolean {
    return this.#turnId !== null
  }

  /**
   * The `expect` groups no emitted event has satisfied yet — what this turn
   * still owes. Pure: it neither records a violation nor runs the fallback, so
   * the caller can decide to repair before `endTurn` commits to failure.
   *
   * Empty once the turn is closed, so a caller that races `endTurn` repairs
   * nothing rather than prompting into a turn that has already reported.
   */
  unmetExpectations(): AgentEventType[][] {
    if (this.#turnId === null) return []
    return this.#expect.filter((group) => !group.some((t) => this.#seen.has(t)))
  }

  /**
   * Claimed evidenceRefs with no matching evidence headline in this turn —
   * the referential check unmetExpectations() cannot make, because a
   * task_result and an unrelated evidence event both existing already
   * satisfies that check's type-level groups. Pure, like
   * unmetExpectations(): empty once the turn is closed.
   */
  danglingEvidenceRefs(): string[] {
    if (this.#turnId === null) return []
    return [...this.#claimedEvidenceRefs].filter((ref) => !this.#evidenceHeadlines.has(ref))
  }

  /**
   * Blocks this turn emitted that failed schema validation, each as one line
   * naming the type, the failing field and the rule broken.
   *
   * The repair turn needs this and never had it. A turn whose `decision_needed`
   * was rejected for an over-long `label` was told only "That turn owes
   * decision_needed", so the agent — believing it had already sent the card —
   * reasonably substituted an unrelated event rather than correcting it. That
   * substitution appeared on three objectives across two different `repair.md`
   * wordings, which a wording explanation does not account for and a missing
   * diagnostic does.
   *
   * Pure and turn-scoped, like `unmetExpectations()` and
   * `danglingEvidenceRefs()`: empty once the turn is closed, so a caller
   * racing `endTurn` repairs nothing rather than prompting a turn that has
   * already reported.
   */
  schemaRejections(): string[] {
    if (this.#turnId === null) return []
    return [...this.#schemaRejections]
  }
}
