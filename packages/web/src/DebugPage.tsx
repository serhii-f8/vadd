import { useEffect, useState } from 'react'
import { api, type Objective, type Project, type VaddEvent } from './api.js'

// Mirrors packages/server/src/prompts/renderer.ts PROMPT_PHASES. The web
// package has no dependency on the server package, so this list is
// duplicated rather than imported; an unknown phase still fails loudly with
// the server's 400, so drift here is a UI nuisance, not a correctness bug.
const PROMPT_PHASES = [
  'explore',
  'clarify',
  'propose',
  'plan',
  'execute-task',
  'verify',
  'review',
] as const

export function DebugPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [objective, setObjective] = useState<Objective | null>(null)
  const [events, setEvents] = useState<VaddEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  const [repoPath, setRepoPath] = useState('')
  const [title, setTitle] = useState('')
  const [goalText, setGoalText] = useState('')
  const [prompt, setPrompt] = useState('')
  const [phase, setPhase] = useState<(typeof PROMPT_PHASES)[number]>(PROMPT_PHASES[0])

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e: Error) => setError(e.message))
  }, [])

  // EventSource reconnects on its own and replays Last-Event-ID, so a dropped
  // connection self-heals with no gap (design §4.2).
  useEffect(() => {
    if (!objective) return
    const es = new EventSource(`/api/events?objectiveId=${objective.id}`)
    es.onmessage = (m) => setEvents((prev) => [...prev, JSON.parse(m.data) as VaddEvent])
    es.onerror = () => setError('SSE connection lost — retrying')
    // EventSource reconnects silently, so without this the "connection lost"
    // banner stayed up forever after a blip that had already healed.
    es.onopen = () => setError((e) => (e?.startsWith('SSE connection lost') ? null : e))
    return () => es.close()
  }, [objective])

  // One action at a time. Two clicks on Send used to issue two concurrent
  // prompts; the registry now serialises agent startup, but firing duplicate
  // requests at all is not something to rely on the server to absorb.
  const [busy, setBusy] = useState(false)
  const run = (fn: () => Promise<unknown>) => () => {
    if (busy) return
    setBusy(true)
    setError(null)
    fn()
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 font-sans">
      <h1 className="text-2xl font-semibold">VADD — Debug</h1>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="space-y-2 rounded border p-4">
        <h2 className="font-medium">1 · Register a project</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border px-2 py-1"
            placeholder="/absolute/path/to/repo"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
          />
          <button
            type="button"
            className="rounded bg-black px-3 py-1 text-white disabled:opacity-40"
            disabled={busy}
            onClick={run(async () => {
              await api.registerProject(repoPath)
              setProjects(await api.listProjects())
            })}
          >
            Register
          </button>
        </div>
        <ul className="text-sm text-gray-600">
          {projects.map((p) => (
            <li key={p.id}>
              {p.name} — <code>{p.repoPath}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded border p-4">
        <h2 className="font-medium">2 · Create an objective</h2>
        <input
          className="w-full rounded border px-2 py-1"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full rounded border px-2 py-1"
          placeholder="Goal"
          value={goalText}
          onChange={(e) => setGoalText(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-black px-3 py-1 text-white disabled:opacity-40"
          disabled={busy || projects.length === 0}
          onClick={run(async () => {
            const first = projects[0]
            if (!first) return
            setEvents([])
            setObjective(await api.createObjective(first.id, title, goalText))
          })}
        >
          Create in {projects[0]?.name ?? '—'}
        </button>
        {objective && (
          <p className="text-sm text-gray-600">
            <code>{objective.id}</code> · {objective.status} · branch{' '}
            <code>{objective.branchName}</code>
            <br />
            worktree <code>{objective.worktreePath}</code>
          </p>
        )}
      </section>

      <section className="space-y-2 rounded border p-4">
        <h2 className="font-medium">3 · Send a prompt</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border px-2 py-1"
            placeholder="Ask Claude Code to do something"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            type="button"
            className="rounded bg-black px-3 py-1 text-white disabled:opacity-40"
            disabled={busy || !objective}
            onClick={run(async () => {
              if (objective) await api.sendPrompt(objective.id, { text: prompt })
            })}
          >
            Send
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1 disabled:opacity-40"
            disabled={busy || !objective}
            onClick={run(async () => {
              if (!objective) return
              await api.discard(objective.id)
              setObjective(null)
            })}
          >
            Discard
          </button>
        </div>
        <div className="flex gap-2">
          <select
            className="rounded border px-2 py-1"
            value={phase}
            onChange={(e) => setPhase(e.target.value as (typeof PROMPT_PHASES)[number])}
          >
            {PROMPT_PHASES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded bg-black px-3 py-1 text-white disabled:opacity-40"
            disabled={busy || !objective}
            onClick={run(async () => {
              if (objective) await api.sendPrompt(objective.id, { phase })
            })}
          >
            Send phase
          </button>
        </div>
      </section>

      <section className="space-y-2 rounded border p-4">
        <h2 className="font-medium">4 · Live events ({events.length})</h2>
        <div className="max-h-[28rem] space-y-2 overflow-auto">
          {events.map((e) => (
            <details key={e.id} className="rounded bg-gray-50 p-2 text-xs">
              <summary className="cursor-pointer">
                <span className="font-mono text-gray-500">#{e.id}</span>{' '}
                <span className="font-medium">{e.type}</span>{' '}
                <span className="text-gray-400">{e.createdAt}</span>
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
