import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { RegisterProjectBody } from '@vadd/core'
import type { FastifyInstance } from 'fastify'
import { projects } from '../../db/schema.js'
import { GitError, validateRepo } from '../../git/git-manager.js'
import type { AppDeps } from '../app.js'

export function registerProjectRoutes(app: FastifyInstance, { db, bus }: AppDeps): void {
  app.get('/api/projects', async () => db.select().from(projects).all())

  app.post('/api/projects', async (req, reply) => {
    const parsed = RegisterProjectBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }

    let toplevel: string
    try {
      toplevel = await validateRepo(parsed.data.repoPath)
    } catch (err) {
      const message = err instanceof GitError ? err.message : 'Failed to inspect path'
      bus.emit({
        type: 'project_registration_failed',
        payload: { repoPath: parsed.data.repoPath, message },
      })
      return reply.code(400).send({ error: message })
    }

    const existing = db
      .select()
      .from(projects)
      .all()
      .find((p) => p.repoPath === toplevel)
    if (existing) {
      return reply.code(409).send({ error: 'Repository is already registered', id: existing.id })
    }

    const row = db
      .insert(projects)
      .values({
        id: randomUUID(),
        name: parsed.data.name ?? basename(toplevel),
        repoPath: toplevel,
        config: {},
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get()

    bus.emit({ type: 'project_registered', payload: { id: row.id, repoPath: row.repoPath } })
    return reply.code(201).send(row)
  })
}
