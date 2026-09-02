import type { Card } from '../api.js'
import { CardFrame } from './CardFrame.js'

type TextCardData = Extract<Card, { kind: 'text' }>

/** Plain text. A blank line splits paragraphs; nothing else is interpreted. */
export function TextCard({
  card,
  defaultCollapsed,
}: {
  card: TextCardData
  defaultCollapsed?: boolean
}) {
  const paragraphs = card.body.split(/\n\s*\n/).filter((p) => p.trim() !== '')
  return (
    <CardFrame card={card} defaultCollapsed={defaultCollapsed}>
      <div className="space-y-2 text-sm">
        {paragraphs.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs are positional and can repeat verbatim
          <p key={`${i}-${p.slice(0, 16)}`}>{p}</p>
        ))}
      </div>
    </CardFrame>
  )
}
