import { scoreOption } from '@vadd/core/scoring/option-priority.js'
import { Activity, Check, Clock, FlaskConical, Minus, Pause, Plus, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { Decision } from '../api.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group.js'
import { ActionBar } from './ActionBar.js'

type Option = Decision['options'][number]

function OptionCard({
  option: o,
  decisionId,
  recommended,
  chosen,
}: {
  option: Option
  decisionId: string
  recommended: boolean
  chosen: boolean
}) {
  const id = `${decisionId}-${o.id}`
  return (
    <label
      htmlFor={id}
      data-chosen={chosen}
      className={`flex cursor-pointer gap-3 rounded-xl bg-card p-4 ring-1 transition-shadow ${
        chosen ? 'ring-2 ring-primary' : 'ring-foreground/10 hover:ring-foreground/25'
      }`}
    >
      <RadioGroupItem id={id} value={o.id} aria-label={o.label} className="mt-1" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <span className="text-[15px] leading-snug font-medium">
            {o.label}
            {recommended && (
              <Badge className="ml-2 bg-status-done/15 align-[2px] text-foreground">
                <Check aria-hidden="true" />
                Recommended
              </Badge>
            )}
          </span>
          <span className="flex shrink-0 flex-wrap gap-1.5">
            {/* Spec §4's ONLY mandatory analysis field — always visible. */}
            <Badge variant="outline" className="font-normal text-muted-foreground">
              <Undo2 aria-hidden="true" />
              reversibility: {o.reversibility}
            </Badge>
            {o.effort !== undefined && (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                <Clock aria-hidden="true" />
                effort: {o.effort}
              </Badge>
            )}
            {/* Amendment A16: informational only — no reordering, no change to
                recommendedId or which option is pre-selected. */}
            <Badge variant="outline" className="font-normal text-muted-foreground">
              <Activity aria-hidden="true" />
              priority: {scoreOption(o).toFixed(2)}
            </Badge>
          </span>
        </div>
        {(o.pros.length > 0 || o.cons.length > 0) && (
          <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 md:grid-cols-2">
            <ul className="flex flex-col gap-1" aria-label="Pros">
              {o.pros.map((p) => (
                <li key={p} className="flex gap-2 text-[13px]">
                  <Plus className="mt-0.5 size-3.5 shrink-0 text-status-done" aria-hidden="true" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-1" aria-label="Cons">
              {o.cons.map((c) => (
                <li key={c} className="flex gap-2 text-[13px]">
                  <Minus
                    className="mt-0.5 size-3.5 shrink-0 text-status-failed"
                    aria-hidden="true"
                  />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="flex gap-1.5 border-t border-dashed border-border pt-2 text-xs text-muted-foreground">
          <FlaskConical className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">Verified by</span> {o.verification}
          </span>
        </p>
      </div>
    </label>
  )
}

export function DecisionCard({
  decision,
  onCommand,
}: {
  decision: Decision
  onCommand: (body: Record<string, unknown>) => void
}) {
  const [chosen, setChosen] = useState(decision.recommendedId)

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          Decision
        </span>
        <h2 className="text-[19px] leading-snug font-semibold tracking-tight">
          {decision.question}
        </h2>
      </div>
      <RadioGroup value={chosen} onValueChange={setChosen} className="flex flex-col gap-2.5">
        {decision.options.map((o) => (
          <OptionCard
            key={o.id}
            option={o}
            decisionId={decision.id}
            recommended={o.id === decision.recommendedId}
            chosen={o.id === chosen}
          />
        ))}
      </RadioGroup>
      <ActionBar>
        {/* §8's first listed action, and the common case: the recommendation is
            already pre-selected, so requiring a separate Choose click was a
            redundant step. */}
        <Button
          onClick={() =>
            onCommand({ type: 'decide', decisionId: decision.id, optionId: decision.recommendedId })
          }
        >
          <Check />
          Approve recommended
        </Button>
        <Button
          variant="outline"
          onClick={() => onCommand({ type: 'decide', decisionId: decision.id, optionId: chosen })}
        >
          Choose selected
        </Button>
        <Button
          variant="ghost"
          onClick={() => onCommand({ type: 'revise', instruction: 'Propose different options.' })}
        >
          Ask for alternatives
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" onClick={() => onCommand({ type: 'pause' })}>
          <Pause />
          Pause
        </Button>
      </ActionBar>
    </section>
  )
}
