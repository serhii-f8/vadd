import { spawn } from 'node:child_process'

/**
 * Best-effort only: a packaged install with no display, or an unusual platform
 * opener, must not stop the server from starting. The URL is always also
 * printed to the console by the caller, which stays the source of truth.
 */
export function openBrowser(url: string): void {
  try {
    const isWin32 = process.platform === 'win32'
    const command = isWin32 ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = isWin32 ? ['/c', 'start', '', url] : [url]
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      ...(isWin32 ? { windowsHide: true } : {}),
    })
    child.on('error', () => {
      // Best-effort — see the note above. spawn does not throw synchronously
      // on ENOENT; it emits this asynchronously instead, and an unhandled
      // 'error' event would otherwise crash the process.
    })
    child.unref()
  } catch {
    // Best-effort — see the note above.
  }
}
