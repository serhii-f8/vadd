import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ObjectiveListRow } from '../api.js'

/** How long to wait for a burst of events to settle before one refetch. */
export const REFETCH_DEBOUNCE_MS = 300

/**
 * A project's objectives, kept current.
 *
 * One fetch of the list, refetched when the unscoped event stream says
 * anything changed and when the window regains focus. Spec §7: the stream is
 * a *change signal* — a message means "refetch", and its payload is never
 * read into state, because folding it in would be a client-side transition
 * wearing a different hat. A burst of events (an agent turn emits several)
 * is debounced into one refetch.
 *
 * Used by the shell (the needs-you count and the Working now section) and by
 * the Objective Board, which until this existed only updated on reload.
 */
export function useLiveObjectives(projectId: string | null): {
  objectives: ObjectiveListRow[] | null
  error: string | null
  /** True once the stream has delivered or opened; false after an error until it recovers. */
  connected: boolean
  refetch: () => void
} {
  const [objectives, setObjectives] = useState<ObjectiveListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refetch = useCallback(() => {
    if (projectId === null) return
    api
      .listObjectives(projectId)
      .then((rows) => {
        setObjectives(rows)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [projectId])

  useEffect(() => {
    // Cleared before the fetch: a failure must not leave the previous
    // project's rows on screen under the new project's name.
    setObjectives(null)
    setError(null)
    refetch()
  }, [refetch])

  useEffect(() => {
    if (projectId === null) return
    const es = new EventSource('/api/events')
    es.onopen = () => setConnected(true)
    es.onmessage = () => {
      // An event arriving *is* the connection working; `EventSource`
      // reconnects on its own, so an error flag left up after that is a lie.
      setConnected(true)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        refetch()
      }, REFETCH_DEBOUNCE_MS)
    }
    es.onerror = () => setConnected(false)
    // Alt-tab back is a real signal too: the stream only carries what VADD
    // itself did, and a reload is cheap.
    const onFocus = () => refetch()
    window.addEventListener('focus', onFocus)
    return () => {
      es.close()
      window.removeEventListener('focus', onFocus)
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [projectId, refetch])

  return { objectives, error, connected, refetch }
}
