import type { Card } from '../api.js'
import { CardFrame } from './CardFrame.js'

type TableCardData = Extract<Card, { kind: 'table' }>

/** A small comparison grid. Scrolls inside its own container, never the page. */
export function TableCard({
  card,
  defaultCollapsed,
}: {
  card: TableCardData
  defaultCollapsed?: boolean
}) {
  return (
    <CardFrame card={card} defaultCollapsed={defaultCollapsed}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {card.columns.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional and can repeat (e.g. a blank header)
                <th key={`${i}-${c}`} scope="col" className="py-1 pr-4 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and can repeat verbatim
              <tr key={`${r}-${row[0] ?? ''}`} className="border-b border-border last:border-0">
                {row.map((cell, c) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional and can repeat verbatim
                  <td key={`${c}-${cell}`} className="py-1 pr-4 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardFrame>
  )
}
