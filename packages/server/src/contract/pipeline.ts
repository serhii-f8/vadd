import { AgentEvent, type AgentEventType, type RawAgentUpdate } from '@vadd/core'
import { FenceScanner } from './fence-scanner.js'

/** Filled in by Task 6. Injected so the pipeline itself stays I/O-free. */
export type Summarizer = {
  extract(rawText: string, schema: Record<string, unknown>): Promise<unknown>
}

export type ViolationReason = 'parse' | 'schema' | 'unterminated' | 'missing_expected'

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
  #expect: AgentEventType[] = []
  #seen = new Set<AgentEventType>()
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
   */
  beginTurn(t: { turnId: string; expect?: AgentEventType[] }): void {
    this.#scanner.flush()
    this.#turnId = t.turnId
    this.#expect = t.expect ?? []
    this.#seen = new Set()
    this.#sources = []
    this.#raw = ''
  }

  ingest(u: RawAgentUpdate, sourceEventId?: number): void {
    if (this.#turnId === null) return
    const text = chunkText(u.update)
    if (text === null) return
    this.#raw += text
    if (sourceEventId !== undefined) this.#sources.push(sourceEventId)
    for (const block of this.#scanner.push(text)) this.#handleBlock(block.body)
  }

  async endTurn(turnId: string): Promise<void> {
    if (this.#turnId !== turnId) return
    const { blocks, unterminated } = this.#scanner.flush()
    for (const block of blocks) this.#handleBlock(block.body)
    if (unterminated !== null) this.#violation('unterminated', unterminated)

    const missing = this.#expect.filter((t) => !this.#seen.has(t))
    if (missing.length > 0) await this.#fallback(missing)

    this.#turnId = null
  }

  #handleBlock(body: string): void {
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
        this.#violation('schema', JSON.stringify(item), result.error.issues)
        continue
      }
      this.#seen.add(result.data.type)
      this.#emitEvent(result.data, false)
    }
  }

  /** Spec §4 steps 2 and 3. Task 6 supplies the summarizer. */
  async #fallback(missing: AgentEventType[]): Promise<void> {
    this.#violation('missing_expected', `expected ${missing.join(', ')}`)
    this.#emitEvent(
      { type: 'status', phase: 'executing', headline: 'Unstructured output — open raw view' },
      false,
    )
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
}
