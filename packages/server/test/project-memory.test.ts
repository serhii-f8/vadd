import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createDb, type Db } from '../src/db/client.js'
import { projectMemory, projects } from '../src/db/schema.js'
import { buildProjectMemoryPromptBlock } from '../src/workflow/project-memory.js'
import { withTempHome } from './fixtures/temp-repo.js'

function setup(): { db: Db; projectId: string } {
  withTempHome()
  const db = createDb(`${process.env.VADD_HOME}/vadd.db`)
  const projectId = randomUUID()
  db.insert(projects)
    .values({
      id: projectId,
      name: 'p',
      repoPath: '/tmp/x',
      config: {},
      createdAt: new Date().toISOString(),
    })
    .run()
  return { db, projectId }
}

function addNote(
  db: Db,
  projectId: string,
  kind: 'architecture' | 'known_issue',
  headline: string,
  at: string,
): void {
  db.insert(projectMemory)
    .values({ id: randomUUID(), projectId, kind, headline, content: headline, createdAt: at })
    .run()
}

describe('buildProjectMemoryPromptBlock', () => {
  it('says plainly when there is no memory yet', () => {
    const { db, projectId } = setup()
    const block = buildProjectMemoryPromptBlock(db, projectId)
    expect(block).toContain('No project memory recorded yet')
  })

  it('includes recorded notes under labeled sections', () => {
    const { db, projectId } = setup()
    addNote(db, projectId, 'architecture', 'Auth lives in src/auth/', '2026-08-27T00:00:00.000Z')
    addNote(
      db,
      projectId,
      'known_issue',
      'CI is flaky on parallel runs',
      '2026-08-27T00:00:01.000Z',
    )
    const block = buildProjectMemoryPromptBlock(db, projectId)
    expect(block).toContain('Auth lives in src/auth/')
    expect(block).toContain('CI is flaky on parallel runs')
  })

  it('caps at the 5 most recent notes per kind', () => {
    const { db, projectId } = setup()
    for (let i = 0; i < 8; i++) {
      addNote(
        db,
        projectId,
        'known_issue',
        `issue-${i}`,
        `2026-08-27T00:00:${String(i).padStart(2, '0')}.000Z`,
      )
    }
    const block = buildProjectMemoryPromptBlock(db, projectId)
    // The 3 oldest (issue-0, issue-1, issue-2) must be dropped; the 5 newest
    // (issue-3..issue-7) must all be present.
    expect(block).not.toContain('issue-0')
    expect(block).not.toContain('issue-1')
    expect(block).not.toContain('issue-2')
    expect(block).toContain('issue-7')
  })

  it("only pulls notes for the given project, not another project's", () => {
    const { db, projectId } = setup()
    const otherProjectId = randomUUID()
    db.insert(projects)
      .values({
        id: otherProjectId,
        name: 'other',
        repoPath: '/tmp/y',
        config: {},
        createdAt: new Date().toISOString(),
      })
      .run()
    addNote(db, otherProjectId, 'architecture', 'other project secret', '2026-08-27T00:00:00.000Z')
    const block = buildProjectMemoryPromptBlock(db, projectId)
    expect(block).not.toContain('other project secret')
  })
})
