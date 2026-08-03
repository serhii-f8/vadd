import { AgentRegistry } from './agent/registry.js'
import { reconcileOnBoot } from './boot/reconcile.js'
import { createDb } from './db/client.js'
import { EventBus } from './events/event-bus.js'
import { buildApp } from './http/app.js'
import { dbPath } from './paths.js'

const PORT = Number(process.env.VADD_PORT ?? 4319)

const db = createDb(dbPath())
const bus = new EventBus(db)
const agents = new AgentRegistry(db, bus)

await reconcileOnBoot(db, bus)

const app = buildApp({ db, bus, agents })

// Localhost only (spec §7). Never bind 0.0.0.0.
await app.listen({ port: PORT, host: '127.0.0.1' })
console.log(`VADD server listening on http://127.0.0.1:${PORT}`)

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\nReceived ${signal}, shutting down…`)
  await agents.stopAll()
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
