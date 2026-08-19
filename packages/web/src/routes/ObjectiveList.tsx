import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type ObjectiveListRow, type Project } from '../api.js'
import type { ViewStateName } from '../focus/primary.js'
import { stateColor } from './stateColor.js'

export function ObjectiveList() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [objectives, setObjectives] = useState<ObjectiveListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedProject = searchParams.get('project')

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    api
      .listObjectives(selectedProject ?? undefined)
      .then(setObjectives)
      .catch((e: Error) => setError(e.message))
  }, [selectedProject])

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Objectives</h1>
        <div className="flex gap-3">
          <Link className="text-sm underline" to="/today">
            Today
          </Link>
          <Link className="text-sm underline" to="/debug">
            Debug
          </Link>
        </div>
      </header>

      {projects !== null && projects.length > 1 && (
        <select
          className="mb-4 rounded border px-2 py-1 text-sm"
          value={selectedProject ?? ''}
          onChange={(e) =>
            e.target.value ? setSearchParams({ project: e.target.value }) : setSearchParams({})
          }
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {error !== null && (
        <p role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm">
          {error}
        </p>
      )}

      {objectives !== null && objectives.length === 0 && (
        <p className="text-sm text-gray-600">No objectives yet.</p>
      )}

      <ul className="divide-y">
        {(objectives ?? []).map((o) => (
          <li key={o.id} className="py-3">
            <Link to={`/o/${o.id}`} className="flex items-center gap-3">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${stateColor(o.status as ViewStateName)}`}
              />
              <span className="flex-1 font-medium">{o.title}</span>
              <span className="text-sm text-gray-600">
                {o.status}
                {/* A8: a done objective whose work was thrown away must not
                    look like one whose work was committed. */}
                {o.integrateAction !== null && ` · ${o.integrateAction}`}
              </span>
              <span className="text-sm text-gray-600">
                {o.verifiedCount}/{o.totalCount}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
