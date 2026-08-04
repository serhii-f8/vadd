/** The locked fence tag (spec §4). */
export const FENCE_TAG = 'vadd-event'

export type FenceBlock = { body: string }

/**
 * Pulls ```` ```vadd-event ```` blocks out of a text stream.
 *
 * ACP delivers `agent_message_chunk` deltas, so a fence arrives split across
 * arbitrary boundaries — sometimes mid-word. The scanner buffers whatever does
 * not yet end in a newline and only decides on complete lines.
 *
 * Deliberate limitation: a closing fence is a line whose trimmed content is
 * exactly ```` ``` ````, so a ```` ``` ```` sequence alone on a line inside a
 * JSON string would end the block early. The eval corpus decides whether that
 * ever happens before anything cleverer is built (design §3.3).
 *
 * The buffer is turn-scoped — `flush()` clears it — so it is bounded by one
 * turn's output rather than the session's.
 */
export class FenceScanner {
  #pending = ''
  #inside = false
  #body: string[] = []

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
  flush(): { blocks: FenceBlock[]; unterminated: string | null } {
    const blocks: FenceBlock[] = []
    if (this.#pending.length > 0) {
      const line = this.#pending
      this.#pending = ''
      this.#consume(line, blocks)
    }
    const unterminated = this.#inside ? this.#body.join('\n') : null
    this.#inside = false
    this.#body = []
    return { blocks, unterminated }
  }

  #consume(line: string, blocks: FenceBlock[]): void {
    const trimmed = line.trim()
    if (!this.#inside) {
      if (trimmed === `\`\`\`${FENCE_TAG}`) {
        this.#inside = true
        this.#body = []
      }
      return
    }
    if (trimmed === '```') {
      this.#inside = false
      blocks.push({ body: this.#body.join('\n') })
      this.#body = []
      return
    }
    this.#body.push(line)
  }
}
