import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { decidePermission, isInsideWorktree, pathsFromToolCall } from '../src/agent/permissions.js'

function worktree() {
  const root = mkdtempSync(join(tmpdir(), 'vadd-wt-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'x')
  return root
}

test('paths inside the worktree are allowed', () => {
  const root = worktree()
  expect(isInsideWorktree(root, join(root, 'src', 'a.ts'))).toBe(true)
  // A file that does not exist yet — the common case for a write.
  expect(isInsideWorktree(root, join(root, 'src', 'new.ts'))).toBe(true)
  expect(isInsideWorktree(root, join(root, 'deep', 'nested', 'new.ts'))).toBe(true)
})

test('paths outside the worktree are rejected', () => {
  const root = worktree()
  expect(isInsideWorktree(root, '/etc/passwd')).toBe(false)
  expect(isInsideWorktree(root, join(root, '..', 'escape.ts'))).toBe(false)
  expect(isInsideWorktree(root, `${root}-sibling/file.ts`)).toBe(false)
})

test('symlinks cannot escape the worktree', () => {
  const root = worktree()
  const outside = mkdtempSync(join(tmpdir(), 'vadd-outside-'))
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  symlinkSync(outside, join(root, 'link'))
  expect(isInsideWorktree(root, join(root, 'link', 'secret.txt'))).toBe(false)
})

test('pathsFromToolCall handles absent and null locations', () => {
  expect(pathsFromToolCall({})).toEqual([])
  expect(pathsFromToolCall({ locations: null })).toEqual([])
  expect(pathsFromToolCall({ locations: [{ path: '/a' }, { path: '/b' }] })).toEqual(['/a', '/b'])
})

test('pathsFromToolCall recovers paths the spike showed can go missing', () => {
  // The spike saw requestPermission arrive with locations absent while the
  // earlier tool_call for the same id had them. Both fallbacks must work.
  expect(pathsFromToolCall({ rawInput: { file_path: '/a/b.ts' } })).toEqual(['/a/b.ts'])
  const known = new Map([['tc1', ['/x/y.ts']]])
  expect(pathsFromToolCall({ toolCallId: 'tc1' }, known)).toEqual(['/x/y.ts'])
  // Sources are merged and de-duplicated, not preferred one over another.
  expect(
    pathsFromToolCall({ toolCallId: 'tc1', rawInput: { file_path: '/x/y.ts' } }, known),
  ).toEqual(['/x/y.ts'])
})

test('decidePermission fails closed when no path can be determined', () => {
  const root = worktree()
  // `paths.every(isInside)` would return true here. That is the bug this guards.
  expect(decidePermission(root, [])).toMatchObject({ allowed: false })
  expect(decidePermission(root, []).reason).toMatch(/no filesystem path/i)
})

test('decidePermission allows an all-inside set and rejects a mixed one', () => {
  const root = worktree()
  expect(decidePermission(root, [join(root, 'src', 'a.ts')]).allowed).toBe(true)
  // One bad path poisons the whole call — partial approval is not a thing.
  expect(decidePermission(root, [join(root, 'src', 'a.ts'), '/etc/passwd']).allowed).toBe(false)
})
