import { useEffect, useState } from 'react'
import { api, type DiffSummary } from '../api.js'

/**
 * A collapsed per-file list. Click a path to fetch its unified diff.
 *
 * No syntax highlighting and no `react-diff-view`: D12 assigns the lazy viewer
 * to M2, and the endpoint plus the list are what M1 design §8.2 asks for.
 */
export function DiffList({ objectiveId }: { objectiveId: string }) {
  const [summary, setSummary] = useState<DiffSummary | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [text, setText] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getDiff(objectiveId)
      .then(setSummary)
      // A committed or discarded objective 409s here. That is expected, not a
      // failure worth an alert — the panel simply has no diff to show.
      .catch((e: Error) => setError(e.message))
  }, [objectiveId])

  if (error !== null || summary === null || summary.files.length === 0) return null

  const show = async (path: string) => {
    if (open === path) {
      setOpen(null)
      return
    }
    setOpen(path)
    setText(
      await api.getFileDiff(objectiveId, path).catch((e: Error) => `Could not load: ${e.message}`),
    )
  }

  return (
    <section aria-label="Changed files" className="mt-4">
      <h3 className="text-sm font-medium">
        {summary.totals.files} file{summary.totals.files === 1 ? '' : 's'} changed (
        {summary.totals.added} added, {summary.totals.removed} removed)
      </h3>
      <ul className="mt-2 divide-y text-sm">
        {summary.files.map((f) => (
          <li key={f.path} className="py-1">
            <button
              type="button"
              className="flex w-full justify-between gap-4 text-left"
              onClick={() => void show(f.path)}
            >
              <span>{f.path}</span>
              <span className="text-gray-600">
                +{f.added} −{f.removed}
                {f.dirty && ' · uncommitted'}
              </span>
            </button>
            {open === f.path && (
              <pre data-testid="file-diff" className="mt-1 overflow-x-auto bg-gray-50 p-2 text-xs">
                {text}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
