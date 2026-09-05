import { describe, expect, it } from 'vitest'
import { changeCells } from '../src/evidence/ChangeBar.js'

describe('changeCells', () => {
  it('apportions five cells by share, never hiding a non-zero side', () => {
    expect(changeCells(186, 12)).toEqual(['a', 'a', 'a', 'a', 'r'])
    expect(changeCells(12, 186)).toEqual(['a', 'r', 'r', 'r', 'r'])
  })

  it('splits an even change evenly', () => {
    expect(changeCells(10, 10, 4)).toEqual(['a', 'a', 'r', 'r'])
  })

  it('is all neutral for no change', () => {
    expect(changeCells(0, 0)).toEqual(['n', 'n', 'n', 'n', 'n'])
  })

  it('gives every cell to the only side that changed', () => {
    expect(changeCells(40, 0)).toEqual(['a', 'a', 'a', 'a', 'a'])
    expect(changeCells(0, 3)).toEqual(['r', 'r', 'r', 'r', 'r'])
  })
})
