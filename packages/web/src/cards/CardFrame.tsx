import { type ReactNode, useState } from 'react'
import type { Card } from '../api.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { CardContent, CardHeader, Card as CardShell, CardTitle } from '../components/ui/card.js'

/**
 * The chrome every card shares: title, an optional `role` badge, and a
 * collapse toggle for Low Energy Mode (D8 — collapsed to a title row, never
 * hidden, since a decision still needs its supporting material).
 *
 * The right-hand side of the header is deliberately empty: spec 2 of 3
 * (per-card Ask / Change) puts its actions there. Nothing in spec 1 renders
 * into it and no test should assert on it.
 */
export function CardFrame({
  card,
  defaultCollapsed = false,
  children,
}: {
  card: Card
  defaultCollapsed?: boolean
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  return (
    <CardShell data-testid={`card-${card.id}`} data-kind={card.kind}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">
            <h3 className="inline">{card.title}</h3>
          </CardTitle>
          {card.role !== undefined && (
            <Badge variant="outline" className="mt-1" data-testid="card-role">
              {card.role}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? 'Show' : 'Hide'}
        </Button>
      </CardHeader>
      {!collapsed && <CardContent>{children}</CardContent>}
    </CardShell>
  )
}
