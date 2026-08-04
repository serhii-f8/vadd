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
  onPermission?: (d: { allowed: boolean; paths: string[]; reason?: string }) => void
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

test('updates the SDK schema rejects are still delivered, not dropped', async () => {
  // The SDK validates session/update against a strict zod schema BEFORE
  // dispatching, and a parse failure throws instead of calling the handler —
  // so the update vanishes with only the SDK's own console.error to show for
  // it. claude-code-acp sends `rawOutput` as an array, and as a string when a
  // tool fails, while the pinned SDK declares `z.record(z.unknown())`. Six of
  // twenty-five updates were lost this way in the session recorded as this
  // milestone's evidence — including the tool failure, which is exactly the
  // signal M0 exists to capture.
  const port = makePort({ mode: 'odd-raw-output' })
  const updates: RawAgentUpdate[] = []
  port.onUpdate((u) => updates.push(u))

  await port.start()
  const { sessionId } = await port.newSession({ cwd: process.cwd() })
  await port.prompt(sessionId, 'do a thing')

  // One agent_message_chunk plus BOTH tool_call_updates.
  expect(updates).toHaveLength(3)
  const kinds = updates.map((u) => (u.update as { sessionUpdate?: string }).sessionUpdate)
  expect(kinds).toEqual(['agent_message_chunk', 'tool_call_update', 'tool_call_update'])

  // The payload survives intact — this is a raw passthrough, not a coercion.
  const failed = updates[2]?.update as { status?: string; rawOutput?: unknown }
  expect(failed.status).toBe('failed')
  expect(failed.rawOutput).toContain('old_string')

  await port.stop()
})

test('permission is granted for a path inside the worktree', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'vadd-wt-'))
  const decisions: { allowed: boolean; paths: string[]; reason?: string }[] = []
  const port = makePort({
    mode: 'permission',
    worktreePath: wt,
    permissionPath: join(wt, 'src', 'new.ts'),
    onPermission: (d) => decisions.push(d),
  })
  await port.start()
  const { sessionId } = await port.newSession({ cwd: wt })
  await port.prompt(sessionId, 'write a file')
  expect(decisions).toHaveLength(1)
  expect(decisions[0]).toMatchObject({ allowed: true, paths: [join(wt, 'src', 'new.ts')] })
  await port.stop()
})

test('permission is refused for a path outside the worktree', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'vadd-wt-'))
  const decisions: { allowed: boolean; paths: string[]; reason?: string }[] = []
  const port = makePort({
    mode: 'permission',
    worktreePath: wt,
    permissionPath: '/etc/passwd',
    onPermission: (d) => decisions.push(d),
  })
  await port.start()
  const { sessionId } = await port.newSession({ cwd: wt })
  await port.prompt(sessionId, 'read a secret')
  expect(decisions).toHaveLength(1)
  expect(decisions[0]).toMatchObject({ allowed: false, paths: ['/etc/passwd'] })
  // The reason is the diagnostic a rejection is logged with — assert it exists.
  expect(decisions[0]?.reason).toMatch(/outside the objective worktree/i)
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
