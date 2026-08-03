import { expect, test } from 'vitest'
import { createDb } from '../src/db/client.js'
import { EventBus } from '../src/events/event-bus.js'
import { buildApp } from '../src/http/app.js'
import { withTempHome } from './fixtures/temp-repo.js'

async function listening() {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const app = buildApp({ db, bus })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  if (typeof addr === 'string' || addr === null) throw new Error('no port')
  return { app, bus, url: `http://127.0.0.1:${addr.port}` }
}

async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition not met within timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** Reads SSE frames until `count` events arrive, then aborts. */
async function readFrames(url: string, headers: Record<string, string>, count: number) {
  const ac = new AbortController()
  const res = await fetch(url, { headers, signal: ac.signal })
  if (!res.body) throw new Error('no response body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const frames: { id: string; data: unknown }[] = []
  let buf = ''
  while (frames.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const id = /^id: (.*)$/m.exec(part)?.[1]
      const data = /^data: (.*)$/m.exec(part)?.[1]
      if (id && data) frames.push({ id, data: JSON.parse(data) })
    }
  }
  ac.abort()
  return frames
}

test('live events stream to a connected client', async () => {
  const { app, bus, url } = await listening()
  const pending = readFrames(`${url}/api/events`, {}, 2)
  await until(() => bus.subscriberCount > 0)
  bus.emit({ type: 'a', payload: { n: 1 } })
  bus.emit({ type: 'b', payload: { n: 2 } })
  const frames = await pending
  expect(frames.map((f) => (f.data as { type: string }).type)).toEqual(['a', 'b'])
  await app.close()
})

test('Last-Event-ID replays missed events with no gap and no duplicate', async () => {
  const { app, bus, url } = await listening()
  const first = bus.emit({ type: 'a', payload: {} })
  const second = bus.emit({ type: 'b', payload: {} })
  const third = bus.emit({ type: 'c', payload: {} })

  const frames = await readFrames(`${url}/api/events`, { 'last-event-id': String(first.id) }, 2)
  expect(frames.map((f) => Number(f.id))).toEqual([second.id, third.id])
  await app.close()
})

test('the lastId query parameter works when the header is absent', async () => {
  const { app, bus, url } = await listening()
  const first = bus.emit({ type: 'a', payload: {} })
  const second = bus.emit({ type: 'b', payload: {} })
  const frames = await readFrames(`${url}/api/events?lastId=${first.id}`, {}, 1)
  expect(Number(frames[0]?.id)).toBe(second.id)
  await app.close()
})

test('objectiveId filters the stream', async () => {
  const { app, bus, url } = await listening()
  const pending = readFrames(`${url}/api/events?objectiveId=o1`, {}, 1)
  await until(() => bus.subscriberCount > 0)
  bus.emit({ objectiveId: 'o2', type: 'ignored', payload: {} })
  bus.emit({ objectiveId: 'o1', type: 'wanted', payload: {} })
  const frames = await pending
  expect((frames[0]?.data as { type: string } | undefined)?.type).toBe('wanted')
  await app.close()
})

test('a disconnected client is unsubscribed', async () => {
  const { app, bus, url } = await listening()
  const ac = new AbortController()
  await fetch(`${url}/api/events`, { signal: ac.signal })
  await until(() => bus.subscriberCount === 1)

  ac.abort()

  // Assert the subscriber is actually gone. `emit()` not throwing proves
  // nothing here — writing to a destroyed socket does not throw synchronously,
  // so that assertion would pass even if unsubscribe were a no-op.
  await until(() => bus.subscriberCount === 0)
  expect(bus.subscriberCount).toBe(0)
  await app.close()
})

test('the stream opens promptly when there is nothing to replay', async () => {
  const { app, url } = await listening()
  const ac = new AbortController()
  // fetch resolves when response headers arrive. If writeHead is left buffered,
  // that does not happen until the 15s keep-alive, so this races a short timer.
  const res = await Promise.race([
    fetch(`${url}/api/events`, { signal: ac.signal }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('headers did not flush within 2s')), 2000),
    ),
  ])
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
  ac.abort()
  await app.close()
})
