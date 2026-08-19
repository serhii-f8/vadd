import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
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

test('a DANGLING symlink cannot escape the worktree', () => {
  // The symlink test above passes because its target exists. existsSync()
  // follows the link, so a symlink whose target does NOT exist reports false
  // and the resolver walked straight past it, treating the link name as an
  // ordinary not-yet-created file inside the worktree — while a write through
  // it landed on the outside target. `git worktree add` materialises committed
  // symlinks verbatim, dangling ones included.
  const root = worktree()
  const outside = mkdtempSync(join(tmpdir(), 'vadd-outside-'))
  const victim = join(outside, 'not-yet-created.txt')
  symlinkSync(victim, join(root, 'dangling'))

  expect(existsSync(victim)).toBe(false)
  expect(isInsideWorktree(root, join(root, 'dangling'))).toBe(false)
  expect(decidePermission(root, [join(root, 'dangling')]).allowed).toBe(false)
})

test('a symlink chain out of the worktree is followed to its real target', () => {
  const root = worktree()
  const outside = mkdtempSync(join(tmpdir(), 'vadd-outside-'))
  // hop1 -> hop2 -> outside/target (which does not exist)
  symlinkSync(join(outside, 'target.txt'), join(root, 'hop2'))
  symlinkSync(join(root, 'hop2'), join(root, 'hop1'))
  expect(isInsideWorktree(root, join(root, 'hop1'))).toBe(false)
})

test('a symlink loop fails closed rather than hanging or throwing', () => {
  const root = worktree()
  // a -> b -> a. Neither resolves; the resolver must give up and refuse.
  symlinkSync(join(root, 'b'), join(root, 'a'))
  symlinkSync(join(root, 'a'), join(root, 'b'))
  expect(isInsideWorktree(root, join(root, 'a'))).toBe(false)
})

test('a dangling symlink INSIDE the worktree is still allowed', () => {
  // Fail-closed must not become fail-useless: a link to a sibling file the
  // agent has not written yet is a normal thing to permit.
  const root = worktree()
  symlinkSync(join(root, 'src', 'not-written-yet.ts'), join(root, 'inner-link'))
  expect(isInsideWorktree(root, join(root, 'inner-link'))).toBe(true)
})

test('pathsFromToolCall drops malformed location entries', () => {
  // `[{}]` yielded `[undefined]`, whose length is 1 — so decidePermission
  // skipped its empty-set branch and then threw inside resolve(undefined).
  // A throw is not an allow, but it turns a clean deny into an unhandled
  // rejection inside the async requestPermission handler.
  expect(pathsFromToolCall({ locations: [{}] as { path: string }[] })).toEqual([])
  expect(pathsFromToolCall({ locations: [{ path: '/a' }, {}] as { path: string }[] })).toEqual([
    '/a',
  ])
  expect(
    decidePermission(worktree(), pathsFromToolCall({ locations: [{}] as { path: string }[] })),
  ).toMatchObject({ allowed: false })
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

test('pathsFromToolCall reads Codex-style diff content blocks', () => {
  // Verified against @agentclientprotocol/codex-acp's real source
  // (CodexToolCallMapper.ts): an edit tool-call carries no top-level
  // `locations` and no `rawInput` at all — each changed file's path lives on
  // `content[].path` instead. Left unhandled, every Codex edit's path set
  // comes back empty and decidePermission fails closed on all of them.
  expect(
    pathsFromToolCall({
      content: [{ path: '/a/b.ts' }, { path: '/c/d.ts' }],
    } as never),
  ).toEqual(['/a/b.ts', '/c/d.ts'])
})

test('pathsFromToolCall merges content-block paths with the other sources, deduplicated', () => {
  expect(
    pathsFromToolCall({
      rawInput: { file_path: '/a/b.ts' },
      content: [{ path: '/a/b.ts' }, { path: '/e/f.ts' }],
    } as never),
  ).toEqual(['/a/b.ts', '/e/f.ts'])
})

test('pathsFromToolCall drops malformed content entries the same way it drops malformed locations', () => {
  expect(pathsFromToolCall({ content: [{}, { path: '/a' }] } as never)).toEqual(['/a'])
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
