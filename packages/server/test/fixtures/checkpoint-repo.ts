import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { planTaskId } from '@vadd/core'
import type { Db } from '../../src/db/client.js'
import { objectives, planTasks, projects } from '../../src/db/schema.js'
import { makeTempRepo } from './temp-repo.js'

/**
 * A repo with four real `vadd-checkpoint:` commits whose shas are recorded in
 * `plan_tasks`, plus the objective and project rows they hang from.
 *
 * Checkpoint repair must be exercised against genuine shas: a fixture with
 * string literals would pass against an implementation that never reads git
 * at all.
 */
export function makeCheckpointRepo(db: Db): {
  repo: string
  objectiveId: string
  shas: string[]
} {
  const repo = makeTempRepo()
  const g = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  const rev = () =>
    execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

  const projectId = 'p1'
  const objectiveId = 'o1'
  db.insert(projects)
    .values({
      id: projectId,
      name: 'p',
      repoPath: repo,
      config: {},
      createdAt: '2026-08-23T10:00:00.000Z',
    })
    .run()
  db.insert(objectives)
    .values({
      id: objectiveId,
      projectId,
      title: 'Fixture objective',
      goalText: 'g',
      status: 'awaitingReview',
      mode: 'standard',
      worktreePath: repo,
      branchName: 'master',
      createdAt: '2026-08-23T10:00:00.000Z',
      updatedAt: '2026-08-23T10:00:00.000Z',
    })
    .run()

  const shas: string[] = []
  for (let ord = 0; ord < 4; ord += 1) {
    writeFileSync(join(repo, `task-${ord}.txt`), `${ord}\n`)
    g('add', '-A')
    g('commit', '-qm', `vadd-checkpoint: task ${ord}`)
    const sha = rev()
    shas.push(sha)
    db.insert(planTasks)
      .values({
        id: planTaskId(objectiveId, ord),
        objectiveId,
        ord,
        title: `Task ${ord}`,
        description: 'd',
        status: 'verified',
        checkpointRef: sha,
      })
      .run()
  }

  return { repo, objectiveId, shas }
}
