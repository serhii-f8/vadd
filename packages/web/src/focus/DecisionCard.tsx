import { useState } from 'react'
import type { Decision } from '../api.js'

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
      <ul className="space-y-3">
        {decision.options.map((o) => (
          <li key={o.id} className="rounded border p-3">
            <label className="flex items-start gap-3">
              <input
                type="radio"
                name="decision-option"
                aria-label={o.label}
                checked={chosen === o.id}
                onChange={() => setChosen(o.id)}
              />
              <span>
                <span className="font-medium">{o.label}</span>
                {o.id === decision.recommendedId && (
                  <span className="ml-2 text-xs text-gray-600">recommended</span>
                )}
                <span className="ml-2 text-xs">
                  {/* Spec §4's ONLY mandatory analysis field — always visible. */}
                  reversibility: {o.reversibility}
                  {o.effort !== undefined && ` · effort: ${o.effort}`}
                </span>
                {o.pros.length > 0 && <span className="block text-sm">+ {o.pros.join('; ')}</span>}
                {o.cons.length > 0 && <span className="block text-sm">− {o.cons.join('; ')}</span>}
                <span className="block text-sm text-gray-600">verify: {o.verification}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="rounded border px-3 py-1"
          onClick={() => onCommand({ type: 'decide', decisionId: decision.id, optionId: chosen })}
        >
          Choose
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1"
          onClick={() => onCommand({ type: 'revise', instruction: 'Propose different options.' })}
        >
          Ask for alternatives
        </button>
      </div>
    </section>
  )
}
