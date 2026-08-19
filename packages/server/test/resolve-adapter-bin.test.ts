import { expect, test } from 'vitest'
import { resolveAdapterBin } from '../src/agent/acp-agent-port.js'

test('resolveAdapterBin still resolves the real, pinned Claude Code adapter', () => {
  // Regression pin: the generalized function must not silently change what
  // the existing, real dependency resolves to.
  const bin = resolveAdapterBin('@zed-industries/claude-code-acp')
  expect(bin).toMatch(/claude-code-acp/)
})

test('resolveAdapterBin resolves a string-form bin field for an arbitrary package', () => {
  // tsx is already a real dependency of this workspace (used by the fake-ACP
  // test fixture harness) and its package.json's `bin` is a plain string —
  // exercising resolveAdapterBin against a second, real, already-installed
  // package proves the parameterization works generically, not just for the
  // one package it happened to be hardcoded to before.
  const bin = resolveAdapterBin('tsx')
  expect(bin).toMatch(/tsx/)
})

test('resolveAdapterBin throws its message with the given package name when missing', () => {
  expect(() => resolveAdapterBin('@vadd/definitely-not-a-real-package')).toThrow(
    /Cannot find.*@vadd\/definitely-not-a-real-package/,
  )
})
