import { useState } from 'react'
import type { PlanTask } from '../api.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Card, CardContent } from '../components/ui/card.js'
import { Input } from '../components/ui/input.js'

type Edit = { title: string; description: string; expectFailingText: string }

function parseCommandIds(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function PlanApproval({
  tasks,
  onCommand,
}: {
  tasks: PlanTask[]
  onCommand: (body: Record<string, unknown>) => void
}) {
  const [edits, setEdits] = useState<Edit[]>(
    tasks.map((t) => ({
      title: t.title,
      description: t.description,
      expectFailingText: (t.expectFailing ?? []).join(', '),
    })),
  )

  const move = (from: number, to: number) => {
    if (to < 0 || to >= edits.length) return
    const next = [...edits]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    setEdits(next)
  }

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium">Plan</h2>
      <ol className="space-y-2">
        {edits.map((e, i) => {
          const parsedExpectFailing = parseCommandIds(e.expectFailingText)
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional here
            <Card key={i}>
              <CardContent className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    className="flex-1"
                    value={e.title}
                    aria-label={`Task ${i + 1} title`}
                    onChange={(ev) =>
                      setEdits(
                        edits.map((x, j) => (i === j ? { ...x, title: ev.target.value } : x)),
                      )
                    }
                  />
                  <Button
                    variant="outline"
                    size="icon-sm"
                    type="button"
                    aria-label={`Move task ${i + 1} up`}
                    onClick={() => move(i, i - 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    type="button"
                    aria-label={`Move task ${i + 1} down`}
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    type="button"
                    aria-label={`Remove task ${i + 1}`}
                    onClick={() => setEdits(edits.filter((_, j) => j !== i))}
                  >
                    ✕
                  </Button>
                </div>
                {parsedExpectFailing.length > 0 && (
                  <div>
                    {/* A single Badge whose own text is the whole label+list string: getByText
                        only reads a node's direct text-node children, not nested elements, so a
                        label span plus one Badge per id would never expose the combined text a
                        single query can match. */}
                    <Badge variant="outline" className="mr-1">
                      {`expects failing: ${parsedExpectFailing.join(', ')}`}
                    </Badge>
                  </div>
                )}
                {/* A plain span, not <label>: Input already carries its own aria-label below,
                    and biome's noLabelWithoutControl can't see through the custom component to
                    the native <input> it wraps, so a <label> here would be flagged (and would
                    double-announce the same text to a screen reader). */}
                <span className="text-xs text-gray-600">
                  Task {i + 1} expected failing commands
                  <Input
                    className="ml-2 mt-1 h-6 text-xs"
                    value={e.expectFailingText}
                    aria-label={`Task ${i + 1} expected failing commands`}
                    onChange={(ev) =>
                      setEdits(
                        edits.map((x, j) =>
                          i === j ? { ...x, expectFailingText: ev.target.value } : x,
                        ),
                      )
                    }
                  />
                </span>
              </CardContent>
            </Card>
          )
        })}
      </ol>
      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          onClick={() =>
            onCommand({
              type: 'approve_plan',
              edits: edits.map((e) => ({
                title: e.title,
                description: e.description,
                expectFailing: parseCommandIds(e.expectFailingText),
              })),
            })
          }
        >
          Approve plan
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onCommand({
              type: 'revise',
              instruction: 'The plan is wrong — propose a different approach.',
            })
          }
        >
          Ask for a different plan
        </Button>
      </div>
    </section>
  )
}
