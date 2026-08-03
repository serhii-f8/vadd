import type { FastifyInstance } from 'fastify'
import type { VaddEvent } from '../../events/event-bus.js'
import type { AppDeps } from '../app.js'

type Query = { objectiveId?: string; lastId?: string }

export function registerEventRoutes(app: FastifyInstance, { bus }: AppDeps): void {
  app.get<{ Querystring: Query }>('/api/events', (req, reply) => {
    const objectiveId = req.query.objectiveId ?? null

    // The header wins: browsers set it automatically on reconnect, so it is
    // always at least as current as a query parameter baked into the URL.
    const header = req.headers['last-event-id']
    const raw = (Array.isArray(header) ? header[0] : header) ?? req.query.lastId ?? '0'
    const parsed = Number.parseInt(raw, 10)
    const lastId = Number.isFinite(parsed) && parsed > 0 ? parsed : 0

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const write = (e: VaddEvent) => {
      reply.raw.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`)
    }

    // Replay first, then attach. Any event emitted during replay has an id
    // greater than everything replayed, so it arrives via the subscriber.
    for (const e of bus.since(objectiveId, lastId)) write(e)

    const unsubscribe = bus.subscribe(objectiveId, write)
    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000)

    req.raw.on('close', () => {
      clearInterval(keepAlive)
      unsubscribe()
    })

    return reply
  })
}
