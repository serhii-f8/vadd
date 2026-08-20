import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { type Aggregate, api } from '../api.js'
import { EvidencePanel } from '../evidence/EvidencePanel.js'
import { AutoApprovalBanner } from '../focus/AutoApprovalBanner.js'
import { ClarificationPrompt } from '../focus/ClarificationPrompt.js'
import { DecisionCard } from '../focus/DecisionCard.js'
import { IntegrationChooser } from '../focus/IntegrationChooser.js'
import { LiveTask } from '../focus/LiveTask.js'
import { PlanApproval } from '../focus/PlanApproval.js'
import { primaryElementFor } from '../focus/primary.js'

export function FocusView() {
  const { id } = useParams<{ id: string }>()
  const [aggregate, setAggregate] = useState<Aggregate | null>(null)
  /**
   * Two error kinds, deliberately separate. A load or stream error is transient
   * and must clear the moment the next fetch succeeds; a refused command stays
   * refused, and clearing it on the refetch the same handler fires would erase
   * the only thing telling the user why. Only the next command clears that one.
   */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const error = commandError ?? loadError
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
      setLoadError(null)
    } catch (e) {
      setLoadError((e as Error).message)
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
      // An event arriving *is* the connection working. `EventSource` reconnects
      // on its own, so a banner left up after the blip is a lie.
      setLoadError(null)
      void refetch()
    }
    es.onerror = () => setLoadError('SSE connection lost — retrying')
    return () => es.close()
  }, [id, refetch])

  const onCommand = useCallback(
    async (body: Record<string, unknown>) => {
      if (!id) return
      setCommandError(null)
      try {
        await api.command(id, body)
      } catch (e) {
        // A refused command stays refused: show the server's own message,
        // which names the state, verbatim — it's the only thing telling the
        // user *why* the command was refused, and trimming it would cost a
        // screen-reader user (who reaches the alert on its own) the reason.
        setCommandError((e as Error).message)
      }
      // Refetch unconditionally, success or failure. A successful command
      // does cause the machine to transition (and that transition's own SSE
      // event will trigger a further refetch), but this one costs one cheap
      // localhost request and is real insurance against a missed event.
      void refetch()
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

  const state = aggregate.state
  const primary = primaryElementFor(state)
  /**
   * Pause and Abandon are offered only where they mean something.
   *
   * `outcome` is terminal — nothing left to pause or abandon. `setup` is the
   * window where `runSetup` is installing dependencies **into the worktree
   * Abandon would remove**, fire-and-forget, and it writes the objective's
   * status again when it finishes — so an Abandon here races a live
   * `composer install` and then has its `cancelled` status overwritten.
   */
  const headerActions = primary !== 'outcome' && primary !== 'setup'
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
          {headerActions && (
            <>
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm"
                aria-pressed={aggregate.objective.lowEnergy}
                onClick={() =>
                  void onCommand({ type: 'set_low_energy', value: !aggregate.objective.lowEnergy })
                }
              >
                {aggregate.objective.lowEnergy ? 'Low Energy: On' : 'Low Energy: Off'}
              </button>
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
          {error}
        </p>
      )}

      <AutoApprovalBanner
        lastAutoApproval={aggregate.lastAutoApproval}
        onCommand={(b) => void onCommand(b)}
      />

      {/* Both are 'decision', and they are not interchangeable: a clarification
          never writes a `decisions` row, so `clarifying` has to be told apart
          by state rather than by whether a row happens to be present. */}
      {primary === 'decision' && state === 'clarifying' && (
        <ClarificationPrompt
          question={aggregate.pendingClarification}
          onCommand={(b) => void onCommand(b)}
        />
      )}
      {primary === 'decision' && state !== 'clarifying' && decision !== undefined && (
        <DecisionCard decision={decision} onCommand={(b) => void onCommand(b)} />
      )}
      {primary === 'setup' && (
        <section>
          <h2 className="text-lg font-medium">Setting up</h2>
          <p className="text-sm text-gray-600">
            Installing this objective's dependencies in its worktree. Nothing to do yet.
          </p>
        </section>
      )}
      {primary === 'plan' && (
        <PlanApproval tasks={aggregate.tasks} onCommand={(b) => void onCommand(b)} />
      )}
      {primary === 'live' && <LiveTask tasks={aggregate.tasks} />}
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
      {primary === 'integration' && <IntegrationChooser mode={aggregate.objective.mode} onCommand={(b) => void onCommand(b)} />}
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
        <>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() => void onCommand({ type: state === 'paused' ? 'resume' : 'start' })}
            >
              {state === 'paused' ? 'Resume' : 'Start'}
            </button>
            {/* Only once a plan exists — `paused` before any task has a
                checkpoint to roll back to, and the machine's own ROLLBACK
                guard would refuse it. */}
            {state === 'paused' && aggregate.tasks.length > 0 && (
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={() => void onCommand({ type: 'rollback' })}
              >
                Roll back
              </button>
            )}
          </div>
          {/*
            A red evidence set is *why* `verifying` drops to `paused` — spec §5
            forbids it entering `awaitingReview` — so this is exactly where the
            user needs to see which check failed, and it is the only place they
            can tick one to satisfy it by hand (spec §6). Without the panel
            here, that tick control is only ever mounted in `awaitingReview`,
            where every check is already green, and its sole live function is
            unticking. `RESUME` re-enters `verifying`, which reconciles and
            picks the tick up.
          */}
          {state === 'paused' && (
            <EvidencePanel aggregate={aggregate} onCommand={(b) => void onCommand(b)} />
          )}
        </>
      )}

      {/* Secondary strip: the task list as Level 0 dots. Hidden in Low Energy
          Mode (D8) — that's the whole point of the mode. */}
      {!aggregate.objective.lowEnergy && aggregate.tasks.length > 0 && (
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
