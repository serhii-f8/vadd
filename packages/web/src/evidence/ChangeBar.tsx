export type ChangeCell = 'a' | 'r' | 'n'

/**
 * A file's change as five cells — added, removed, neutral — the way review
 * tools sketch a diff's shape before anyone opens it. Pure, so the
 * apportioning is testable: cells split proportionally, rounding to the
 * larger side, and at least one cell goes to each non-zero side.
 */
export function changeCells(added: number, removed: number, cells = 5): ChangeCell[] {
  const total = added + removed
  if (total === 0) return Array.from({ length: cells }, () => 'n')
  let a = Math.round((added / total) * cells)
  let r = cells - a
  if (added > 0 && a === 0) {
    a = 1
    r = cells - 1
  }
  if (removed > 0 && r === 0) {
    r = 1
    a = cells - 1
  }
  return [
    ...Array.from({ length: a }, (): ChangeCell => 'a'),
    ...Array.from({ length: r }, (): ChangeCell => 'r'),
  ]
}

const CELL_CLASS: Record<ChangeCell, string> = {
  a: 'bg-status-done',
  r: 'bg-status-failed',
  n: 'bg-border',
}

export function ChangeBar({ added, removed }: { added: number; removed: number }) {
  return (
    <span aria-hidden="true" className="inline-flex gap-px">
      {changeCells(added, removed).map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
        <i key={i} className={`inline-block size-2 rounded-[1px] ${CELL_CLASS[c]}`} />
      ))}
    </span>
  )
}
