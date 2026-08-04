import type { FastifyInstance } from 'fastify'
import type { VaddEvent } from '../../events/event-bus.js'
import type { AppDeps } from '../app.js'

type Query = { objectiveId?: string; lastId?: string }

/** Most events replayed into one connection before the stream announces a cut. */
const REPLAY_LIMIT = 5000

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

    // writeHead() only buffers — Node sends headers with the first body chunk.
    // Without this, a client with no backlog to replay receives zero bytes until
    // the keep-alive fires, leaving EventSource unopened for 15 seconds.
    reply.raw.flushHeaders()

    const write = (e: VaddEvent) => {
      reply.raw.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`)
    }

    // Replay first, then attach. Any event emitted during replay has an id
    // greater than everything replayed, so it arrives via the subscriber.
    //
    // Bounded: `GET /api/events` with neither objectiveId nor Last-Event-ID
    // replays the entire table synchronously into the socket, which grows
    // without limit as transcripts accumulate. The debug page always sends an
    // objectiveId, so this is a guard on the bare route rather than a hot path.
    const backlog = bus.since(objectiveId, lastId)
    if (backlog.length > REPLAY_LIMIT) {
      // Announce the cut rather than truncating in silence. A client that
      // resumed from Last-Event-ID is owed a contiguous stream; if it cannot
      // have one, it needs to know that instead of quietly missing events.
      const kept = backlog.slice(-REPLAY_LIMIT)
      const skipped = backlog.length - kept.length
      reply.raw.write(
        `event: replay-truncated\ndata: ${JSON.stringify({
          skipped,
          requestedFrom: lastId,
          streamingFrom: kept[0]?.id ?? null,
        })}\n\n`,
      )
      for (const e of kept) write(e)
    } else {
      for (const e of backlog) write(e)
    }

    const unsubscribe = bus.subscribe(objectiveId, write)
    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000)

    const teardown = () => {
      clearInterval(keepAlive)
      unsubscribe()
    }
    req.raw.on('close', teardown)
    // An abrupt ECONNRESET in the window before 'close' fires would otherwise
    // surface as an unhandled 'error' on the socket and take the process down.
    reply.raw.on('error', teardown)
    req.raw.on('error', teardown)

    return reply
  })
}
