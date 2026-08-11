/** The locked fence tag (spec §4). */
export const FENCE_TAG = 'vadd-event'

export type FenceBlock = { body: string; weldedRemainder?: string }

/**
 * Pulls ```` ```vadd-event ```` blocks out of a text stream.
 *
 * ACP delivers `agent_message_chunk` deltas, so a fence arrives split across
 * arbitrary boundaries — sometimes mid-word. The scanner buffers whatever does
 * not yet end in a newline and only decides on complete lines.
 *
 * A closing fence is a line whose trimmed content **starts with** ```` ``` ````;
 * anything after it on the same line is re-read as ordinary outside text. The
 * stricter "exactly ```` ``` ````" rule this replaced lost whole turns, because
 * the adapter welds a closing fence to the prose of the next assistant message.
 *
 * Deliberate limitation, unchanged: a ```` ``` ```` at the start of a line
 * inside a JSON string still ends the block early. Still unseen in the corpus —
 * a claim this scanner's own history says to hold loosely.
 *
 * Two malformed *opening* variants are recovered, both found in the corpus
 * after an earlier version of this docstring called them hypothetical: a fence
 * welded to the preceding prose with no newline (`...re-run.` + ```` ```vadd-event ````),
 * and a bare ```` ``` ```` whose `vadd-event` tag landed on the next line. Each
 * previously produced total silence — no block, no drift, no violation — which
 * is the one outcome this pipeline exists to prevent, and one of them cost a
 * gated label.
 *
 * The buffer is turn-scoped — `flush()` clears it — so it is bounded by one
 * turn's output rather than the session's.
 */
export class FenceScanner {
  #pending = ''
  #inside = false
  #body: string[] = []
  /** Text welded ahead of the current block's opening fence, if any. */
  #pendingWeld: string | null = null
  /** A bare ``` is pending: the next line decides whether it opened a block. */
  #sawBareFence = false

  push(text: string): FenceBlock[] {
    this.#pending += text
    const blocks: FenceBlock[] = []
    let nl = this.#pending.indexOf('\n')
    while (nl !== -1) {
      const line = this.#pending.slice(0, nl)
      this.#pending = this.#pending.slice(nl + 1)
      this.#consume(line, blocks)
      nl = this.#pending.indexOf('\n')
    }
    return blocks
  }

  /**
   * Ends the turn: closes a block whose last line carried no newline, reports
   * any block left open, and resets so the instance can serve the next turn.
   */
  /**
   * Decides on the buffered tail without ending the turn.
   *
   * `push()` only acts on complete lines, so a closing fence that arrived with
   * no newline after it — the end of very nearly every agent message — stays
   * buffered. Anything that needs to know what a turn produced *before* the
   * turn closes has to settle first, or it sees a turn that emitted nothing.
   *
   * Idempotent: the buffer is consumed, so a second call finds nothing.
   */
  settle(): FenceBlock[] {
    const blocks: FenceBlock[] = []
    if (this.#pending.length > 0) {
      const line = this.#pending
      this.#pending = ''
      this.#consume(line, blocks)
    }
    return blocks
  }

  flush(): { blocks: FenceBlock[]; unterminated: string | null } {
    const blocks = this.settle()
    const unterminated = this.#inside ? this.#body.join('\n') : null
    this.#inside = false
    this.#body = []
    this.#pendingWeld = null
    this.#sawBareFence = false
    return { blocks, unterminated }
  }

  /**
   * Closes the current block, attaching any text welded ahead of its opening
   * fence so `#handleBlock` raises `fence_drift`. A recovered block must never
   * be indistinguishable from a clean one.
   */
  #close(blocks: FenceBlock[], weldedAfter?: string): void {
    const weld = this.#pendingWeld ?? weldedAfter
    this.#pendingWeld = null
    this.#inside = false
    blocks.push(
      weld !== null && weld !== undefined && weld.length > 0
        ? { body: this.#body.join('\n'), weldedRemainder: weld }
        : { body: this.#body.join('\n') },
    )
    this.#body = []
  }

  #open(weld: string | null): void {
    this.#inside = true
    this.#body = []
    this.#pendingWeld = weld
  }

  #consume(line: string, blocks: FenceBlock[]): void {
    const trimmed = line.trim()
    if (!this.#inside) {
      const bare = this.#sawBareFence
      this.#sawBareFence = false

      if (trimmed === `\`\`\`${FENCE_TAG}`) {
        this.#open(null)
        return
      }
      // A bare ``` on the previous line, and this one is the tag: the opening
      // fence arrived split in two. error-tracking-wiring turn 3 swallowed an
      // honest `failure` event this way.
      if (bare && trimmed === FENCE_TAG) {
        this.#open('```')
        return
      }
      // An *opening* fence welded to the prose before it, with no newline:
      // "...and re-run.```vadd-event". Symmetric with the welded *closing*
      // case below and produced by the same transport quirk. Anything after
      // the tag on the same line means this is not an opening at all (a fence
      // quoted mid-sentence), so the tail must be empty.
      const welded = line.indexOf(`\`\`\`${FENCE_TAG}`)
      if (welded > 0 && line.slice(welded + 3 + FENCE_TAG.length).trim() === '') {
        this.#open(line.slice(0, welded).trim())
        return
      }
      // Remember a bare fence and let the next line decide: the tag opens a
      // block, anything else means this was an ordinary code fence.
      if (trimmed === '```') this.#sawBareFence = true
      return
    }
    if (trimmed === '```') {
      this.#close(blocks)
      return
    }
    // A closing fence welded to the text that followed it. The adapter
    // concatenates separate assistant messages with no separator, so the line
    // arrives as "```Dependencies are missing." Treating that as body content
    // left the block open and swallowed the rest of the turn — including whole
    // valid blocks — into one unparseable body. Close here and re-read the
    // remainder as ordinary outside text, which is where a later opening fence
    // is found.
    if (trimmed.startsWith('```')) {
      const remainder = trimmed.slice(3).trim()
      this.#close(blocks, remainder.length > 0 ? remainder : undefined)
      this.#consume(remainder, blocks)
      return
    }
    this.#body.push(line)
  }
}
