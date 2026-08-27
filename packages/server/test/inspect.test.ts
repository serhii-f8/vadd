import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { branchExists } from '../src/git/inspect.js'
import { makeTempRepo } from './fixtures/temp-repo.js'

describe('branchExists', () => {
  it('is true for a branch that exists', async () => {
    const repo = makeTempRepo()
    execFileSync('git', ['-C', repo, 'branch', 'vadd/exists'])
    await expect(branchExists(repo, 'vadd/exists')).resolves.toBe(true)
  })

  it('is false for a branch that was never created', async () => {
    const repo = makeTempRepo()
    await expect(branchExists(repo, 'vadd/never-existed')).resolves.toBe(false)
  })

  it('is false for a branch that existed and was deleted', async () => {
    const repo = makeTempRepo()
    execFileSync('git', ['-C', repo, 'branch', 'vadd/deleted'])
    execFileSync('git', ['-C', repo, 'branch', '-D', 'vadd/deleted'])
    await expect(branchExists(repo, 'vadd/deleted')).resolves.toBe(false)
  })
})
