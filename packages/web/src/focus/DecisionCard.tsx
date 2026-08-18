import { useState } from 'react'
import type { Decision } from '../api.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group.js'

export function DecisionCard({
  decision,
  onCommand,
}: {
  decision: Decision
  onCommand: (body: Record<string, unknown>) => void
}) {
  const [chosen, setChosen] = useState(decision.recommendedId)

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium">{decision.question}</h2>
      <RadioGroup value={chosen} onValueChange={setChosen} className="space-y-3">
        {decision.options.map((o) => (
          <Card key={o.id} className={o.id === chosen ? 'ring-2 ring-primary' : undefined}>
            <CardHeader>
              <label className="flex items-start gap-3" htmlFor={`${decision.id}-${o.id}`}>
                <RadioGroupItem
                  id={`${decision.id}-${o.id}`}
                  value={o.id}
                  aria-label={o.label}
                  className="mt-1"
                />
                <div>
                  <CardTitle>
                    {o.label}
                    {o.id === decision.recommendedId && (
                      <Badge variant="secondary" className="ml-2">
                        recommended
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="mt-1 text-xs">
                    {/* Spec §4's ONLY mandatory analysis field — always visible. */}
                    <Badge variant="outline">reversibility: {o.reversibility}</Badge>
                    {o.effort !== undefined && (
                      <Badge variant="outline" className="ml-1">
                        effort: {o.effort}
                      </Badge>
                    )}
                  </div>
                </div>
              </label>
            </CardHeader>
            <CardContent>
              {o.pros.length > 0 && <p className="text-sm">+ {o.pros.join('; ')}</p>}
              {o.cons.length > 0 && <p className="text-sm">− {o.cons.join('; ')}</p>}
              <p className="mt-1 text-sm text-muted-foreground">verify: {o.verification}</p>
            </CardContent>
          </Card>
        ))}
      </RadioGroup>
      <div className="mt-4 flex gap-2">
        <Button
          onClick={() => onCommand({ type: 'decide', decisionId: decision.id, optionId: chosen })}
        >
          Choose
        </Button>
        <Button
          variant="outline"
          onClick={() => onCommand({ type: 'revise', instruction: 'Propose different options.' })}
        >
          Ask for alternatives
        </Button>
      </div>
    </section>
  )
}
