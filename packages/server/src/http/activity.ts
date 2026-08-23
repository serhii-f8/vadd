import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { events } from '../db/schema.js'

/**
 * "Is anything actually happening?", answered off the append-only event log.
 *
 * Nothing here is a new writer or a new column: every row read is one the
 * system already appends. The frontend never reads SSE payloads (spec §7), so
 * the aggregate is the only channel these can reach the Focus View through —
 * the same reason amendment A12's `lastAutoApproval` exists.
 */
export type Activity = {
  /** The agent's own last one-line status. Level 1, capped at 15 words by §10. */
  lastStatus: { headline: string; phase: string | null; at: string } | null
  /**
   * When the agent last produced *any* raw output. The liveness heartbeat: a
   * status headline can be minutes stale while the agent is mid-tool-call, and
   * a spinner that only tracked headlines would look frozen through it.
   */
  lastAgentUpdateAt: string | null
  /** The newest failure this objective hit, whatever came after it. */
  lastProblem: { type: string; message: string | null; at: string } | null
}

/**
 * Every event type that reports something going wrong.
 *
 * Listed explicitly rather than matched by a `%_failed` pattern: a pattern
 * would silently adopt any future event whose name happens to end that way,
 * and silently miss `verification_unresolved`, `turn_timed_out` and
 * `rollback_unavailable`, which are exactly the ones a stalled objective hits.
 */
const PROBLEM_TYPES = [
  'agent_failed',
  'agent_start_failed',
  'checkpoint_failed',
  'finish_objective_failed',
  'integrate_failed',
  'objective_create_failed',
  'prompt_rejected',
  'reconcile_evidence_failed',
  'record_decision_failed',
  'record_evidence_failed',
  'record_plan_failed',
  'rehydrate_failed',
  'repair_failed',
  'rollback_failed',
  'rollback_unavailable',
  'setup_failed',
  'task_index_invalid',
  'turn_timed_out',
  'verification_unresolved',
] as const

/** Payloads are not uniform; `message` is by far the most common carrier. */
function messageOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  if (typeof p.message === 'string') return p.message
  if (typeof p.reason === 'string') return p.reason
  return null
}

export function activityFor(db: Db, objectiveId: string): Activity {
  // Filtered in SQL rather than by scanning rows in JS: `agent_event` rows
  // accumulate without bound, and "read the newest one and hope it is a
  // status" is wrong — a `task_result` or `evidence` emission is newer far
  // more often than not, and carries no headline at all.
  const statusRow = db
    .select()
    .from(events)
    .where(
      and(
        eq(events.objectiveId, objectiveId),
        eq(events.type, 'agent_event'),
        sql`json_extract(${events.payload}, '$.event.type') = 'status'`,
      ),
    )
    .orderBy(desc(events.id))
    .limit(1)
    .get()

  const updateRow = db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.objectiveId, objectiveId), eq(events.type, 'agent_update')))
    .orderBy(desc(events.id))
    .limit(1)
    .get()

  const problemRow = db
    .select()
    .from(events)
    .where(and(eq(events.objectiveId, objectiveId), inArray(events.type, [...PROBLEM_TYPES])))
    .orderBy(desc(events.id))
    .limit(1)
    .get()

  const status = (statusRow?.payload as { event?: { headline?: unknown; phase?: unknown } })?.event

  return {
    lastStatus:
      statusRow && typeof status?.headline === 'string'
        ? {
            headline: status.headline,
            phase: typeof status.phase === 'string' ? status.phase : null,
            at: statusRow.createdAt,
          }
        : null,
    lastAgentUpdateAt: updateRow?.createdAt ?? null,
    lastProblem: problemRow
      ? {
          type: problemRow.type,
          message: messageOf(problemRow.payload),
          at: problemRow.createdAt,
        }
      : null,
  }
}
