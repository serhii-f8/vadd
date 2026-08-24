import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// Bound to a variable first: Vite statically special-cases the literal
// `new URL('<literal>', import.meta.url)` and rewrites it, which under the
// test environment resolves against the wrong base. The web redesign paid
// for this once already.
const here = import.meta.url
const SRC = fileURLToPath(new URL('../src', here))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

/** Git subcommands that can open a network connection. */
const NETWORK = ['fetch', 'pull', 'push', 'clone', 'ls-remote', 'remote'] as const

/**
 * Matches a subcommand only where it is the first element of an array literal
 * — i.e. an argv passed to a git runner. `['stash', 'push', ...]` does not
 * match (its first element is `stash`), and neither does an `OperationName`
 * union member (`mutation-guards.ts`'s `| 'pull'` / `| 'push'`) or a `'push'`
 * / `'pull'` passed as a plain function argument (`routes/git.ts`'s `mutate(
 * ..., 'push', ...)`). Scanning whole-file content (not line-by-line) so a
 * multi-line array literal is still caught, with the line number computed
 * from the match index afterward.
 */
const ARGV = new RegExp(`\\[\\s*'(${NETWORK.join('|')})'`, 'g')

/** The one module allowed to issue a network-capable git subcommand. */
const OWNER = join(SRC, 'git', 'remote.ts')

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

test('only remote.ts issues a git subcommand that can reach a network', () => {
  const offenders: string[] = []

  for (const file of walk(SRC)) {
    if (file === OWNER) continue
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(ARGV)) {
      offenders.push(`${file.slice(SRC.length + 1)}:${lineOf(text, m.index)}: ${m[1]}`)
    }
  }

  // A network-capable git call appearing anywhere unreviewed is exactly what
  // §10's guarantee is about, and it cannot be satisfied by accident.
  expect(offenders).toEqual([])
})

test('the scan can actually see a network-capable call', () => {
  // Guards the guard: a scan matching nothing would pass forever. remote.ts
  // must contain at least four distinct network-capable argv arrays.
  const owner = readFileSync(OWNER, 'utf8')
  const found = new Set([...owner.matchAll(ARGV)].map((m) => m[1]))
  expect(found.size).toBeGreaterThanOrEqual(4)
})
