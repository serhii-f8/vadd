import { useState } from 'react'
import type { PlanTask } from '../api.js'

type Edit = { title: string; description: string; expectFailing: string[] }

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
      expectFailing: t.expectFailing ?? [],
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
        {edits.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional here
          <li key={i} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded border px-2 py-1"
                value={e.title}
                aria-label={`Task ${i + 1} title`}
                onChange={(ev) =>
                  setEdits(edits.map((x, j) => (i === j ? { ...x, title: ev.target.value } : x)))
                }
              />
              <button
                type="button"
                aria-label={`Move task ${i + 1} up`}
                onClick={() => move(i, i - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move task ${i + 1} down`}
                onClick={() => move(i, i + 1)}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Remove task ${i + 1}`}
                onClick={() => setEdits(edits.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
            {e.expectFailing.length > 0 && (
              <p className="text-xs text-amber-700">
                expects failing: {e.expectFailing.join(', ')}
              </p>
            )}
            <label className="text-xs text-gray-600">
              Task {i + 1} expected failing commands
              <input
                className="ml-2 rounded border px-1 py-0.5 text-xs"
                value={e.expectFailing.join(', ')}
                aria-label={`Task ${i + 1} expected failing commands`}
                onChange={(ev) =>
                  setEdits(
                    edits.map((x, j) =>
                      i === j ? { ...x, expectFailing: parseCommandIds(ev.target.value) } : x,
                    ),
                  )
                }
              />
            </label>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="mt-4 rounded border px-3 py-1"
        onClick={() =>
          onCommand({
            type: 'approve_plan',
            edits: edits.map((e) => ({
              title: e.title,
              description: e.description,
              expectFailing: e.expectFailing,
            })),
          })
        }
      >
        Approve plan
      </button>
    </section>
  )
}
