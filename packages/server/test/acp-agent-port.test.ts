import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RawAgentUpdate } from '@vadd/core'
import { expect, test } from 'vitest'
import { AcpAgentPort } from '../src/agent/acp-agent-port.js'

const fake = fileURLToPath(new URL('./fixtures/fake-acp-agent.ts', import.meta.url))

// `pnpm tsx <file>` (as written) requires a package.json in `cwd` to resolve
// its project context, which fails in this pnpm version once `cwd` is a bare
// temp worktree — the identical class of failure the acp-handshake note
// documents for `npx`. Resolving tsx's own CLI entry point (the same pattern
// `resolveAdapterBin` uses in production) and spawning it through node
// sidesteps pnpm's project resolution entirely and is independent of `cwd`.
function resolveTsxCli(): string {
  const pkgPath = fileURLToPath(import.meta.resolve('tsx/package.json'))
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string }
  return resolve(dirname(pkgPath), pkg.bin)
}
const tsxCli = resolveTsxCli()

function makePort(opts: {
  mode: string
  worktreePath?: string
  permissionPath?: string
  onPermission?: (d: { allowed: boolean; paths: string[] }) => void
}) {
  const wt = opts.worktreePath ?? mkdtempSync(join(tmpdir(), 'vadd-wt-'))
  return new AcpAgentPort({
    worktreePath: wt,
    command: process.execPath,
    args: [tsxCli, fake],
    env: {
      FAKE_ACP_MODE: opts.mode,
      ...(opts.permissionPath ? { FAKE_ACP_PATH: opts.permissionPath } : {}),
    },
    onPermission: opts.onPermission ?? (() => {}),
  })
}

test('start, newSession, prompt and stop complete against a fake agent', async () => {
  const port = makePort({ mode: 'normal' })
  const updates: RawAgentUpdate[] = []
  port.onUpdate((u) => updates.push(u))

  await port.start()
  const { sessionId } = await port.newSession({ cwd: process.cwd() })
  expect(sessionId).toBe('fake-session-1')

  const result = await port.prompt(sessionId, 'do a thing')
  expect(result.stopReason).toBe('end_turn')
  expect(updates).toHaveLength(1)
  expect(updates[0]?.sessionId).toBe('fake-session-1')
  expect(updates[0]?.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

  await port.stop()
})

test('permission is granted for a path inside the worktree', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'vadd-wt-'))
  const decisions: { allowed: boolean; paths: string[] }[] = []
  const port = makePort({
    mode: 'permission',
    worktreePath: wt,
    permissionPath: join(wt, 'src', 'new.ts'),
    onPermission: (d) => decisions.push(d),
  })
  await port.start()
  const { sessionId } = await port.newSession({ cwd: wt })
  await port.prompt(sessionId, 'write a file')
  expect(decisions).toEqual([{ allowed: true, paths: [join(wt, 'src', 'new.ts')] }])
  await port.stop()
})

test('permission is refused for a path outside the worktree', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'vadd-wt-'))
  const decisions: { allowed: boolean; paths: string[] }[] = []
  const port = makePort({
    mode: 'permission',
    worktreePath: wt,
    permissionPath: '/etc/passwd',
    onPermission: (d) => decisions.push(d),
  })
  await port.start()
  const { sessionId } = await port.newSession({ cwd: wt })
  await port.prompt(sessionId, 'read a secret')
  expect(decisions).toEqual([{ allowed: false, paths: ['/etc/passwd'] }])
  await port.stop()
})

test('a crashing agent rejects the pending prompt rather than hanging', async () => {
  const port = makePort({ mode: 'crash-on-prompt' })
  const exits: { code: number | null }[] = []
  port.onExit((e) => exits.push(e))

  await port.start()
  const { sessionId } = await port.newSession({ cwd: process.cwd() })
  await expect(port.prompt(sessionId, 'crash please')).rejects.toThrow()
  expect(exits[0]?.code).toBe(3)
  await port.stop()
})

test('stop is safe to call twice', async () => {
  const port = makePort({ mode: 'normal' })
  await port.start()
  await port.stop()
  await expect(port.stop()).resolves.toBeUndefined()
})

test('start rejects with an install hint when the adapter is missing', async () => {
  const port = new AcpAgentPort({
    worktreePath: mkdtempSync(join(tmpdir(), 'vadd-wt-')),
    command: 'vadd-no-such-binary',
    args: [],
  })
  // Must reject, not hang: initialize() would otherwise await a reply forever.
  await expect(port.start()).rejects.toThrow(/install it with/i)
  await port.stop()
})
