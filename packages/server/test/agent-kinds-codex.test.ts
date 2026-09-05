import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

test('a user override of system-addendum.md reaches AGENTS.override.md too (D11)', () => {
  const home = withTempHome()
  mkdirSync(join(home, 'prompts'), { recursive: true })
  writeFileSync(
    join(home, 'prompts', 'system-addendum.md'),
    ['---', 'version: 1', 'phase: system', 'expects: []', '---', 'MY ADDENDUM RULES'].join('\n'),
  )
  const { env } = codexConfig().setupProfile()
  const content = readFileSync(join(env.CODEX_HOME as string, 'AGENTS.override.md'), 'utf8')
  expect(content).toContain('MY ADDENDUM RULES')
  expect(content).toContain(CODEX_PROFILE_CANARY)
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
