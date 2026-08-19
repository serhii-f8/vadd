import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Project, type TodaySummary } from '../api.js'

export function Today() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [summary, setSummary] = useState<TodaySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const selected = searchParams.get('project')

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    const projectId = selected ?? projects?.[0]?.id
    if (!projectId) return
    setError(null)
    setSummary(null)
    api
      .getToday(projectId)
      .then(setSummary)
      .catch((e: Error) => setError(e.message))
  }, [selected, projects])

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Today</h1>
        <Link className="text-sm underline" to="/">
          Objectives
        </Link>
      </header>

      {error !== null && (
        <p role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm">
          {error}
        </p>
      )}

      {projects !== null && projects.length > 1 && (
        <>
          {/* htmlFor/id, mirroring DecisionCard.tsx's and PlanApproval.tsx's pattern
            for labeling a custom control: an associated <label> gives the select a
            real label→control relationship (click-to-focus, and the label's
            accessible role), not just an implicit one. */}
          <label className="mb-1 block text-xs text-gray-600" htmlFor="today-project">
            Project
          </label>
          <select
            id="today-project"
            className="mb-4 rounded border px-2 py-1 text-sm"
            value={selected ?? projects[0]?.id ?? ''}
            onChange={(e) => setSearchParams({ project: e.target.value })}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </>
      )}

      {summary !== null && (
        <ul className="space-y-2 text-sm">
          <li>
            {summary.verifiedTasks} task{summary.verifiedTasks === 1 ? '' : 's'} verified
          </li>
          <li>
            {summary.decisionsMade} decision{summary.decisionsMade === 1 ? '' : 's'} made
          </li>
          <li>
            {summary.checksPassed} check{summary.checksPassed === 1 ? '' : 's'} passed
          </li>
        </ul>
      )}
    </main>
  )
}
