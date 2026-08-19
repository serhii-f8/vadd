import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { AgentRegistry, type PortFactory } from '../src/agent/registry.js'
import { createDb } from '../src/db/client.js'
import { agentSessions, objectives, projects } from '../src/db/schema.js'
import { EventBus } from '../src/events/event-bus.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

type StubPort = {
  id: number
  stopped: boolean
}

/**
 * A port that takes a measurable amount of time to start, so the window
 * between `ensure()`'s check and its `#live.set` is wide enough to interleave.
 * Counting instances is the whole point: a leaked adapter shows up here as a
 * second port nobody ever stops.
 */
function stubFactory(startDelayMs = 25) {
  const ports: StubPort[] = []
  const factory: PortFactory = () => {
    const self: StubPort = { id: ports.length, stopped: false }
    ports.push(self)
    const port = {
      async start() {
        await new Promise((r) => setTimeout(r, startDelayMs))
      },
      async newSession() {
        await new Promise((r) => setTimeout(r, startDelayMs))
        return { sessionId: `session-${self.id}` }
      },
      async prompt() {
        return { stopReason: 'end_turn' }
      },
      async cancel() {},
      async stop() {
        self.stopped = true
      },
      onUpdate: () => () => {},
      onExit: () => () => {},
    }
    return port as unknown as ReturnType<PortFactory>
  }
  return { factory, ports }
}

function setup(startDelayMs?: number) {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)
  const { factory, ports } = stubFactory(startDelayMs)
  const agents = new AgentRegistry(db, bus, factory)

  // agent_sessions.objectiveId is a real foreign key and foreign_keys is ON, so
  // the rows have to exist or every insert fails for a reason unrelated to what
  // these tests are about.
  const now = new Date().toISOString()
  db.insert(projects)
    .values({ id: 'proj-1', name: 'p', repoPath: `${home}/repo`, config: {}, createdAt: now })
    .run()
  db.insert(objectives)
    .values({
      id: 'obj-1',
      projectId: 'proj-1',
      title: 't',
      goalText: 'g',
      worktreePath: `${home}/wt`,
      branchName: 'vadd/obj-1',
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const objective = { id: 'obj-1', worktreePath: `${home}/wt`, projectId: 'proj-1' }
  return { db, bus, agents, objective, ports }
}

test('concurrent ensure() calls share one agent instead of spawning two', async () => {
  // Starting spans two awaits, so a bare check-then-set on #live is not atomic.
  // Two prompts arriving together — a double-click on Send is enough — both
  // missed and both spawned; the second overwrote the first in #live, and the
  // first child became unreachable forever.
  const { agents, ports, objective } = setup()

  const [a, b, c] = await Promise.all([
    agents.ensure(objective),
    agents.ensure(objective),
    agents.ensure(objective),
  ])

  expect(ports).toHaveLength(1)
  expect(a).toBe(b)
  expect(b).toBe(c)
})

test('a concurrent double start leaves no adapter that stopAll() cannot reach', async () => {
  const { agents, ports, objective } = setup()

  await Promise.all([agents.ensure(objective), agents.ensure(objective)])
  await agents.stopAll()

  // The real defect was a live child no reference pointed at. Every port the
  // factory ever produced must have been stopped.
  expect(ports.filter((p) => !p.stopped)).toEqual([])
})

test('only one agent_sessions row is written for a concurrent double start', async () => {
  const { db, agents, objective } = setup()

  await Promise.all([agents.ensure(objective), agents.ensure(objective)])

  expect(db.select().from(agentSessions).all()).toHaveLength(1)
})

test('discarding while the agent is still starting still stops it', async () => {
  // stop() used to read #live, find nothing because the handshake had not
  // finished, and return having done nothing — the child that finished
  // starting a moment later was an orphan.
  const { agents, ports, objective } = setup(40)

  const starting = agents.ensure(objective)
  await agents.stop('obj-1')
  await starting

  expect(ports).toHaveLength(1)
  expect(ports[0]?.stopped).toBe(true)
  expect(agents.get('obj-1')).toBeUndefined()
})

test("the registry picks the factory agentKind matching the objective's project", async () => {
  const home = withTempHome()
  const db = createDb(`${home}/vadd.db`)
  const bus = new EventBus(db)

  const projectId = randomUUID()
  db.insert(projects)
    .values({
      id: projectId,
      name: 'p',
      repoPath: makeTempRepo(),
      config: {},
      agentKind: 'codex',
      createdAt: new Date().toISOString(),
    })
    .run()
  const objectiveId = randomUUID()
  const worktreePath = makeTempRepo()
  const now = new Date().toISOString()
  db.insert(objectives)
    .values({
      id: objectiveId,
      projectId,
      title: 't',
      goalText: 'g',
      worktreePath,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const seenAgentKinds: string[] = []
  const registry = new AgentRegistry(db, bus, ({ agentKind }) => {
    seenAgentKinds.push(agentKind)
    return {
      start: async () => {},
      newSession: async () => ({ sessionId: 's1' }),
      prompt: async () => ({ stopReason: 'end_turn' }),
      cancel: async () => {},
      stop: async () => {},
      onUpdate: () => () => {},
      pid: undefined,
    } as never
  })

  await registry.ensure({ id: objectiveId, worktreePath, projectId })
  expect(seenAgentKinds).toEqual(['codex'])
})
