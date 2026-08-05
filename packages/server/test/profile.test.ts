import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { agentProfileDir, ensureAgentProfile, PROFILE_CANARY } from '../src/agent/profile.js'

let home: string
let configSrc: string
const prevHome = process.env.VADD_HOME
const prevConfigDir = process.env.CLAUDE_CONFIG_DIR

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'vadd-profile-'))
  process.env.VADD_HOME = home
  // Isolates the credentials-copy source too, so this suite never reads (or
  // leaks a copy of) the developer's real ~/.claude/.credentials.json.
  configSrc = mkdtempSync(join(tmpdir(), 'vadd-profile-src-'))
  process.env.CLAUDE_CONFIG_DIR = configSrc
})
afterEach(() => {
  if (prevHome === undefined) delete process.env.VADD_HOME
  else process.env.VADD_HOME = prevHome
  if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
})

test('creates the profile under VADD_HOME with an empty skills directory', () => {
  const dir = ensureAgentProfile()
  expect(dir).toBe(agentProfileDir())
  expect(dir.startsWith(home)).toBe(true)
  expect(statSync(join(dir, 'skills')).isDirectory()).toBe(true)
  expect(statSync(join(dir, 'hooks')).isDirectory()).toBe(true)
  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({})
  expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain(PROFILE_CANARY)
  expect(existsSync(join(dir, '.credentials.json'))).toBe(false)
})

test('copies OAuth credentials from CLAUDE_CONFIG_DIR so the isolated adapter can authenticate', () => {
  writeFileSync(join(configSrc, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"fake"}}\n')

  const dir = ensureAgentProfile()

  expect(readFileSync(join(dir, '.credentials.json'), 'utf8')).toBe(
    '{"claudeAiOauth":{"accessToken":"fake"}}\n',
  )
})

test('is idempotent and regenerates a hand-edited CLAUDE.md', () => {
  const dir = ensureAgentProfile()
  writeFileSync(join(dir, 'CLAUDE.md'), 'tampered')
  ensureAgentProfile()
  expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain(PROFILE_CANARY)
})
