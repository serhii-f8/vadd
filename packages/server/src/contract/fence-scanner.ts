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
 * inside a JSON string still ends the block early. An *opening* fence welded to
 * preceding text is likewise still missed — the same transport quirk could
 * produce it, but nothing in the corpus has.
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
    // A closing fence welded to the text that followed it. The adapter
    // concatenates separate assistant messages with no separator, so the line
    // arrives as "```Dependencies are missing." Treating that as body content
    // left the block open and swallowed the rest of the turn — including whole
    // valid blocks — into one unparseable body. Close here and re-read the
    // remainder as ordinary outside text, which is where a later opening fence
    // is found.
    if (trimmed.startsWith('```')) {
      const remainder = trimmed.slice(3).trim()
      this.#inside = false
      blocks.push(
        remainder.length > 0
          ? { body: this.#body.join('\n'), weldedRemainder: remainder }
          : { body: this.#body.join('\n') },
      )
      this.#body = []
      this.#consume(remainder, blocks)
      return
    }
    this.#body.push(line)
  }
}
