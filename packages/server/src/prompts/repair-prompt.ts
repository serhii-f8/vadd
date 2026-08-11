/**
 * Composes the repair turn's prompt: the rendered `repair.md` body, plus the
 * schema rejections this turn produced.
 *
 * Kept separate from the route so the composition is directly testable, and
 * appended here rather than added as a `{{rejected}}` placeholder because it is
 * a whole conditional paragraph with list formatting — `renderTemplate`
 * substitutes scalars, and a user overriding `repair.md` (D11) should not have
 * to reproduce this structure to keep it working.
 *
 * Why it exists: a turn can owe an event *because a block was rejected*. Told
 * only "That turn owes decision_needed", an agent that believes it already sent
 * the card reasonably sends something else instead of correcting it — the
 * substitution the fourth gate run recorded on three objectives across two
 * different `repair.md` wordings.
 */
export function buildRepairPrompt(body: string, rejected: string[]): string {
  if (rejected.length === 0) return body
  return [
    body,
    '',
    'A block you sent was rejected and did not count:',
    ...rejected.map((r) => `- ${r}`),
    '',
    'Re-emit that block corrected. Do not send a different event instead.',
  ].join('\n')
}
