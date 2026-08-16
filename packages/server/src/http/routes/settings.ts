import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { SUMMARIZER_KEY_SETTING } from '../../contract/summarizer.js'
import { settings } from '../../db/schema.js'
import type { AppDeps } from '../app.js'

const SettingsBody = z.object({
  /** `null` clears it, which disarms the summarizer on the next agent start. */
  summarizerKey: z.string().min(1).max(200).nullable(),
})

export function registerSettingsRoutes(app: FastifyInstance, { db }: AppDeps): void {
  /**
   * Spec §7's settings surface.
   *
   * The key is never returned. `summarizerFromSettings` reads this row on
   * every agent start, so writing it arms spec §4's optional summarizer and
   * with it the only outbound network call VADD can make — a surface that
   * hands the credential back on request would make that harder to reason
   * about for no benefit. The only question a settings screen asks is whether
   * one is set.
   */
  app.get('/api/settings', async () => {
    const row = db.select().from(settings).where(eq(settings.key, SUMMARIZER_KEY_SETTING)).get()
    const value = typeof row?.value === 'string' ? row.value : ''
    return { summarizerKeyPresent: value.length > 0 }
  })

  app.put('/api/settings', async (req, reply) => {
    const parsed = SettingsBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid settings body', details: parsed.error.issues })
    }

    const { summarizerKey } = parsed.data
    if (summarizerKey === null) {
      db.delete(settings).where(eq(settings.key, SUMMARIZER_KEY_SETTING)).run()
      return { summarizerKeyPresent: false }
    }

    db.insert(settings)
      .values({ key: SUMMARIZER_KEY_SETTING, value: summarizerKey })
      .onConflictDoUpdate({ target: settings.key, set: { value: summarizerKey } })
      .run()
    return { summarizerKeyPresent: true }
  })
}
