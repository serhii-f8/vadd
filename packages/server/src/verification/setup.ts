import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { decideCommand, type VerificationSpec } from '@vadd/core'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { evidenceItems, objectives } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { artifactsDirFor } from '../paths.js'
import { runCommand } from './run-command.js'

type Deps = { db: Db; bus: EventBus }
type ObjectiveRow = typeof objectives.$inferSelect

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Last non-empty lines, shaped to the contract's ≤6 × ≤100 caps. */
export function tailSummary(output: string): string[] {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-6)
    .map((l) => clip(l, 100))
}

/**
 * Amendment A1's `setup`, run once per worktree. Design §4.1 moves it from
 * "before the first verification" to **worktree creation, before the first
 * agent turn**: a fresh worktree has no `vendor/` and no `node_modules/`, so an
 * agent asked to work test-first cannot run its own tests. CLAUDE.md's Task 14
 * traps record exactly that pain and name `setup` as the real fix.
 *
 * Returns true when every command succeeded. On failure the objective lands in
 * `setup_failed` (design §4.3) with the log attached and `setupAt` unstamped.
 */
export async function runSetup(
  deps: Deps,
  objective: ObjectiveRow,
  spec: VerificationSpec,
): Promise<boolean> {
  const worktree = objective.worktreePath
  if (!worktree) throw new Error(`Objective ${objective.id} has no worktree path`)

  const runId = randomUUID()
  const dir = artifactsDirFor(objective.id, runId)
  await mkdir(dir, { recursive: true })

  for (const command of spec.verify.setup) {
    const logPath = join(dir, `setup-${command.id.replaceAll(':', '-')}.log`)
    const decision = decideCommand(command.run, worktree)

    let status: 'pass' | 'fail' = 'pass'
    let headline: string
    let output: string

    if (!decision.allowed) {
      status = 'fail'
      headline = clip(`${command.id} refused — ${decision.reason}`, 120)
      output = `Refused by the command policy: ${decision.reason}\n`
    } else {
      try {
        const result = await runCommand(
          command.run,
          resolve(worktree, command.cwd),
          spec.verify.timeoutSec * 1000,
        )
        output = result.output
        status = result.exitCode === 0 ? 'pass' : 'fail'
        headline = result.timedOut
          ? clip(`${command.id} timed out after ${spec.verify.timeoutSec}s`, 120)
          : status === 'pass'
            ? clip(`${command.id} ok`, 120)
            : clip(`${command.id} failed — exit ${result.exitCode}`, 120)
      } catch (err) {
        // A `cwd` that does not exist, a spawn failure: still an outcome with a
        // log, never an exception that leaves the objective in `creating` with
        // nothing to read.
        status = 'fail'
        output = err instanceof Error ? err.message : String(err)
        headline = clip(`${command.id} could not run`, 120)
      }
    }

    await writeFile(logPath, output, 'utf8')
    deps.db
      .insert(evidenceItems)
      .values({
        id: randomUUID(),
        objectiveId: objective.id,
        taskId: null,
        // Setup is not a verification item. A null commandId keeps it out of
        // `evidenceComplete` entirely — it is diagnostic, never proof.
        commandId: null,
        kind: 'artifact',
        status,
        headline,
        summary: tailSummary(output),
        artifactPath: logPath,
        decidedBy: null,
        createdAt: new Date().toISOString(),
      })
      .run()

    if (status === 'fail') {
      deps.db
        .update(objectives)
        .set({ status: 'setup_failed', updatedAt: new Date().toISOString() })
        .where(eq(objectives.id, objective.id))
        .run()
      deps.bus.emit({
        objectiveId: objective.id,
        type: 'setup_failed',
        payload: { commandId: command.id, headline },
      })
      return false
    }
  }

  deps.db
    .update(objectives)
    .set({ setupAt: new Date().toISOString(), status: 'idle', updatedAt: new Date().toISOString() })
    .where(eq(objectives.id, objective.id))
    .run()
  deps.bus.emit({ objectiveId: objective.id, type: 'setup_finished', payload: { runId } })
  return true
}
