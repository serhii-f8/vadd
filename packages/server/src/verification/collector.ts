import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { decideCommand, type VerificationSpec } from '@vadd/core'
import type { Db } from '../db/client.js'
import { evidenceItems, type objectives } from '../db/schema.js'
import type { EventBus } from '../events/event-bus.js'
import { artifactsDirFor } from '../paths.js'
import { headlineFor, sawWarnings } from './headline.js'
import { runCommand } from './run-command.js'
import { clip, tailSummary } from './setup.js'

type Deps = { db: Db; bus: EventBus }
type ObjectiveRow = typeof objectives.$inferSelect
type EvidenceRow = typeof evidenceItems.$inferSelect

export type CollectorResult = { runId: string; items: EvidenceRow[] }

/** `evidence_items.kind`, inferred from the command id. Display only. */
function kindFor(commandId: string): 'test' | 'lint' | 'build' | 'artifact' {
  const name = commandId.includes(':') ? (commandId.split(':')[1] ?? commandId) : commandId
  if (name === 'test' || name === 'lint' || name === 'build') return name
  return 'artifact'
}

/**
 * Design §5. Runs `verify.commands` in the objective's worktree and writes one
 * `evidence_items` row per command — the only rows in the system carrying a
 * non-null `commandId` for a *command*, and therefore the only thing that can
 * satisfy `evidenceComplete`'s required items (amendment A5).
 *
 * Status comes from the process alone (§5.2): exit 0 is `pass`, non-zero is
 * `fail`, and `warn` is exit 0 with warnings in the output. `allowWarn` is never
 * read here — whether a `warn` is good enough is the guard's decision, and it
 * already implements exactly that.
 */
export async function collectEvidence(
  deps: Deps,
  objective: ObjectiveRow,
  spec: VerificationSpec,
  opts: { taskId: string | null; signal?: AbortSignal },
): Promise<CollectorResult> {
  const worktree = objective.worktreePath
  if (!worktree) throw new Error(`Objective ${objective.id} has no worktree path`)

  const runId = randomUUID()
  const dir = artifactsDirFor(objective.id, runId)
  await mkdir(dir, { recursive: true })

  const items: EvidenceRow[] = []

  for (const command of spec.verify.commands) {
    // A `PAUSE` mid-suite stops here rather than working through the rest.
    if (opts.signal?.aborted) break

    const logPath = join(dir, `${command.id.replaceAll(':', '-')}.log`)
    const decision = decideCommand(command.run, worktree)

    let status: 'pass' | 'fail' | 'warn'
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
          opts.signal,
        )
        // A command killed by the abort produced no verdict, only a corpse.
        // Record nothing for it: `PAUSE` must not leave a `fail` row that
        // reads like the suite genuinely went red.
        if (result.aborted) break
        output = result.output
        status = result.exitCode === 0 ? (sawWarnings(output) ? 'warn' : 'pass') : 'fail'
        headline = result.timedOut
          ? clip(`${command.id} timed out after ${spec.verify.timeoutSec}s`, 120)
          : headlineFor(command.id, result.exitCode, output)
      } catch (err) {
        // A `cwd` that does not exist, a spawn failure: an outcome with a log,
        // never an exception that leaves `verifying` with no evidence at all.
        status = 'fail'
        output = err instanceof Error ? err.message : String(err)
        headline = clip(`${command.id} could not run`, 120)
      }
    }

    await writeFile(logPath, output, 'utf8')

    const row = deps.db
      .insert(evidenceItems)
      .values({
        id: randomUUID(),
        objectiveId: objective.id,
        taskId: opts.taskId,
        // The whole point of the phase: a real command run, linked back to the
        // `verify.commands[].id` the guard joins on (amendment A5).
        commandId: command.id,
        kind: kindFor(command.id),
        status,
        headline,
        summary: tailSummary(output),
        artifactPath: logPath,
        decidedBy: null,
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get()

    items.push(row)
    deps.bus.emit({
      objectiveId: objective.id,
      type: 'evidence_collected',
      payload: { commandId: command.id, status, headline },
    })
  }

  return { runId, items }
}
