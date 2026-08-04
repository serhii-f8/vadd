/**
 * Waits for a real condition instead of sleeping a guessed interval.
 *
 * Fixed sleeps make a suite both slow and flaky: too short and it fails on a
 * loaded machine, too long and every run pays for the worst case. Polling the
 * signal itself is neither.
 */
export async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition not met within timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}
