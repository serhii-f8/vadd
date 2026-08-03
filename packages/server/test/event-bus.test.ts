import { expect, test, vi } from 'vitest'
import { createDb } from '../src/db/client.js'
import { EventBus } from '../src/events/event-bus.js'
import { withTempHome } from './fixtures/temp-repo.js'

function bus() {
  const home = withTempHome()
  return new EventBus(createDb(`${home}/vadd.db`))
}

test('emit persists and returns a row with a monotonic id', () => {
  const b = bus()
  const a = b.emit({ type: 'first', payload: { a: 1 } })
  const c = b.emit({ type: 'second', payload: { b: 2 } })
  expect(c.id).toBeGreaterThan(a.id)
  expect(a.payload).toEqual({ a: 1 })
})

test('subscribers receive events for their objective only', () => {
  const b = bus()
  const forO1 = vi.fn()
  const forAll = vi.fn()
  b.subscribe('o1', forO1)
  b.subscribe(null, forAll)

  b.emit({ objectiveId: 'o1', type: 'x', payload: {} })
  b.emit({ objectiveId: 'o2', type: 'y', payload: {} })

  expect(forO1).toHaveBeenCalledTimes(1)
  expect(forAll).toHaveBeenCalledTimes(2)
})

test('unsubscribe stops delivery', () => {
  const b = bus()
  const cb = vi.fn()
  const off = b.subscribe(null, cb)
  b.emit({ type: 'x', payload: {} })
  off()
  b.emit({ type: 'y', payload: {} })
  expect(cb).toHaveBeenCalledTimes(1)
})

test('since replays only events after the cursor', () => {
  const b = bus()
  const first = b.emit({ objectiveId: 'o1', type: 'a', payload: {} })
  b.emit({ objectiveId: 'o1', type: 'b', payload: {} })
  b.emit({ objectiveId: 'o2', type: 'c', payload: {} })

  const replay = b.since('o1', first.id)
  expect(replay.map((e) => e.type)).toEqual(['b'])
  expect(b.since(null, 0)).toHaveLength(3)
})

test('a throwing subscriber does not block other subscribers', () => {
  const b = bus()
  const good = vi.fn()
  b.subscribe(null, () => {
    throw new Error('boom')
  })
  b.subscribe(null, good)
  expect(() => b.emit({ type: 'x', payload: {} })).not.toThrow()
  expect(good).toHaveBeenCalledTimes(1)
})
