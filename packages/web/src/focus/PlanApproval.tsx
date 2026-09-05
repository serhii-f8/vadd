import { ArrowDown, ArrowUp, Check, GripVertical, Pause, X } from 'lucide-react'
import { useState } from 'react'
import type { PlanTask } from '../api.js'
import { Button } from '../components/ui/button.js'
import { Input } from '../components/ui/input.js'
import { ActionBar } from './ActionBar.js'

type Edit = { title: string; description: string; expectFailingText: string }

function parseCommandIds(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function fromTasks(tasks: PlanTask[]): Edit[] {
  return tasks.map((t) => ({
    title: t.title,
    description: t.description,
    expectFailingText: (t.expectFailing ?? []).join(', '),
  }))
}

/** How many rows differ from the plan the agent proposed, plus any removed. */
function countEdits(tasks: PlanTask[], edits: Edit[]): number {
  const original = fromTasks(tasks)
  let n = Math.max(0, original.length - edits.length)
  edits.forEach((e, i) => {
    const o = original[i]
    if (
      o === undefined ||
      o.title !== e.title ||
      parseCommandIds(o.expectFailingText).join(',') !==
        parseCommandIds(e.expectFailingText).join(',')
    ) {
      n += 1
    }
  })
  return n
}

export function PlanApproval({
  tasks,
  onCommand,
}: {
  tasks: PlanTask[]
  onCommand: (body: Record<string, unknown>) => void
}) {
  const [edits, setEdits] = useState<Edit[]>(() => fromTasks(tasks))
  const pending = countEdits(tasks, edits)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= edits.length) return
    const next = [...edits]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    setEdits(next)
  }

  const update = (i: number, patch: Partial<Edit>) =>
    setEdits(edits.map((x, j) => (i === j ? { ...x, ...patch } : x)))

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Proposed plan
          </span>
          <h2 className="text-[17px] leading-snug font-semibold tracking-tight">
            {edits.length} {edits.length === 1 ? 'task' : 'tasks'}
          </h2>
          <p className="text-sm text-muted-foreground">
            Each task runs as one prompt after a checkpoint commit. Edit titles inline, reorder, and
            mark a test-first task's commands as expected to fail.
          </p>
        </div>
      </div>

      <ol className="flex flex-col gap-1.5">
        {edits.map((e, i) => {
          const expectFailingInputId = `expect-failing-${i}`
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional here
            <li key={i} className="flex gap-2.5 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
              <GripVertical
                className="mt-1.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="mt-1.5 w-4 shrink-0 text-right font-mono text-xs text-muted-foreground">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Input
                  className="-ml-2 h-7 border-transparent bg-transparent px-2 font-medium shadow-none hover:border-input focus-visible:border-input dark:bg-transparent"
                  value={e.title}
                  aria-label={`Task ${i + 1} title`}
                  onChange={(ev) => update(i, { title: ev.target.value })}
                />
                {/* htmlFor/id, mirroring DecisionCard's pattern for labeling a custom
                    control: Biome's noLabelWithoutControl can't see through Input to the
                    native <input> it wraps, but a paired id keeps the real association. */}
                <label
                  htmlFor={expectFailingInputId}
                  className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                >
                  Expected to fail:
                  <Input
                    id={expectFailingInputId}
                    className="h-6 max-w-64 font-mono text-xs"
                    placeholder="command ids, comma-separated"
                    value={e.expectFailingText}
                    aria-label={`Task ${i + 1} expected failing commands`}
                    onChange={(ev) => update(i, { expectFailingText: ev.target.value })}
                  />
                </label>
              </div>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label={`Move task ${i + 1} up`}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label={`Move task ${i + 1} down`}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label={`Remove task ${i + 1}`}
                  onClick={() => setEdits(edits.filter((_, j) => j !== i))}
                >
                  <X aria-hidden />
                </Button>
              </div>
            </li>
          )
        })}
      </ol>

      <ActionBar>
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
          <Check />
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
        {pending > 0 && (
          <span className="ml-1 text-xs text-muted-foreground" role="status">
            {pending} {pending === 1 ? 'edit' : 'edits'} pending — sent with the approval.
          </span>
        )}
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={() => onCommand({ type: 'pause' })}>
          <Pause />
          Pause
        </Button>
      </ActionBar>
    </section>
  )
}
