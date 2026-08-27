import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute } from 'node:path'
import { type AgentKind, CloneProjectBody, RegisterProjectBody } from '@vadd/core'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { projects } from '../../db/schema.js'
import { validateCloneUrl } from '../../git/clone-url.js'
import { GitError, validateRepo } from '../../git/git-manager.js'
import { declaredStatus } from '../../git/mutate.js'
import { cloneRepo } from '../../git/remote.js'
import type { AppDeps } from '../app.js'
import { errorMessage } from './objectives.js'

async function registerValidatedRepo(
  { db, bus }: AppDeps,
  reply: FastifyReply,
  repoPath: string,
  name: string | undefined,
  agentKind: AgentKind,
) {
  let toplevel: string
  try {
    toplevel = await validateRepo(repoPath)
  } catch (err) {
    const message = err instanceof GitError ? err.message : 'Failed to inspect path'
    bus.emit({
      type: 'project_registration_failed',
      payload: { repoPath, message },
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
      name: name ?? basename(toplevel),
      repoPath: toplevel,
      config: {},
      agentKind,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get()

  bus.emit({ type: 'project_registered', payload: { id: row.id, repoPath: row.repoPath } })
  return reply.code(201).send(row)
}

export function registerProjectRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps
  app.get('/api/projects', async () => db.select().from(projects).all())

  app.post('/api/projects', async (req, reply) => {
    const parsed = RegisterProjectBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }
    return registerValidatedRepo(
      deps,
      reply,
      parsed.data.repoPath,
      parsed.data.name,
      parsed.data.agentKind,
    )
  })

  app.post('/api/projects/clone', async (req, reply) => {
    const parsed = CloneProjectBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }

    const urlCheck = validateCloneUrl(parsed.data.url)
    if (!urlCheck.ok) {
      return reply.code(400).send({ error: `Invalid clone URL: ${urlCheck.reason}` })
    }
    if (!isAbsolute(parsed.data.destPath)) {
      return reply.code(400).send({ error: 'destPath must be absolute' })
    }
    if (existsSync(parsed.data.destPath)) {
      return reply.code(409).send({ error: 'Destination already exists' })
    }

    try {
      await mkdir(dirname(parsed.data.destPath), { recursive: true })
      await cloneRepo(urlCheck.url, parsed.data.destPath)
    } catch (err) {
      return reply.code(declaredStatus(err)).send({ error: errorMessage(err) })
    }

    return registerValidatedRepo(
      deps,
      reply,
      parsed.data.destPath,
      parsed.data.name,
      parsed.data.agentKind,
    )
  })
}
