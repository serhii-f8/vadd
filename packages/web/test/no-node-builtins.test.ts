import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { expect, test } from 'vitest'

/**
 * A browser has no `node:` builtins — Vite substitutes a stub that throws on any
 * property access — so one node-only module anywhere in the web import graph
 * takes down every page that reaches it.
 *
 * This project's own web Vitest project cannot catch that: `environment: 'jsdom'`
 * still runs inside Node, where `node:path` resolves normally. jsdom simulates
 * the DOM, not the browser's module environment. Hence a static walk.
 *
 * It caught `@vadd/core`'s barrel, which re-exports `policies/command-policy.js`
 * (`node:path`) both directly and via `policies/verification-resolution.js`, and
 * so cannot be imported for value from a browser. Import the specific
 * browser-safe module instead — see `DecisionCard.tsx`.
 */

const here = dirname(new URL(import.meta.url).pathname)
const WEB_SRC = resolve(here, '../src')
const CORE = resolve(here, '../../core')

/** Whole-line `import type` / `export type` is erased at compile — no runtime edge. */
function isTypeOnly(line: string): boolean {
  return /^\s*(?:import|export)\s+type\b/.test(line)
}

function specifiersOf(source: string): string[] {
  const out: string[] = []
  for (const line of source.split('\n')) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || isTypeOnly(line)) continue
    for (const m of line.matchAll(/\bfrom\s+'([^']+)'|\bimport\s+'([^']+)'/g)) {
      const specifier = m[1] ?? m[2]
      if (specifier !== undefined) out.push(specifier)
    }
  }
  return out
}

/** Bundler-style resolution: bare extension, .ts/.tsx, or a directory index. */
function resolveFile(base: string): string | undefined {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ]
  return candidates.find((c) => existsSync(c) && statSync(c).isFile())
}

/** `undefined` for a specifier that is a real browser dependency (react, xstate, a .css). */
function resolveSpecifier(specifier: string, fromFile: string): string | undefined {
  if (specifier.startsWith('.')) return resolveFile(resolve(dirname(fromFile), specifier))
  if (specifier.startsWith('@/')) return resolveFile(resolve(WEB_SRC, specifier.slice(2)))
  if (specifier === '@vadd/core') return resolveFile(resolve(CORE, 'src/index.ts'))
  if (specifier.startsWith('@vadd/core/')) {
    return resolveFile(resolve(CORE, 'src', specifier.slice('@vadd/core/'.length)))
  }
  return undefined
}

function walkFrom(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.shift() as string
    if (seen.has(file)) continue
    const specifiers = specifiersOf(readFileSync(file, 'utf8'))
    seen.set(
      file,
      specifiers.filter((s) => s.startsWith('node:')),
    )
    for (const specifier of specifiers) {
      const next = resolveSpecifier(specifier, file)
      if (next !== undefined) queue.push(next)
    }
  }
  return seen
}

function sourceFiles(dir: string): string[] {
  // `readdirSync` with recursive lands us plain names; build absolute paths.
  const { readdirSync } = require('node:fs') as typeof import('node:fs')
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => resolve(dir, name))
}

test('nothing reachable from packages/web/src imports a node: builtin', () => {
  const offenders = [...walkFrom(sourceFiles(WEB_SRC))]
    .filter(([, nodeImports]) => nodeImports.length > 0)
    .map(
      ([file, imports]) =>
        `${file.replace(resolve(here, '../..'), 'packages')} → ${imports.join(', ')}`,
    )
    .sort()

  expect(offenders).toEqual([])
})
