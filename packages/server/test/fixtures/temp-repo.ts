import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Points VADD_HOME at a fresh temp dir for the current test. Returns the path. */
export function withTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'vadd-home-'))
  process.env.VADD_HOME = home
  return home
}

/** Creates a temp git repo with one commit. Returns its path. */
export function makeTempRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'vadd-repo-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'test@vadd.local')
  git('config', 'user.name', 'vadd test')
  writeFileSync(join(repo, 'README.md'), '# temp\n')
  git('add', '-A')
  git('commit', '-qm', 'init')
  return repo
}
