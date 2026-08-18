import { expect, test } from 'vitest'
import { fastFixPlanLooksSimple } from '../src/policies/fast-fix-plan.js'

function task(ord: number) {
  return {
    id: `o1:${ord}`,
    ord,
    title: `Task ${ord}`,
    description: 'd',
    checkpointRef: null,
  }
}

test('a single-task plan looks simple', () => {
  expect(fastFixPlanLooksSimple([task(0)])).toBe(true)
})

test('a multi-task plan does not look simple', () => {
  expect(fastFixPlanLooksSimple([task(0), task(1)])).toBe(false)
})

test('an empty plan looks simple', () => {
  expect(fastFixPlanLooksSimple([])).toBe(true)
})
