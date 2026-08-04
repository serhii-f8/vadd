import { expect, test } from 'vitest'
// Mirror the setup used by packages/server/test/routes-prompt.test.ts: build the
// app with a fake-peer PortFactory, register a project, create an objective.
import { buildTestApp } from './fixtures/temp-repo.js'

test('a fenced block on the wire becomes an agent_event row', async () => {
  const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      payload: { type: 'prompt', text: 'go' },
    })
    expect(res.statusCode).toBe(202)

    await ctx.until(() => ctx.events().some((e) => e.type === 'prompt_finished'))

    const contract = ctx.events().filter((e) => e.type === 'agent_event')
    expect(contract).toHaveLength(1)
    const payload = contract[0]?.payload as {
      event: unknown
      extracted: boolean
      sourceEventIds: number[]
    }
    expect(payload.event).toEqual({
      type: 'status',
      phase: 'executing',
      headline: 'Running the suite',
    })
    expect(payload.extracted).toBe(false)
    // Cites the raw updates it came from, so the Level-3 view can link back.
    expect(payload.sourceEventIds.length).toBeGreaterThan(0)

    // The raw updates are still recorded — the pipeline adds a lane, it does
    // not replace the audit log.
    expect(ctx.events().some((e) => e.type === 'agent_update')).toBe(true)
  } finally {
    await ctx.cleanup()
  }
})
