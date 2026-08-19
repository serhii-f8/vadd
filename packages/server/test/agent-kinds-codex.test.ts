import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { CODEX_PROFILE_CANARY, codexConfig } from '../src/agent/kinds/codex.js'
import { withTempHome } from './fixtures/temp-repo.js'

afterEach(() => {
  delete process.env.VADD_HOME
})

test('codexConfig names the real package and kind', () => {
  const config = codexConfig()
  expect(config.kind).toBe('codex')
  expect(config.packageName).toBe('@agentclientprotocol/codex-acp')
  expect(config.missingAdapterMessage).toMatch(/codex-acp/)
})

test('codexConfig.setupProfile isolates CODEX_HOME to a managed profile dir', () => {
  const home = withTempHome()
  const config = codexConfig()
  const { env } = config.setupProfile()
  const codexHome = env.CODEX_HOME as string
  expect(codexHome).toBe(join(home, 'agent-profiles', 'codex'))
  expect(existsSync(codexHome)).toBe(true)
})

test('codexConfig.setupProfile writes an AGENTS.override.md carrying the contract addendum', () => {
  withTempHome()
  const config = codexConfig()
  const { env } = config.setupProfile()
  const codexHome = env.CODEX_HOME as string
  const content = readFileSync(join(codexHome, 'AGENTS.override.md'), 'utf8')
  expect(content).toContain(CODEX_PROFILE_CANARY)
  expect(content).toContain('vadd-event')
})
