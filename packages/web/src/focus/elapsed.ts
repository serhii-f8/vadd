/**
 * How long the running task has been running, as a Level 0 glance.
 *
 * Pure and `now`-injected so it is testable without faking timers, and so the
 * component's once-a-second tick stays a display concern rather than something
 * the formatting depends on.
 */
export function formatElapsed(startedAt: string, now: number): string {
  // A clock skew between the server's `startedAt` and the browser's `now` can
  // put the start in the future. "-3s elapsed" reads as a bug in the app
  // rather than as the rounding artefact it is.
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  }
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`
}
