export type Project = { id: string; name: string; repoPath: string }
export type Objective = {
  id: string
  projectId: string
  title: string
  status: string
  worktreePath: string | null
  branchName: string | null
}
export type VaddEvent = {
  id: number
  objectiveId: string | null
  type: string
  payload: unknown
  createdAt: string
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

  registerProject: (repoPath: string) =>
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath }),
    }).then(json<Project>),

  createObjective: (projectId: string, title: string, goalText: string) =>
    fetch(`/api/projects/${projectId}/objectives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, goalText }),
    }).then(json<Objective>),

  sendPrompt: (objectiveId: string, body: { text: string } | { phase: string }) =>
    fetch(`/api/objectives/${objectiveId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'prompt', ...body }),
    }).then(json<{ ok: boolean }>),

  discard: (objectiveId: string) =>
    fetch(`/api/objectives/${objectiveId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'integrate', action: 'discard' }),
    }).then(json<{ ok: boolean }>),
}
