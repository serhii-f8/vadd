import { expect, test } from 'vitest'
import { CORE_VERSION } from '../src/index.js'

test('core package is importable from the workspace', () => {
  expect(CORE_VERSION).toBe('0.0.0')
})
