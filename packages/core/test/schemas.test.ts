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

test('ObjectiveCommand carries the M0 commands plus spec §7s machine commands', () => {
  expect(ObjectiveCommand.safeParse({ type: 'prompt', text: 'hi' }).success).toBe(true)
  expect(ObjectiveCommand.safeParse({ type: 'cancel' }).success).toBe(true)
  expect(ObjectiveCommand.safeParse({ type: 'integrate', action: 'discard' }).success).toBe(true)

  // Phase 3 adds the commands that feed the machine (spec §7).
  for (const command of [
    { type: 'start' },
    { type: 'decide', decisionId: 'd', optionId: 'a' },
    { type: 'answer_clarification', answer: 'sqlite' },
    { type: 'approve_plan' },
    { type: 'approve_plan', edits: [{ title: 'Fix it', description: 'patch' }] },
    { type: 'approve_task' },
    { type: 'revise', instruction: 'also handle null' },
    { type: 'rollback' },
    { type: 'pause' },
    { type: 'resume' },
    { type: 'integrate', action: 'commit' },
    { type: 'integrate', action: 'keep' },
  ]) {
    expect(ObjectiveCommand.safeParse(command).success, JSON.stringify(command)).toBe(true)
  }

  // `pr` and `merge` parse so the route can refuse them with a message naming
  // the milestone; spec §8.1 keeps both in M2. The schema is not where that
  // refusal lives — see routes-commands.test.ts.
  expect(ObjectiveCommand.safeParse({ type: 'integrate', action: 'merge' }).success).toBe(true)
  expect(ObjectiveCommand.safeParse({ type: 'integrate', action: 'nonsense' }).success).toBe(false)

  // Still rejected: a decide with no option, and an unknown verb.
  expect(ObjectiveCommand.safeParse({ type: 'decide', decisionId: 'd' }).success).toBe(false)
  expect(ObjectiveCommand.safeParse({ type: 'teleport' }).success).toBe(false)
})
