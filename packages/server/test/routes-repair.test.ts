import { afterEach, expect, test } from 'vitest'
import { buildTestApp, type TestApp } from './fixtures/temp-repo.js'

let harness: TestApp | undefined
afterEach(async () => {
  await harness?.cleanup()
  harness = undefined
})

const executeTask = (objectiveId: string) => ({
  method: 'POST' as const,
  url: `/api/objectives/${objectiveId}/events`,
  payload: {
    type: 'prompt',
    phase: 'execute-task',
    vars: { taskTitle: 'T', taskDescription: 'D' },
  },
})

test('a turn owing an event gets exactly one repair, inside the same turn', async () => {
  harness = await buildTestApp({ fakeAcpMode: 'repair-succeeds' })
  const { app, objectiveId, events, until } = harness

  await app.inject(executeTask(objectiveId))
  await until(() => events().some((e) => e.type === 'prompt_finished'))

  const types = events().map((e) => e.type)
  expect(types.filter((t) => t === 'repair_prompt_sent')).toHaveLength(1)
  // Exactly one turn: a second prompt_sent would shift every later turn and
  // invalidate the eval corpus's 40 turn-indexed labels.
  expect(types.filter((t) => t === 'prompt_sent')).toHaveLength(1)
  expect(types.filter((t) => t === 'prompt_finished')).toHaveLength(1)
  // The repair supplied what the turn owed, so nothing is reported missing.
  expect(
    events().some(
      (e) =>
        e.type === 'contract_violation' &&
        (e.payload as { reason?: string }).reason === 'missing_expected',
    ),
  ).toBe(false)
})

test('a satisfied turn is never repaired', async () => {
  harness = await buildTestApp({ fakeAcpMode: 'satisfied' })
  const { app, objectiveId, events, until } = harness

  await app.inject(executeTask(objectiveId))
  await until(() => events().some((e) => e.type === 'prompt_finished'))

  expect(events().some((e) => e.type === 'repair_prompt_sent')).toBe(false)
})

test('a repair that also fails does not recurse', async () => {
  harness = await buildTestApp({ fakeAcpMode: 'repair-fails' })
  const { app, objectiveId, events, until } = harness

  await app.inject(executeTask(objectiveId))
  await until(() => events().some((e) => e.type === 'prompt_finished'))

  const types = events().map((e) => e.type)
  expect(types.filter((t) => t === 'repair_prompt_sent')).toHaveLength(1)
  // The turn still reports what it owed.
  expect(
    events().some(
      (e) =>
        e.type === 'contract_violation' &&
        (e.payload as { reason?: string }).reason === 'missing_expected',
    ),
  ).toBe(true)
})
