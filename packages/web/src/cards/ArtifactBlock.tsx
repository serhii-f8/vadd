import type { Artifact, Card } from '../api.js'
import { CodeCard } from './CodeCard.js'
import { DiagramCard } from './DiagramCard.js'
import { latestArtifactFor } from './select-artifact.js'
import { TableCard } from './TableCard.js'
import { TextCard } from './TextCard.js'

function renderCard(card: Card, collapsed: boolean) {
  switch (card.kind) {
    case 'text':
      return <TextCard key={card.id} card={card} defaultCollapsed={collapsed} />
    case 'table':
      return <TableCard key={card.id} card={card} defaultCollapsed={collapsed} />
    case 'code':
      return <CodeCard key={card.id} card={card} defaultCollapsed={collapsed} />
    case 'diagram':
      return <DiagramCard key={card.id} card={card} defaultCollapsed={collapsed} />
    default: {
      // Exhaustive: a new card kind is a type error here, not a blank card.
      const unhandled: never = card
      throw new Error(`No renderer for card kind: ${String((unhandled as Card).kind)}`)
    }
  }
}

/**
 * Amendment A24. Secondary content beneath the Decision Card or Plan Approval:
 * the newest artifact for the state, every card in a single column. Renders
 * nothing — not an empty placeholder — when there is none (the
 * `MemorySection` precedent). Spec §8's one-primary-element rule is kept: this
 * belongs to the element above it.
 *
 * Low Energy Mode (D8) collapses each card to its title row; it does not hide
 * the block, since a decision still needs its supporting material.
 */
export function ArtifactBlock({
  artifacts,
  state,
  lowEnergy,
}: {
  artifacts: Artifact[]
  state: string
  lowEnergy: boolean
}) {
  const artifact = latestArtifactFor(artifacts, state)
  if (artifact === null) return null
  return (
    <section aria-label="Supporting material" className="mt-6 space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Supporting material</h2>
      {artifact.cards.map((card) => renderCard(card, lowEnergy))}
    </section>
  )
}
