import { expect, test } from 'vitest'
import { buildTestApp } from './fixtures/temp-repo.js'

test('a phase prompt sends the rendered template', async () => {
  const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      payload: { type: 'prompt', phase: 'plan' },
    })
    expect(res.statusCode).toBe(202)

    const sent = ctx.events().find((e) => e.type === 'prompt_sent')
    const payload = sent?.payload as { text: string; phase?: string }
    expect(payload.phase).toBe('plan')
    // The goal text was substituted into the template, not left as a placeholder.
    expect(payload.text).not.toContain('{{goalText}}')
    expect(payload.text).toContain(ctx.goalText)
  } finally {
    await ctx.cleanup()
  }
})

test('rejects a body with both text and phase', async () => {
  const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      payload: { type: 'prompt', text: 'hi', phase: 'plan' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/exactly one/i)
  } finally {
    await ctx.cleanup()
  }
})

test('rejects a body with neither text nor phase', async () => {
  const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      payload: { type: 'prompt' },
    })
    expect(res.statusCode).toBe(400)
  } finally {
    await ctx.cleanup()
  }
})

test('rejects an unknown phase with a usable message', async () => {
  const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      payload: { type: 'prompt', phase: 'nope' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/nope/)
  } finally {
    await ctx.cleanup()
  }
})
