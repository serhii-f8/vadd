import type { MachineStateName } from '@vadd/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { type Aggregate, api } from '../api.js'
import { EvidencePanel } from '../evidence/EvidencePanel.js'
import { DecisionCard } from '../focus/DecisionCard.js'
import { IntegrationChooser } from '../focus/IntegrationChooser.js'
import { LiveTask } from '../focus/LiveTask.js'
import { PlanApproval } from '../focus/PlanApproval.js'
import { primaryElementFor } from '../focus/primary.js'

/**
 * The server's refusal messages repeat the *current* state (`Command "x" is
 * not accepted in state "y"`), and the header already shows that state a
 * line above. Trimming the trailing quoted repeat avoids saying the same
 * word twice on screen — the reason, not the already-visible state, is what
 * the banner adds.
 */
function withoutRedundantState(message: string, state: string): string {
  return message.replace(new RegExp(`\\s*"${state}"\\s*$`), '')
}

export function FocusView() {
  const { id } = useParams<{ id: string }>()
  const [aggregate, setAggregate] = useState<Aggregate | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Guards against a refetch storm when events arrive faster than the fetch. */
  const inFlight = useRef(false)
  const pending = useRef(false)

  const refetch = useCallback(async () => {
    if (!id) return
    if (inFlight.current) {
      pending.current = true
      return
    }
    inFlight.current = true
    try {
      setAggregate(await api.getObjective(id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      if (pending.current) {
        pending.current = false
        void refetch()
      }
    }
  }, [id])

  useEffect(() => {
    void refetch()
  }, [refetch])

  // Spec §7: the server is the single source of truth, and this view performs
  // no client-side transitions. Events are a *change signal* — their payloads
  // are never read into view state, because folding them in is a client-side
  // transition wearing a different hat.
  useEffect(() => {
    if (!id) return
    const es = new EventSource(`/api/events?objectiveId=${id}`)
    es.onmessage = () => {
      void refetch()
    }
    es.onerror = () => setError('SSE connection lost — retrying')
    return () => es.close()
  }, [id, refetch])

  const onCommand = useCallback(
    async (body: Record<string, unknown>) => {
      if (!id) return
      setError(null)
      try {
        await api.command(id, body)
        // A successful command is a 202 — accepted, not applied. The
        // resulting transition arrives through the SSE stream like any
        // other change, and refetches there; refetching here too would
        // just race an in-flight server-side transition.
      } catch (e) {
        // A refused command stays refused: show the server's own message,
        // which names the state, and refetch to confirm nothing moved.
        setError((e as Error).message)
        void refetch()
      }
    },
    [id, refetch],
  )

  if (!aggregate) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        {error !== null ? (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
            {error}
          </p>
        ) : (
          <p className="text-sm text-gray-600">Loading…</p>
        )}
      </main>
    )
  }

  const state = aggregate.state as MachineStateName
  const primary = primaryElementFor(state)
  const terminal = primary === 'outcome'
  const decision = aggregate.decisions.find((d) => d.chosenId === null) ?? aggregate.decisions[0]

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <Link to="/" className="text-sm underline">
            ← Objectives
          </Link>
          <h1 className="text-xl font-semibold">{aggregate.objective.title}</h1>
          <p className="text-sm text-gray-600">{state}</p>
        </div>
        <div className="flex gap-2">
          {!terminal && (
            <>
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm"
                onClick={() => void onCommand({ type: 'pause' })}
              >
                Pause
              </button>
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm"
                onClick={() => void onCommand({ type: 'abandon' })}
              >
                Abandon
              </button>
            </>
          )}
          <a className="text-sm underline" href={`/api/objectives/${aggregate.objective.id}/raw`}>
            Raw
          </a>
        </div>
      </header>

      {error !== null && (
        <p role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm">
          {withoutRedundantState(error, state)}
        </p>
      )}

      {primary === 'decision' && decision !== undefined && (
        <DecisionCard decision={decision} onCommand={(b) => void onCommand(b)} />
      )}
      {primary === 'plan' && (
        <PlanApproval tasks={aggregate.tasks} onCommand={(b) => void onCommand(b)} />
      )}
      {primary === 'live' && <LiveTask state={state} tasks={aggregate.tasks} />}
      {primary === 'review' && (
        <>
          <EvidencePanel aggregate={aggregate} onCommand={(b) => void onCommand(b)} />
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() => void onCommand({ type: 'approve_task' })}
            >
              Approve
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() =>
                void onCommand({ type: 'revise', instruction: 'Address the failing evidence.' })
              }
            >
              Revise
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() => void onCommand({ type: 'rollback' })}
            >
              Roll back
            </button>
          </div>
        </>
      )}
      {primary === 'integration' && <IntegrationChooser onCommand={(b) => void onCommand(b)} />}
      {primary === 'outcome' && (
        <section>
          <h2 className="text-lg font-medium">
            {state}
            {aggregate.objective.integrateAction !== null &&
              ` · ${aggregate.objective.integrateAction}`}
          </h2>
          <EvidencePanel aggregate={aggregate} onCommand={() => undefined} readOnly />
        </section>
      )}
      {primary === 'resume' && (
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => void onCommand({ type: state === 'paused' ? 'resume' : 'start' })}
          >
            {state === 'paused' ? 'Resume' : 'Start'}
          </button>
        </div>
      )}

      {/* Secondary strip: the task list as Level 0 dots. */}
      {aggregate.tasks.length > 0 && (
        <ul className="mt-8 flex gap-1" aria-label="Tasks">
          {aggregate.tasks.map((t) => (
            <li
              key={t.id}
              title={`${t.title} — ${t.status}`}
              className="h-2 w-2 rounded-full border"
            />
          ))}
        </ul>
      )}
    </main>
  )
}
