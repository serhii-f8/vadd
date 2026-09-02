import { lazy, Suspense, useCallback, useState } from 'react'
import type { Card } from '../api.js'
import { CardFrame } from './CardFrame.js'
import { CodeCard } from './CodeCard.js'

const MermaidSvg = lazy(() => import('./MermaidSvg.js'))

type DiagramCardData = Extract<Card, { kind: 'diagram' }>

/**
 * Mermaid, lazy-loaded. On a render error the card falls back to the source
 * as a `CodeCard` with the error in the caption — never a blank (the
 * `DiffList` `loadError` lesson).
 */
export function DiagramCard({
  card,
  defaultCollapsed,
}: {
  card: DiagramCardData
  defaultCollapsed?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const onError = useCallback((message: string) => setError(message), [])

  if (error !== null) {
    return (
      <CodeCard
        defaultCollapsed={defaultCollapsed}
        captionOverride={`Diagram failed to render: ${error}`}
        card={{
          id: card.id,
          kind: 'code',
          title: card.title,
          ...(card.role !== undefined ? { role: card.role } : {}),
          language: card.notation,
          code: card.source,
        }}
      />
    )
  }

  return (
    <CardFrame card={card} defaultCollapsed={defaultCollapsed}>
      <Suspense fallback={<p className="text-xs text-muted-foreground">Rendering diagram…</p>}>
        <MermaidSvg id={card.id} source={card.source} onError={onError} />
      </Suspense>
      {card.caption !== undefined && (
        <p className="mt-2 text-xs text-muted-foreground">{card.caption}</p>
      )}
    </CardFrame>
  )
}
