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

test('a dangling evidenceRef gets exactly one repair, inside the same turn', async () => {
  harness = await buildTestApp({ fakeAcpMode: 'dangling-ref-repaired' })
  const { app, objectiveId, events, until } = harness

  await app.inject(executeTask(objectiveId))
  await until(() => events().some((e) => e.type === 'prompt_finished'))

  const types = events().map((e) => e.type)
  expect(types.filter((t) => t === 'repair_prompt_sent')).toHaveLength(1)
  expect(types.filter((t) => t === 'prompt_sent')).toHaveLength(1)
  expect(
    events().some(
      (e) =>
        e.type === 'contract_violation' &&
        (e.payload as { reason?: string }).reason === 'dangling_evidence_ref',
    ),
  ).toBe(false)
})

test('a dangling evidenceRef that is not repaired still reports the violation', async () => {
  harness = await buildTestApp({ fakeAcpMode: 'dangling-ref' })
  const { app, objectiveId, events, until } = harness

  await app.inject(executeTask(objectiveId))
  await until(() => events().some((e) => e.type === 'prompt_finished'))

  const types = events().map((e) => e.type)
  expect(types.filter((t) => t === 'repair_prompt_sent')).toHaveLength(1)
  expect(
    events().some(
      (e) =>
        e.type === 'contract_violation' &&
        (e.payload as { reason?: string }).reason === 'dangling_evidence_ref',
    ),
  ).toBe(true)
})

test('a repair prompt names the schema rejection that caused the gap', async () => {
  // The gap here is not silence: the agent *did* emit a decision_needed, and
  // it was rejected for an over-long label. Told only what is missing, the
  // agent substitutes something else; told what was wrong, it can correct it.
  harness = await buildTestApp({ fakeAcpMode: 'schema-rejected' })
  const { app, objectiveId, events, until } = harness

  await app.inject({
    method: 'POST',
    url: `/api/objectives/${objectiveId}/events`,
    payload: { type: 'prompt', phase: 'propose' },
  })
  await until(() => events().some((e) => e.type === 'prompt_finished'))

  const repair = events().find((e) => e.type === 'repair_prompt_sent')
  expect(repair, 'no repair was sent at all').toBeDefined()
  const rejected = (repair?.payload as { rejected?: string[] } | undefined)?.rejected ?? []
  expect(rejected.join(' ')).toContain('options.0.label')
  expect(rejected.join(' ')).toMatch(/80/)

  // Still exactly one repair inside one turn — the corpus is turn-indexed.
  const types = events().map((e) => e.type)
  expect(types.filter((t) => t === 'repair_prompt_sent')).toHaveLength(1)
  expect(types.filter((t) => t === 'prompt_sent')).toHaveLength(1)
  // The repair supplied a valid card, so nothing is reported missing.
  expect(
    events().some(
      (e) =>
        e.type === 'contract_violation' &&
        (e.payload as { reason?: string }).reason === 'missing_expected',
    ),
  ).toBe(false)
})
