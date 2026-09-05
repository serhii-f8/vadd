const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A Level 0 glance at how long ago something happened. Pure and `now`-injected
 * for the same reason `formatElapsed` is.
 *
 * Clock skew between the server's timestamp and the browser can put the
 * moment in the future; "-5 s ago" reads as a bug, so it clamps to "now".
 */
export function relativeTime(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  if (seconds < 2 * 86_400) return 'yesterday'
  const d = new Date(iso)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
