import { expect, test } from 'vitest'
import { CreateObjectiveBody, ObjectiveCommand, RegisterProjectBody } from '../src/index.js'

test('RegisterProjectBody requires a non-empty repoPath', () => {
  expect(RegisterProjectBody.safeParse({ repoPath: '/tmp/x' }).success).toBe(true)
  expect(RegisterProjectBody.safeParse({ repoPath: '' }).success).toBe(false)
  expect(RegisterProjectBody.safeParse({}).success).toBe(false)
})

test('CreateObjectiveBody requires title and goalText', () => {
  expect(CreateObjectiveBody.safeParse({ title: 'T', goalText: 'G' }).success).toBe(true)
  expect(CreateObjectiveBody.safeParse({ title: 'T' }).success).toBe(false)
})

test('ObjectiveCommand accepts only the three M0 commands', () => {
  expect(ObjectiveCommand.safeParse({ type: 'prompt', text: 'hi' }).success).toBe(true)
  expect(ObjectiveCommand.safeParse({ type: 'cancel' }).success).toBe(true)
  expect(ObjectiveCommand.safeParse({ type: 'integrate', action: 'discard' }).success).toBe(true)
  // M1 commands must be rejected in M0
  expect(ObjectiveCommand.safeParse({ type: 'approve_plan' }).success).toBe(false)
  expect(ObjectiveCommand.safeParse({ type: 'integrate', action: 'merge' }).success).toBe(false)
})
