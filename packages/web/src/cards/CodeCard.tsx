import type { Card } from '../api.js'
import { CardFrame } from './CardFrame.js'

type CodeCardData = Extract<Card, { kind: 'code' }>

/**
 * A `pre` with the language and caption on one line above. No syntax
 * highlighter: a 20-line sketch does not earn one, and `react-diff-view`
 * already owns highlighting where trust depends on it (D12).
 *
 * `captionOverride` is `DiagramCard`'s: its render-error fallback shows the
 * source as code with the error as the caption.
 */
export function CodeCard({
  card,
  defaultCollapsed,
  captionOverride,
}: {
  card: CodeCardData
  defaultCollapsed?: boolean
  captionOverride?: string
}) {
  const caption = captionOverride ?? card.caption
  return (
    <CardFrame card={card} defaultCollapsed={defaultCollapsed}>
      <p className="mb-1 font-mono text-xs text-muted-foreground">
        {caption !== undefined ? `${card.language} · ${caption}` : card.language}
      </p>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs">
        <code>{card.code}</code>
      </pre>
    </CardFrame>
  )
}
