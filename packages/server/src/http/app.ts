import Fastify, { type FastifyInstance } from 'fastify'
import type { AgentRegistry } from '../agent/registry.js'
import type { Db } from '../db/client.js'
import type { EventBus } from '../events/event-bus.js'
import { registerEventRoutes } from './routes/events.js'
import { registerObjectiveRoutes } from './routes/objectives.js'
import { registerProjectRoutes } from './routes/projects.js'

export type AppDeps = {
  db: Db
  bus: EventBus
  /** Populated in Task 11. Optional so Tasks 7–9 can construct an app without it. */
  agents?: AgentRegistry
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  registerProjectRoutes(app, deps)
  registerObjectiveRoutes(app, deps)
  registerEventRoutes(app, deps)
  return app
}
