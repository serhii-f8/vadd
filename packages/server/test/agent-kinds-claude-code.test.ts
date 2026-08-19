import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { claudeCodeConfig } from '../src/agent/kinds/claude-code.js'
import { withTempHome } from './fixtures/temp-repo.js'

afterEach(() => {
  delete process.env.VADD_HOME
})

test('claudeCodeConfig names the pinned package and kind', () => {
  const config = claudeCodeConfig()
  expect(config.kind).toBe('claude-code')
  expect(config.packageName).toBe('@zed-industries/claude-code-acp')
  expect(config.missingAdapterMessage).toMatch(/claude-code-acp/)
})

test('claudeCodeConfig.setupProfile isolates CLAUDE_CONFIG_DIR to the managed profile dir', () => {
  const home = withTempHome()
  const config = claudeCodeConfig()
  const { env } = config.setupProfile()
  expect(env.CLAUDE_CONFIG_DIR).toBe(join(home, 'agent-profiles', 'claude-code'))
  expect(existsSync(env.CLAUDE_CONFIG_DIR)).toBe(true)
})
