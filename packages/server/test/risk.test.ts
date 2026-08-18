import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { computeTaskRisk } from '../src/verification/risk.js'
import { makeTempRepo } from './fixtures/temp-repo.js'

const POLICY = { protectedGlobs: [], maxLines: 150 }

function git(repo: string, ...args: string[]): void {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
}

function checkpoint(repo: string): string {
  return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

test('a small, ordinary change is low risk', async () => {
  const repo = makeTempRepo()
  const ref = checkpoint(repo)
  writeFileSync(join(repo, 'src.ts'), 'export const x = 1\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'add file')

  expect(await computeTaskRisk(repo, ref, POLICY)).toBe('low')
})

test('touching a migrations path is high risk, read from the real diff', async () => {
  const repo = makeTempRepo()
  const ref = checkpoint(repo)
  execFileSync('mkdir', ['-p', join(repo, 'migrations')])
  writeFileSync(join(repo, 'migrations', '0001.sql'), 'ALTER TABLE x ADD y int;\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'migration')

  expect(await computeTaskRisk(repo, ref, POLICY)).toBe('high')
})

test('an oversize diff is high risk, counting the real numstat', async () => {
  const repo = makeTempRepo()
  const ref = checkpoint(repo)
  writeFileSync(join(repo, 'big.txt'), `${'line\n'.repeat(200)}`)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'big file')

  expect(await computeTaskRisk(repo, ref, POLICY)).toBe('high')
})

test('deleting a JS export line the diff shows is high risk', async () => {
  const repo = makeTempRepo()
  writeFileSync(join(repo, 'lib.ts'), 'export function a() {}\nexport function b() {}\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'lib')
  const ref = checkpoint(repo)
  writeFileSync(join(repo, 'lib.ts'), 'export function a() {}\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'remove b')

  expect(await computeTaskRisk(repo, ref, POLICY)).toBe('high')
})

test('a bad ref fails closed to high risk', async () => {
  const repo = makeTempRepo()
  expect(await computeTaskRisk(repo, 'not-a-real-ref', POLICY)).toBe('high')
})
