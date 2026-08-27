import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { branchExists } from '../src/git/inspect.js'
import { makeTempRepo } from './fixtures/temp-repo.js'

describe('branchExists', () => {
  it('is true for a branch that exists', () => {
    const repo = makeTempRepo()
    execFileSync('git', ['-C', repo, 'branch', 'vadd/exists'])
    expect(branchExists(repo, 'vadd/exists')).resolves.toBe(true)
  })

  it('is false for a branch that was never created', () => {
    const repo = makeTempRepo()
    expect(branchExists(repo, 'vadd/never-existed')).resolves.toBe(false)
  })

  it('is false for a branch that existed and was deleted', () => {
    const repo = makeTempRepo()
    execFileSync('git', ['-C', repo, 'branch', 'vadd/deleted'])
    execFileSync('git', ['-C', repo, 'branch', '-D', 'vadd/deleted'])
    expect(branchExists(repo, 'vadd/deleted')).resolves.toBe(false)
  })
})
