import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A real bare repository on local disk, added to `repo` as a remote.
 *
 * This is what lets Pass C be tested honestly and offline at the same time: a
 * push writes real objects, a fetch updates real remote-tracking refs, and
 * ahead/behind is computed by real git — while no packet leaves the machine.
 * Mocking `execa` would have pinned the author's belief about git rather than
 * git's behaviour, which is the standing rule from Pass A.
 */
export function makeBareRemote(repo: string, name = 'origin'): string {
  const bare = mkdtempSync(join(tmpdir(), 'vadd-bare-'))
  execFileSync('git', ['init', '--bare', '-q', bare], { stdio: 'pipe' })
  execFileSync('git', ['-C', repo, 'remote', 'add', name, bare], { stdio: 'pipe' })
  return bare
}

/** A second working clone of `bare`, for producing commits to pull. */
export function cloneOf(bare: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vadd-clone-'))
  execFileSync('git', ['clone', '-q', bare, dir], { stdio: 'pipe' })
  const g = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' })
  g('config', 'user.email', 'other@vadd.local')
  g('config', 'user.name', 'other')
  return dir
}
