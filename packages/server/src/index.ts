import { resolveAdapterBin } from './agent/acp-agent-port.js'
import { claudeCodeConfig } from './agent/kinds/claude-code.js'
import { AgentRegistry } from './agent/registry.js'
import { openBrowser } from './boot/open-browser.js'
import { reconcileOnBoot } from './boot/reconcile.js'
import { rehydrateOnBoot } from './boot/rehydrate.js'
import { createDb } from './db/client.js'
import { EventBus } from './events/event-bus.js'
import { buildApp } from './http/app.js'
import { registerStaticWeb } from './http/static.js'
import { dbPath } from './paths.js'
import { WorkflowRunner } from './workflow/runner.js'

const PORT = Number(process.env.VADD_PORT ?? 4319)

// Design §5: probe for the adapter at startup and fail with a one-line install
// instruction, rather than letting the first prompt of the session die on a
// spawn ENOENT. Resolution is pure path lookup — no process is spawned here.
// The install instruction comes from the config, not from resolveAdapterBin's
// own thrown message: that function is now adapter-agnostic (M3) and no
// longer knows the exact pinned version, only the package name. Reading it
// from claudeCodeConfig().missingAdapterMessage keeps this probe carrying the
// same `@0.16.2` pin AcpAgentPort's own error path already reads from the
// injected config, rather than a generic message with no version in it.
try {
  resolveAdapterBin(claudeCodeConfig().packageName)
} catch {
  console.error(claudeCodeConfig().missingAdapterMessage)
  process.exit(1)
}

const db = createDb(dbPath())
const bus = new EventBus(db)

// Late binding, deliberately: the registry's `onContractEmission` hook needs
// the runner, and the runner's constructor needs the registry. The hook cannot
// fire before the assignment below — it runs only from a pipeline a live agent
// session feeds, and no session exists until the first turn.
let runner: WorkflowRunner
const agents = new AgentRegistry(db, bus, undefined, (objectiveId, emission) => {
  runner.ingest(objectiveId, emission)
})
runner = new WorkflowRunner({ db, bus, agents })

// Order matters: reconciliation deletes the `creating` remnants and orphans the
// previous process's agent sessions, so rehydration only ever sees rows that
// are genuinely resumable.
await reconcileOnBoot(db, bus)
await rehydrateOnBoot({ db, bus, runner })

const app = buildApp({ db, bus, agents, runner })

// Packaged-install mode only: `pnpm dev` never sets this, so this branch is
// dead code in every dev/test run and changes nothing about that path.
if (process.env.VADD_WEB_DIST) {
  await registerStaticWeb(app, process.env.VADD_WEB_DIST)
}

// Localhost only (spec §7). Never bind 0.0.0.0.
await app.listen({ port: PORT, host: '127.0.0.1' })
console.log(`VADD server listening on http://127.0.0.1:${PORT}`)

if (process.env.VADD_WEB_DIST) {
  openBrowser(`http://127.0.0.1:${PORT}/`)
}

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\nReceived ${signal}, shutting down…`)
  // Each step is isolated: a throw in stopAll() must not skip app.close(), and
  // neither may skip the exit. Previously this was fire-and-forget, so one
  // rejection aborted the process before it stopped anything — the opposite of
  // what a shutdown handler exists to do, and it would strand adapters.
  // Actors first: a running actor can still start a turn, and stopping the
  // agents underneath one would strand it mid-prompt.
  try {
    runner.stopAll()
  } catch (err) {
    console.error('Failed to stop workflow actors cleanly:', err)
  }
  try {
    await agents.stopAll()
  } catch (err) {
    console.error('Failed to stop agents cleanly:', err)
  }
  try {
    await app.close()
  } catch (err) {
    console.error('Failed to close the server cleanly:', err)
  }
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
