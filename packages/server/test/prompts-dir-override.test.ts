import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bundledPromptDir } from '../src/prompts/renderer.js'

describe('bundledPromptDir override', () => {
  const originalEnv = process.env.VADD_PROMPTS_DIR

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.VADD_PROMPTS_DIR
    else process.env.VADD_PROMPTS_DIR = originalEnv
  })

  it('returns VADD_PROMPTS_DIR verbatim when set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vadd-prompts-'))
    writeFileSync(join(dir, 'marker.txt'), 'probe')
    process.env.VADD_PROMPTS_DIR = dir

    expect(bundledPromptDir()).toBe(dir)
  })

  it('falls back to the repo-root-relative path when unset', () => {
    delete process.env.VADD_PROMPTS_DIR
    expect(bundledPromptDir()).toMatch(/prompts[/\\]claude-code[/\\]v1$/)
  })
})
