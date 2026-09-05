import { ChevronRight } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { api, type DiffSummary } from '../api.js'
import { ChangeBar } from './ChangeBar.js'

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
    <section
      aria-label="Changed files"
      className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Changed files</h3>
        <span className="flex gap-2 font-mono text-xs tabular-nums">
          <span>
            {summary.totals.files} file{summary.totals.files === 1 ? '' : 's'} changed
          </span>
          <span className="text-status-done">+{summary.totals.added}</span>
          <span className="text-status-failed">−{summary.totals.removed}</span>
        </span>
      </div>
      <ul className="divide-y divide-border text-sm">
        {summary.files.map((f) => (
          <li key={f.path} className="py-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-3 text-left"
              aria-expanded={open === f.path}
              onClick={() => void show(f.path)}
            >
              <ChevronRight
                className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                  open === f.path ? 'rotate-90' : ''
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{f.path}</span>
              {f.dirty && (
                <span className="shrink-0 text-xs text-muted-foreground">uncommitted</span>
              )}
              <ChangeBar added={f.added} removed={f.removed} />
              <span className="w-10 shrink-0 text-right font-mono text-xs text-status-done">
                +{f.added}
              </span>
              <span className="w-8 shrink-0 text-right font-mono text-xs text-status-failed">
                −{f.removed}
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
