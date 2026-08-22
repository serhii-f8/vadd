import type { EvidenceRow } from './evidence/group.js'
import type { ViewStateName } from './focus/primary.js'

export type Project = {
  id: string
  name: string
  repoPath: string
  agentKind: 'claude-code' | 'codex'
}

export type Objective = {
  id: string
  projectId: string
  title: string
  goalText: string
  status: string
  worktreePath: string | null
  branchName: string | null
  baseSha: string | null
  integrateAction: 'commit' | 'keep' | 'discard' | null
  /** Amendment A12: D8's toggle. */
  lowEnergy: boolean
  /** D1's two paths, plus amendment A15's read-only investigation. */
  mode: 'standard' | 'fastfix' | 'investigation'
}

/**
 * `GET /api/objectives` — the list route only. `verifiedCount`/`totalCount`
 * are computed for the list and never present on the bare Drizzle row
 * `GET /api/objectives/:id` returns as `Aggregate.objective` — keep them off
 * `Objective` itself or that field type-checks as `number` while being
 * `undefined` at runtime.
 */
export type ObjectiveListRow = Objective & { verifiedCount: number; totalCount: number }

export type VaddEvent = {
  id: number
  objectiveId: string | null
  type: string
  payload: unknown
  createdAt: string
}

export type PlanTask = {
  id: string
  ord: number
  title: string
  description: string
  status: 'pending' | 'running' | 'verifying' | 'verified' | 'failed' | 'skipped'
  /** Amendment A11. Null (not an empty array) when the row column is unset. */
  expectFailing: string[] | null
}

export type Decision = {
  id: string
  question: string
  options: Array<{
    id: string
    label: string
    pros: string[]
    cons: string[]
    effort?: 'S' | 'M' | 'L'
    reversibility: 'high' | 'medium' | 'low'
    verification: string
  }>
  recommendedId: string
  chosenId: string | null
}

/** `GET /api/objectives/:id` — spec §7's full aggregate. The only source of view state. */
export type Aggregate = {
  objective: Objective
  state: ViewStateName
  tasks: PlanTask[]
  decisions: Decision[]
  evidence: EvidenceRow[]
  /**
   * The open clarifying question, read from the live actor's context. A
   * clarification writes no `decisions` row — this is the only place it exists,
   * and without it `clarifying` is a dead end with nothing on screen.
   */
  pendingClarification: string | null
  /**
   * Amendment A12. The most recent auto-approval, if any — the only way the
   * UI learns one happened, since the raise that produces it means
   * `awaitingReview`/`awaitingPlanApproval` are never actually rendered.
   */
  lastAutoApproval: { kind: 'task' | 'plan'; taskOrd: number | null; at: string } | null
}

export type DiffFile = {
  path: string
  added: number
  removed: number
  committed: boolean
  dirty: boolean
}
export type DiffSummary = {
  files: DiffFile[]
  totals: { files: number; added: number; removed: number }
}

export type TodaySummary = {
  date: string
  verifiedTasks: number
  decisionsMade: number
  checksPassed: number
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listProjects: () => fetch('/api/projects').then(json<Project[]>),

  registerProject: (repoPath: string, agentKind: 'claude-code' | 'codex', name?: string) =>
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `name` is omitted rather than sent as undefined: the server defaults it
      // to `basename(toplevel)`, and an explicit null would fail `min(1)`.
      body: JSON.stringify(
        name === undefined ? { repoPath, agentKind } : { repoPath, agentKind, name },
      ),
    }).then(json<Project>),

  createObjective: (projectId: string, title: string, goalText: string) =>
    fetch(`/api/projects/${projectId}/objectives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, goalText }),
    }).then(json<Objective>),

  sendPrompt: (
    objectiveId: string,
    body: { text: string } | { phase: string; vars?: Record<string, string> },
  ) =>
    fetch(`/api/objectives/${objectiveId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'prompt', ...body }),
    }).then(json<{ ok: boolean }>),

  deleteObjective: (objectiveId: string) =>
    fetch(`/api/objectives/${objectiveId}`, { method: 'DELETE' }).then(json<{ ok: boolean }>),

  listObjectives: (projectId?: string) =>
    fetch(projectId ? `/api/objectives?projectId=${projectId}` : '/api/objectives').then(
      json<ObjectiveListRow[]>,
    ),

  getObjective: (id: string) => fetch(`/api/objectives/${id}`).then(json<Aggregate>),

  getDiff: (id: string) => fetch(`/api/objectives/${id}/diff`).then(json<DiffSummary>),

  getFileDiff: async (id: string, path: string): Promise<string> => {
    const res = await fetch(`/api/objectives/${id}/diff?file=${encodeURIComponent(path)}`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.text()
  },

  getToday: (projectId: string) =>
    fetch(`/api/projects/${projectId}/today`).then(json<TodaySummary>),

  /**
   * Every user command. Returns the server's own refusal message on a 409 by
   * throwing — the Focus View shows it and refetches, and never advances on
   * its own (spec §7: no client-side transitions).
   */
  command: (objectiveId: string, body: Record<string, unknown>) =>
    fetch(`/api/objectives/${objectiveId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(json<{ ok: boolean; state?: string }>),

  /** A plain URL, not a fetch: the panel renders it as a link the user can open. */
  artifactUrl: (evidenceId: string) => `/api/evidence/${evidenceId}/artifact`,
}
