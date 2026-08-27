import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { type Aggregate, api } from '../api.js'
import { EvidencePanel } from '../evidence/EvidencePanel.js'
import { AbandonButton } from '../focus/AbandonButton.js'
import { AutoApprovalBanner } from '../focus/AutoApprovalBanner.js'
import { BranchStrip } from '../focus/BranchStrip.js'
import { ClarificationPrompt } from '../focus/ClarificationPrompt.js'
import { DecisionCard } from '../focus/DecisionCard.js'
import { GitStrip } from '../focus/GitStrip.js'
import { IntegrationChooser } from '../focus/IntegrationChooser.js'
import { LiveTask } from '../focus/LiveTask.js'
import { PlanApproval } from '../focus/PlanApproval.js'
import { ProblemAlert } from '../focus/ProblemAlert.js'
import { primaryElementFor, type ViewStateName } from '../focus/primary.js'
import { TaskList } from '../focus/TaskList.js'
import { NewObjectiveDialog } from '../objectives/NewObjectiveDialog.js'
import { statusFor } from './stateColor.js'

/**
 * Where the Focus View offers A19's git controls: the states in which the
 * objective is stopped and the worktree is the user's to work in.
 *
 * Deliberately a small allow-list rather than "not busy". The busy set is the
 * server's to enforce; this is a narrower editorial question — which screens
 * should carry a git control at all — and an allow-list makes a new state's
 * answer an explicit decision instead of a default.
 */
const GIT_STATES = new Set(['paused', 'awaitingReview', 'failed'])

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
  /**
   * What A19's one-step undo would restore on this objective's worktree.
   *
   * Held here rather than fetched: `git_undo` has no read route, and the only
   * record this surface can honestly offer is the one it just created. A
   * mutation made elsewhere — the `/git` console, a terminal — is not
   * something the Focus View should claim it can undo.
   */
  const [gitUndoable, setGitUndoable] = useState<string | null>(null)
  /** Whether the terminal state's "Continue" dialog, seeded from this objective, is open. */
  const [continuing, setContinuing] = useState(false)
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
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
      </main>
    )
  }

  const state = aggregate.state
  const primary = primaryElementFor(state)
  const status = statusFor(state as ViewStateName)
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
  /**
   * States where nothing is in flight and the user is owed a reason. `done`
   * and `cancelled` are deliberately excluded: a completed objective that hit
   * a transient failure on the way does not need it re-raised as an alert.
   */
  const showProblem =
    state === 'paused' || state === 'failed' || state === 'setup_failed' || state === 'idle'
  /**
   * `primary === 'outcome'` covers FOUR states (`done`/`cancelled`/`failed`
   * plus `setup_failed`, per `primary.ts`), but "Continue" is only meant for
   * the three genuinely terminal ones. `setup_failed` is a worktree that
   * failed its one-shot setup command — it still owns a live
   * `branchName`/`worktreePath` and isn't the "nothing left to do here"
   * state the other three are, so it stays off this list rather than
   * inheriting a button nobody designed for it.
   */
  const canContinue = state === 'done' || state === 'cancelled' || state === 'failed'

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="sticky top-0 z-10 -mx-6 mb-6 flex items-baseline justify-between gap-4 border-b border-border bg-background px-6 py-4">
        <div>
          <Link to="/" className="text-sm underline">
            ← Objectives
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{aggregate.objective.title}</h1>
          <Badge variant="outline" className="mt-1 gap-1.5">
            <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" />
            {status.label}
            <span className="font-mono text-muted-foreground">{state}</span>
          </Badge>
          <BranchStrip
            projectId={aggregate.objective.projectId}
            branchName={aggregate.objective.branchName}
            worktreePath={aggregate.objective.worktreePath}
            worktreeMissing={aggregate.worktreeMissing}
          />
        </div>
        <div className="flex items-center gap-2">
          {headerActions && (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={aggregate.objective.lowEnergy}
                onClick={() =>
                  void onCommand({ type: 'set_low_energy', value: !aggregate.objective.lowEnergy })
                }
              >
                {aggregate.objective.lowEnergy ? 'Low Energy: On' : 'Low Energy: Off'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void onCommand({ type: 'pause' })}>
                Pause
              </Button>
              <AbandonButton
                title={aggregate.objective.title}
                onConfirm={() => void onCommand({ type: 'abandon' })}
              />
            </>
          )}
          <Button variant="ghost" size="sm" asChild>
            <a href={`/api/objectives/${aggregate.objective.id}/raw`}>Raw</a>
          </Button>
        </div>
      </header>

      {error !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/*
        Amendment A19's Focus View subset, under two conditions.

        There must be a worktree to act on: `integrate: commit` and `discard`
        both clear the column, and offering to commit into a directory that no
        longer exists is the mistake `BranchStrip` already guards against.

        And the objective must be stopped. Spec §8 fixes one primary element
        per state, and a commit box standing next to a clarification prompt's
        own input — in a state where the agent is mid-turn and nothing the
        user commits would survive the next checkpoint — is exactly the "not
        becoming a git client" line the design draws. This is the same
        reasoning `ProblemAlert` below already uses: show it where the user is
        looking at a stopped objective and wondering what to do with it. The
        server gates every mutation regardless; this only decides where to
        offer one.
      */}
      {aggregate.objective.worktreePath !== null && GIT_STATES.has(state) && (
        <div className="mb-4">
          <GitStrip
            projectId={aggregate.objective.projectId}
            worktreePath={aggregate.objective.worktreePath}
            status={state}
            undoable={gitUndoable}
            onDone={(next) => {
              setGitUndoable(next)
              void refetch()
            }}
          />
        </div>
      )}

      {/*
        `lastProblem` is the newest problem the objective *ever* hit, not
        necessarily a live one, so it is shown only in the states where the
        user is looking at a stopped objective and wondering why. Carrying it
        through a healthy run would turn a recovered failure into a permanent
        red banner.
      */}
      {showProblem && aggregate.lastProblem !== null && (
        <ProblemAlert problem={aggregate.lastProblem} />
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
          <p className="text-sm text-muted-foreground">
            Installing this objective's dependencies in its worktree. Nothing to do yet.
          </p>
        </section>
      )}
      {primary === 'plan' && (
        <PlanApproval tasks={aggregate.tasks} onCommand={(b) => void onCommand(b)} />
      )}
      {primary === 'live' && (
        <LiveTask
          tasks={aggregate.tasks}
          lastStatus={aggregate.lastStatus}
          lastAgentUpdateAt={aggregate.lastAgentUpdateAt}
        />
      )}
      {primary === 'review' && (
        <>
          <EvidencePanel aggregate={aggregate} onCommand={(b) => void onCommand(b)} />
          <div className="mt-4 flex gap-2">
            <Button onClick={() => void onCommand({ type: 'approve_task' })}>Approve</Button>
            <Button
              variant="outline"
              onClick={() =>
                void onCommand({ type: 'revise', instruction: 'Address the failing evidence.' })
              }
            >
              Revise
            </Button>
            <Button variant="outline" onClick={() => void onCommand({ type: 'rollback' })}>
              Roll back
            </Button>
          </div>
        </>
      )}
      {primary === 'integration' && (
        <IntegrationChooser mode={aggregate.objective.mode} onCommand={(b) => void onCommand(b)} />
      )}
      {primary === 'outcome' && (
        <section>
          <h2 className="text-lg font-medium">
            {state}
            {aggregate.objective.integrateAction !== null &&
              ` · ${aggregate.objective.integrateAction}`}
          </h2>
          <EvidencePanel aggregate={aggregate} onCommand={() => undefined} readOnly />
          {canContinue && (
            <>
              <div className="mt-4">
                <Button variant="outline" onClick={() => setContinuing(true)}>
                  Continue
                </Button>
              </div>
              <NewObjectiveDialog
                open={continuing}
                onOpenChange={setContinuing}
                seed={{ continuedFromId: aggregate.objective.id }}
              />
            </>
          )}
        </section>
      )}
      {primary === 'resume' && (
        <>
          <div className="flex gap-2">
            <Button
              onClick={() => void onCommand({ type: state === 'paused' ? 'resume' : 'start' })}
            >
              {state === 'paused' ? 'Resume' : 'Start'}
            </Button>
            {/* Only once a plan exists — `paused` before any task has a
                checkpoint to roll back to, and the machine's own ROLLBACK
                guard would refuse it. */}
            {state === 'paused' && aggregate.tasks.length > 0 && (
              <Button variant="outline" onClick={() => void onCommand({ type: 'rollback' })}>
                Roll back
              </Button>
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

      {/* The plan, in full. Hidden in Low Energy Mode (D8) — that's the whole
          point of the mode. It replaces a strip of 8px dots whose titles were
          reachable only one hover at a time. */}
      {!aggregate.objective.lowEnergy && aggregate.tasks.length > 0 && (
        <div className="mt-8">
          <TaskList tasks={aggregate.tasks} />
        </div>
      )}
    </main>
  )
}
