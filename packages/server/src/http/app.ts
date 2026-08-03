import Fastify, { type FastifyInstance } from 'fastify'
import type { AgentRegistry } from '../agent/registry.js'
import type { Db } from '../db/client.js'
import type { EventBus } from '../events/event-bus.js'
import { registerEventRoutes } from './routes/events.js'
import { registerProjectRoutes } from './routes/projects.js'

export type AppDeps = {
  db: Db
  bus: EventBus
  agents?: AgentRegistry
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  registerProjectRoutes(app, deps)
  registerEventRoutes(app, deps)
  return app
}
