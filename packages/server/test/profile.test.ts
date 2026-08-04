import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { agentProfileDir, ensureAgentProfile, PROFILE_CANARY } from '../src/agent/profile.js'

let home: string
const prev = process.env.VADD_HOME

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'vadd-profile-'))
  process.env.VADD_HOME = home
})
afterEach(() => {
  if (prev === undefined) delete process.env.VADD_HOME
  else process.env.VADD_HOME = prev
})

test('creates the profile under VADD_HOME with an empty skills directory', () => {
  const dir = ensureAgentProfile()
  expect(dir).toBe(agentProfileDir())
  expect(dir.startsWith(home)).toBe(true)
  expect(statSync(join(dir, 'skills')).isDirectory()).toBe(true)
  expect(statSync(join(dir, 'hooks')).isDirectory()).toBe(true)
  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({})
  expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain(PROFILE_CANARY)
})

test('is idempotent and regenerates a hand-edited CLAUDE.md', () => {
  const dir = ensureAgentProfile()
  writeFileSync(join(dir, 'CLAUDE.md'), 'tampered')
  ensureAgentProfile()
  expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain(PROFILE_CANARY)
})
