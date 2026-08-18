import { expect, test } from 'vitest'
import { buildTestApp } from './fixtures/temp-repo.js'

test('a phase prompt sends the rendered template', async () => {
  const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      // Amendment A11: `plan` now needs `{{verifyCommandIds}}` from the
      // caller too, same as `verify` needs `{{verificationChecks}}` below —
      // this raw route never resolves a verification spec on its own.
      payload: { type: 'prompt', phase: 'plan', vars: { verifyCommandIds: '' } },
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

test('refuses to send a prompt that still carries an unsubstituted placeholder', async () => {
  // The route used to pass only { title, goalText }, so `verify.md` reached the
  // agent with its verification placeholder in it as literal text. Task 14
  // records the corpus by driving exactly this phase; the kill-switch number
  // would have been measured against a broken prompt, and the low `evidence`
  // recall would have looked like a genuine failure of the product bet.
  const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      payload: { type: 'prompt', phase: 'verify' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('{{verificationChecks}}')
    // Nothing was sent: a rejected prompt must not appear in a transcript.
    expect(ctx.events().filter((e) => e.type === 'prompt_sent')).toHaveLength(0)
  } finally {
    await ctx.cleanup()
  }
})

test('vars supplied by the caller satisfy the phases the objective row cannot', async () => {
  const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      payload: {
        type: 'prompt',
        phase: 'verify',
        vars: { verificationChecks: 'check-0: Bug reproduced by a failing test' },
      },
    })
    expect(res.statusCode).toBe(202)

    const sent = ctx.events().find((e) => e.type === 'prompt_sent')
    const text = (sent?.payload as { text?: string } | undefined)?.text ?? ''
    expect(text).not.toContain('{{')
    expect(text).toContain('check-0: Bug reproduced by a failing test')
  } finally {
    await ctx.cleanup()
  }
})

test('execute-task needs both of its vars, and says which one is missing', async () => {
  const ctx = await buildTestApp({ fakeAcpMode: 'contract' })
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/objectives/${ctx.objectiveId}/events`,
      payload: { type: 'prompt', phase: 'execute-task', vars: { taskTitle: 'Add a guard' } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('{{taskDescription}}')
    expect(res.json().error).not.toContain('{{taskTitle}}')
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
