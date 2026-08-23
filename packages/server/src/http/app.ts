import Fastify, { type FastifyInstance } from 'fastify'
import type { AgentRegistry } from '../agent/registry.js'
import type { Db } from '../db/client.js'
import type { EventBus } from '../events/event-bus.js'
import type { WorkflowRunner } from '../workflow/runner.js'
import { registerEventRoutes } from './routes/events.js'
import { registerEvidenceRoutes } from './routes/evidence.js'
import { registerGitRoutes } from './routes/git.js'
import { registerObjectiveRoutes } from './routes/objectives.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerSettingsRoutes } from './routes/settings.js'

export type AppDeps = {
  db: Db
  bus: EventBus
  /** Populated in Task 11. Optional so Tasks 7–9 can construct an app without it. */
  agents?: AgentRegistry
  /**
   * Optional for the same reason `agents` is: several route tests predate the
   * machine and build an app without one. A machine command that arrives with
   * no runner configured is a 500, not a silent no-op.
   */
  runner?: WorkflowRunner
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  registerProjectRoutes(app, deps)
  registerObjectiveRoutes(app, deps)
  registerEventRoutes(app, deps)
  registerEvidenceRoutes(app, deps)
  registerGitRoutes(app, deps)
  registerSettingsRoutes(app, deps)
  return app
}
