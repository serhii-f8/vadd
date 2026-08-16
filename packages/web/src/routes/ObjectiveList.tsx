import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Objective } from '../api.js'

export function ObjectiveList() {
  const [objectives, setObjectives] = useState<Objective[] | null>(null)
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
            <Link to={`/o/${o.id}`} className="flex items-baseline justify-between gap-4">
              <span className="font-medium">{o.title}</span>
              <span className="text-sm text-gray-600">
                {o.status}
                {/* A8: a done objective whose work was thrown away must not
                    look like one whose work was committed. */}
                {o.integrateAction !== null && ` · ${o.integrateAction}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
