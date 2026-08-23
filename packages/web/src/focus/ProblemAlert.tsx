import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * Plain wording for the failures an objective can hit.
 *
 * Every one of these was previously written to the event log and shown
 * nowhere: an objective could bounce `verifying → paused` indefinitely on
 * `verification_unresolved` while the Focus View's paused screen offered a
 * Resume button and no reason at all.
 */
const LABELS: Record<string, string> = {
  agent_failed: 'The agent process failed',
  agent_start_failed: 'The agent could not be started',
  checkpoint_failed: 'Could not write the task checkpoint commit',
  finish_objective_failed: 'Could not finish the objective',
  integrate_failed: 'Integration failed',
  objective_create_failed: 'The objective could not be created',
  prompt_rejected: 'The agent refused the prompt',
  reconcile_evidence_failed: 'Could not reconcile the evidence set',
  record_decision_failed: 'Could not record the decision',
  record_evidence_failed: 'Could not record the evidence',
  record_plan_failed: 'Could not record the plan',
  rehydrate_failed: 'Could not restore this objective after a restart',
  repair_failed: 'The repair prompt failed',
  rollback_failed: 'Roll back failed',
  rollback_unavailable: 'There is no checkpoint to roll back to',
  setup_failed: "The worktree's setup commands failed",
  task_index_invalid: 'The plan and the current task are out of step',
  turn_timed_out: 'The agent turn timed out',
  verification_unresolved: 'No verification spec could be resolved',
}

/**
 * Falls back to the raw event type rather than to nothing: the set of problem
 * types grows independently of this map, and a bare type name still tells the
 * user more than a blank screen does.
 */
export function problemLabel(type: string): string {
  return LABELS[type] ?? type
}

export function ProblemAlert({
  problem,
}: {
  problem: { type: string; message: string | null; at: string }
}) {
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTitle>{problemLabel(problem.type)}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-1">
        {problem.message !== null && <span className="font-mono text-xs">{problem.message}</span>}
        {/* The timestamp is not decoration: this is the newest problem the
            objective ever hit, not necessarily a current one, and an hour-old
            failure must not read as something that just happened. */}
        <time dateTime={problem.at} className="text-xs opacity-80">
          {new Date(problem.at).toLocaleString()}
        </time>
      </AlertDescription>
    </Alert>
  )
}
