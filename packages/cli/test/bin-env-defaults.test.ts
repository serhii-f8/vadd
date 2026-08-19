import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDefaults } from '../src/resolve-defaults.js'

describe('resolveDefaults', () => {
  it('computes migrations/prompts/web paths relative to the given base dir', () => {
    const here = '/opt/vadd-cli/dist'
    expect(resolveDefaults(here)).toEqual({
      migrationsDir: join(here, 'migrations'),
      promptsDir: join(here, 'prompts', 'claude-code', 'v1'),
      webDist: join(here, 'web'),
    })
  })
})
