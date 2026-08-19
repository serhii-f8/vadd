import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/**
 * Serves the packaged web build as static files, with an SPA fallback: any GET
 * that isn't a real file and isn't under `/api` gets `index.html`, so React
 * Router's client-side routes (`/o/:id`, `/today`, `/debug`) work on a full
 * page load, not just client-side navigation. `/api/*` 404s stay real 404s —
 * the fallback must never mask a missing API route as a served page.
 */
export async function registerStaticWeb(app: FastifyInstance, webDist: string): Promise<void> {
  await app.register(fastifyStatic, { root: webDist })
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api')) {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send({ error: 'Not found' })
  })
}
