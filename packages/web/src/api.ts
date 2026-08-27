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
  /** A "Continue" follow-up's link back to the objective it continued from, if any. */
  continuedFromId: string | null
  /** Amendment A12: D8's toggle. */
  lowEnergy: boolean
  /** D1's two paths, plus amendment A15's read-only investigation. */
  mode: 'standard' | 'fastfix' | 'investigation'
  /** Already sent by the server on every response; only just declared client-side. */
  updatedAt: string
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
  /**
   * Already sent by the server on every response — the aggregate's task query
   * is an unqualified `select()` — and only just declared client-side, the same
   * situation `Objective.updatedAt` was in before A18. `startedAt` is what
   * elapsed time is computed from; without it the Focus View had no timestamp
   * to derive it from at all.
   */
  startedAt: string | null
  finishedAt: string | null
  checkpointRef: string | null
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
  /**
   * The three activity signals, read off the append-only event log by
   * `packages/server/src/http/activity.ts`. Like `lastAutoApproval`, the
   * aggregate is the only channel they can reach the UI through: the frontend
   * never reads SSE payloads (spec §7).
   */
  lastStatus: { headline: string; phase: string | null; at: string } | null
  lastAgentUpdateAt: string | null
  lastProblem: { type: string; message: string | null; at: string } | null
  /**
   * Whether the recorded worktree directory is gone. Covers `vanished` only —
   * see the server-side comment on why a claimed `stranded` worktree is the
   * `/git` console's to report rather than this field's.
   */
  worktreeMissing: boolean
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

export type GitOwner =
  | { kind: 'vadd'; objectiveId: string; objectiveTitle: string; objectiveStatus: string }
  | { kind: 'orphan' }
  | { kind: 'user' }

export type GitBranch = {
  name: string
  sha: string
  isCurrent: boolean
  upstream: string | null
  /**
   * `null` means BOTH "no upstream configured" and "the counts could not be
   * computed" — the console renders nothing in either case rather than
   * guessing which.
   */
  ahead: number | null
  behind: number | null
  owner: GitOwner
}

export type GitRemote = { name: string; fetchUrl: string; pushUrl: string }

export type StrayClaim = { objectiveId: string; objectiveTitle: string; objectiveStatus: string }

export type GitStray =
  | { kind: 'vanished'; path: string; claim: StrayClaim; branchName: string | null }
  | { kind: 'stranded'; path: string; claim: StrayClaim | null }

export type GitWorktree = {
  path: string
  branch: string | null
  head: string
  isMain: boolean
  locked: boolean
  prunable: boolean
  owner: GitOwner
}

export type GitMutationReport = {
  describes: string
  /** Paths a `policy.protectedGlobs` rule kept out of a commit. */
  excludedPaths?: string[]
  /** Tasks whose rollback point a rewrite destroyed. */
  clearedCheckpoints?: { taskId: string; ord: number; title: string }[]
}

export type FsEntry = { name: string; path: string; isGitRepo: boolean }
export type FsBrowseResult = { path: string; parent: string | null; entries: FsEntry[] }

export type GitTopology = {
  mainRepoPath: string
  currentBranch: string | null
  branches: GitBranch[]
  worktrees: GitWorktree[]
}

export type GitCommit = {
  sha: string
  parents: string[]
  subject: string
  author: string
  at: string
  refs: string[]
}

/**
 * An error that keeps the response body.
 *
 * `message` is unchanged, so every existing `(e as Error).message` call site
 * behaves exactly as before; the body is there for the callers that need a
 * field the message cannot honestly carry — the objective a git refusal
 * names, so the console can offer its Pause without parsing prose.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status, body)
  }
  return res.json() as Promise<T>
}

export const api = {
  listProjects: () => fetch('/api/projects').then(json<Project[]>),

  browseFs: (path?: string) =>
    fetch(path ? `/api/fs/browse?path=${encodeURIComponent(path)}` : '/api/fs/browse').then(
      json<FsBrowseResult>,
    ),

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

  createObjective: (
    projectId: string,
    title: string,
    goalText: string,
    mode: 'standard' | 'fastfix' | 'investigation' = 'standard',
  ) =>
    fetch(`/api/projects/${projectId}/objectives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, goalText, mode }),
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

  getGitTopology: (projectId: string) =>
    fetch(`/api/projects/${projectId}/git`).then(json<GitTopology>),

  getGitLog: (projectId: string, opts: { ref?: string; before?: string; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (opts.ref !== undefined) q.set('ref', opts.ref)
    if (opts.before !== undefined) q.set('before', opts.before)
    q.set('limit', String(opts.limit ?? 50))
    return fetch(`/api/projects/${projectId}/git/log?${q}`).then(
      json<{ commits: GitCommit[]; hasMore: boolean }>,
    )
  },

  getGitStatus: (projectId: string, worktree: string) =>
    fetch(`/api/projects/${projectId}/git/status?worktree=${encodeURIComponent(worktree)}`).then(
      json<{ staged: number; unstaged: number; untracked: number }>,
    ),

  getGitRemotes: (projectId: string) =>
    fetch(`/api/projects/${projectId}/git/remotes`).then(json<{ remotes: GitRemote[] }>),

  getGitStrays: (projectId: string) =>
    fetch(`/api/projects/${projectId}/git/strays`).then(json<{ strays: GitStray[] }>),

  /**
   * Amendment A19's mutations. One method, because every route has the same
   * shape — a body naming its target, a `{ report }` on success — and sixteen
   * near-identical wrappers would be sixteen places for one to drift.
   */
  gitMutate: (projectId: string, op: string, body: Record<string, unknown>) =>
    fetch(`/api/projects/${projectId}/git/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(json<{ report: GitMutationReport }>),
}
