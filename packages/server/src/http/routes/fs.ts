import type { Dirent } from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import type { FastifyInstance } from 'fastify'

export function registerFsRoutes(app: FastifyInstance): void {
  app.get('/api/fs/browse', async (req, reply) => {
    const query = req.query as { path?: string }
    const path = query.path ?? homedir()

    if (!isAbsolute(path)) {
      return reply.code(400).send({ error: 'path must be absolute' })
    }

    let dirents: Dirent<string>[]
    try {
      dirents = readdirSync(path, { withFileTypes: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(400).send({ error: message })
    }

    const entries = dirents
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: e.name,
        path: join(path, e.name),
        isGitRepo: existsSync(join(path, e.name, '.git')),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const parent = dirname(path)
    return { path, parent: parent === path ? null : parent, entries }
  })
}
