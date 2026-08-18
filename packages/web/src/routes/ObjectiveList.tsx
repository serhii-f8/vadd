import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ObjectiveListRow } from '../api.js'
import type { ViewStateName } from '../focus/primary.js'
import { stateColor } from './stateColor.js'

export function ObjectiveList() {
  const [objectives, setObjectives] = useState<ObjectiveListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listObjectives()
      .then(setObjectives)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Objectives</h1>
        <Link className="text-sm underline" to="/debug">
          Debug
        </Link>
      </header>

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
