import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

/**
 * jsdom has no `EventSource`, and the Focus View opens one on mount. A real
 * polyfill would need a real server; a fake whose instances the test can push
 * into is also the lever the mirroring rule needs — push an event, assert
 * exactly one refetch (design §3).
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  /** Push a server event into this stream, as the real EventSource would. */
  push(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  close(): void {
    this.closed = true
  }
}

export type Route = { status?: number; body: unknown; contentType?: string }

/**
 * Installs a `fetch` that answers from a route table keyed by
 * `"<METHOD> <pathname>"`, and records every call. Anything unrouted rejects
 * loudly rather than resolving empty — a component fetching a URL the test did
 * not anticipate is a bug worth failing on, not a silent undefined.
 *
 * A route may also be keyed on the full `"<METHOD> <url>"` (query string and
 * all) to distinguish requests that share a pathname — e.g.
 * `GET /api/objectives/o1/diff` vs. `GET /api/objectives/o1/diff?file=...`.
 * The full-URL key is tried first, so a query-specific route always wins over
 * a pathname-only one registered alongside it; the common case (no query
 * string distinctions needed) is unaffected — just register the pathname key.
 */
export function mockFetch(routes: Record<string, Route | (() => Route)>): {
  calls: Array<{ method: string; url: string; body: unknown }>
} {
  const calls: Array<{ method: string; url: string; body: unknown }> = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })

    const pathKey = `${method} ${new URL(url, 'http://localhost').pathname}`
    const fullKey = `${method} ${url}`
    const entry = routes[fullKey] ?? routes[pathKey]
    if (!entry) throw new Error(`No mock route for ${pathKey}`)
    const route = typeof entry === 'function' ? entry() : entry
    const contentType = route.contentType ?? 'application/json'
    return new Response(
      contentType === 'application/json' ? JSON.stringify(route.body) : String(route.body),
      { status: route.status ?? 200, headers: { 'Content-Type': contentType } },
    )
  })
  return { calls }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
