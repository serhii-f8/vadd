import { lazy, Suspense, useEffect, useState } from 'react'
import { api, type DiffSummary } from '../api.js'

const DiffViewer = lazy(() => import('./DiffViewer.js'))

/**
 * A collapsed per-file list. Click a path to fetch its unified diff and
 * render it with `react-diff-view` (lazy-loaded — see DiffViewer.tsx).
 */
export function DiffList({ objectiveId }: { objectiveId: string }) {
  const [summary, setSummary] = useState<DiffSummary | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [text, setText] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  // Distinct from `text`: a failed per-file fetch must not be handed to
  // `parseDiff` as if it were diff content. `parseDiff` synthesizes a fake
  // file (with empty hunks) for any string that isn't already a `diff --git`
  // header, so an error message folded into `text` renders as a silent blank
  // panel instead of the error the user needs to see.
  const [loadError, setLoadError] = useState<string | null>(null)

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
    setLoadError(null)
    try {
      setText(await api.getFileDiff(objectiveId, path))
    } catch (e) {
      setLoadError((e as Error).message)
    }
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
              <span className="text-muted-foreground">
                +{f.added} −{f.removed}
                {f.dirty && ' · uncommitted'}
              </span>
            </button>
            {open === f.path && loadError !== null && (
              <p className="mt-1 text-xs text-destructive">Could not load diff: {loadError}</p>
            )}
            {open === f.path && loadError === null && (
              <Suspense
                fallback={<p className="mt-1 text-xs text-muted-foreground">Loading diff…</p>}
              >
                <DiffViewer diffText={text} />
              </Suspense>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
