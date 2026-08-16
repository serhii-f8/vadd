import { createReadStream, existsSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { evidenceItems } from '../../db/schema.js'
import { vaddHome } from '../../paths.js'
import type { AppDeps } from '../app.js'

export function registerEvidenceRoutes(app: FastifyInstance, { db }: AppDeps): void {
  // Spec §7: "streams artifact file".
  app.get<{ Params: { id: string } }>('/api/evidence/:id/artifact', async (req, reply) => {
    const row = db.select().from(evidenceItems).where(eq(evidenceItems.id, req.params.id)).get()
    if (!row) return reply.code(404).send({ error: 'Evidence item not found' })
    if (!row.artifactPath) {
      return reply.code(404).send({ error: 'This evidence item has no artifact' })
    }

    // Fail-closed, even though the collector writes this path itself. The
    // check costs one line, and this codebase has twice paid for assuming a
    // path was safe because of where it was supposed to have come from.
    const root = resolve(vaddHome(), 'artifacts')
    const target = resolve(row.artifactPath)
    if (target !== root && !target.startsWith(root + sep)) {
      return reply.code(403).send({ error: 'Artifact path is outside the artifacts directory' })
    }

    // An artifacts directory the user cleaned out is a normal condition, not a
    // 500.
    if (!existsSync(target) || !statSync(target).isFile()) {
      return reply.code(404).send({ error: 'Artifact file is no longer on disk' })
    }

    return reply.type('text/plain; charset=utf-8').send(createReadStream(target))
  })
}
