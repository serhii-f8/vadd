import { describe, expect, it } from 'vitest'
import { scoreOption } from '../src/scoring/option-priority.js'

const base = { reversibility: 'medium' as const, pros: [], cons: [] }

describe('scoreOption', () => {
  it('scores each reversibility value at a fixed effort/pros/cons', () => {
    const high = scoreOption({ ...base, reversibility: 'high', effort: 'M' })
    const medium = scoreOption({ ...base, reversibility: 'medium', effort: 'M' })
    const low = scoreOption({ ...base, reversibility: 'low', effort: 'M' })
    expect(high).toBeGreaterThan(medium)
    expect(medium).toBeGreaterThan(low)
  })

  it('treats an absent effort as the same as M (neutral midpoint)', () => {
    const absent = scoreOption({ ...base, reversibility: 'high' })
    const medium = scoreOption({ ...base, reversibility: 'high', effort: 'M' })
    expect(absent).toBe(medium)
  })

  it('scores the pros/cons balance at its extremes', () => {
    const allPros = scoreOption({
      ...base,
      effort: 'M',
      pros: ['a', 'b', 'c', 'd', 'e'],
      cons: [],
    })
    const allCons = scoreOption({
      ...base,
      effort: 'M',
      pros: [],
      cons: ['a', 'b', 'c', 'd', 'e'],
    })
    const neither = scoreOption({ ...base, effort: 'M', pros: [], cons: [] })
    expect(allPros).toBeGreaterThan(neither)
    expect(neither).toBeGreaterThan(allCons)
  })

  it('always returns a value in [0, 1]', () => {
    const extremeHigh = scoreOption({
      reversibility: 'high',
      effort: 'S',
      pros: ['a', 'b', 'c', 'd', 'e'],
      cons: [],
    })
    const extremeLow = scoreOption({
      reversibility: 'low',
      effort: 'L',
      pros: [],
      cons: ['a', 'b', 'c', 'd', 'e'],
    })
    expect(extremeHigh).toBeLessThanOrEqual(1)
    expect(extremeHigh).toBeGreaterThanOrEqual(0)
    expect(extremeLow).toBeLessThanOrEqual(1)
    expect(extremeLow).toBeGreaterThanOrEqual(0)
  })

  it("clamps a pros/cons imbalance beyond the schema's 5-item cap to exactly 1", () => {
    // Not just <= 1: the schema caps pros/cons at 5 each, but scoreOption
    // itself must not depend on that cap holding — 10 pros / 0 cons would
    // put the raw (uncapped) balance term at 1.5 without the clamp.
    const beyondCap = scoreOption({
      reversibility: 'high',
      effort: 'S',
      pros: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      cons: [],
    })
    expect(beyondCap).toBe(1)
  })

  it('pins the formula to exact values at two points', () => {
    // reversibility high (1.0), effort absent→neutral (0.6), pros=['fast'] cons=[] → (1-0+5)/10=0.6
    // 0.5*1.0 + 0.3*0.6 + 0.2*0.6 = 0.80
    expect(scoreOption({ reversibility: 'high', pros: ['fast'], cons: [] })).toBeCloseTo(0.8)
    // reversibility low (0.2), effort L (0.2), pros=[] cons=['a','b'] → (0-2+5)/10=0.3
    // 0.5*0.2 + 0.3*0.2 + 0.2*0.3 = 0.1 + 0.06 + 0.06 = 0.22
    expect(
      scoreOption({ reversibility: 'low', effort: 'L', pros: [], cons: ['a', 'b'] }),
    ).toBeCloseTo(0.22)
  })
})
