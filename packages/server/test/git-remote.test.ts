import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { gitRemote, listRemotes, RemoteError } from '../src/git/remote.js'
import { makeBareRemote } from './fixtures/bare-remote.js'
import { makeTempRepo } from './fixtures/temp-repo.js'

test('listRemotes reports the configured remote and its urls', async () => {
  const repo = makeTempRepo()
  const bare = makeBareRemote(repo)
  const remotes = await listRemotes(repo)
  expect(remotes).toHaveLength(1)
  expect(remotes[0]?.name).toBe('origin')
  expect(remotes[0]?.fetchUrl).toBe(bare)
  expect(remotes[0]?.pushUrl).toBe(bare)
})

test('listRemotes is empty for a repo with no remote', async () => {
  expect(await listRemotes(makeTempRepo())).toEqual([])
})

test('a failing remote command throws RemoteError carrying git own message', async () => {
  const repo = makeTempRepo()
  makeBareRemote(repo)
  // A ref that does not exist: git refuses, and the message is git's.
  await expect(gitRemote(repo, ['push', 'origin', 'no-such-branch'])).rejects.toThrow(RemoteError)
  await expect(gitRemote(repo, ['push', 'origin', 'no-such-branch'])).rejects.toThrow(
    /no-such-branch|does not match any/i,
  )
})

test('a missing credential cannot hang, even against a real 401 and the user own GIT_ASKPASS', async () => {
  // `127.0.0.1:1` (this test's original target) refuses the TCP connection
  // instantly, before git ever reaches an auth decision — so it could not
  // discriminate GIT_TERMINAL_PROMPT=0's presence at all, and did not: a
  // mutation removing NO_PROMPT_ENV entirely left this test passing.
  // Measured directly against a real local server that returns 401
  // WWW-Authenticate: Basic (no external network — 127.0.0.1 only): git
  // consults GIT_ASKPASS *before* any terminal prompt, an askpass helper
  // needs no TTY, and execa merges `env` with `process.env` by default — so
  // a user's own GIT_ASKPASS (GNOME keyring, Git Credential Manager, an IDE
  // integration) is inherited into the child and hangs the request even
  // with GIT_TERMINAL_PROMPT=0 set. This test stands up that real 401
  // server and plants a blocking askpass in `process.env` to prove
  // `gitRemote` overrides it.
  const server = createServer((_req, res) => {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="vadd"' })
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port

  const repo = makeTempRepo()
  execFileSync('git', ['-C', repo, 'remote', 'add', 'auth', `http://127.0.0.1:${port}/repo.git`], {
    stdio: 'pipe',
  })

  const askpass = join(repo, '..', 'blocking-askpass.sh')
  // Sleeps well past gitRemote's own 2s timeout below: if the user's
  // GIT_ASKPASS survived into the child, this is what would hang the
  // request instead of the 401 failing it fast.
  writeFileSync(askpass, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })

  const previousAskpass = process.env.GIT_ASKPASS
  process.env.GIT_ASKPASS = askpass
  try {
    const started = Date.now()
    await expect(gitRemote(repo, ['fetch', 'auth'], 2_000)).rejects.toThrow(RemoteError)
    // Bounded well under gitRemote's own 2s timeout: this is the assertion
    // that a surviving askpass would fail. A blocked askpass would sit until
    // that timeout fired instead.
    expect(Date.now() - started).toBeLessThan(1_000)
  } finally {
    if (previousAskpass === undefined) delete process.env.GIT_ASKPASS
    else process.env.GIT_ASKPASS = previousAskpass
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('a command that outruns its timeout is killed and reports timedOut', async () => {
  const repo = makeTempRepo()
  makeBareRemote(repo)
  // The brief's own first choice, `--upload-pack='sleep 30'`, does not hang on
  // this machine's git: a local-transport fetch passes the remote path as an
  // extra argument to the upload-pack command, and `sleep` rejects it
  // ("invalid time interval '<path>'") in ~4ms rather than blocking. A local
  // wrapper script that ignores its arguments and `exec`s `sleep 30` in their
  // place reproduces the real scenario the module's own doc comment names —
  // "the transport helper git spawns" — as a genuine grandchild process, and
  // is what actually distinguishes a process-group kill from killing just the
  // `git` leader: confirmed by hand that killing the leader pid alone leaves
  // `sleep 30` running as an orphan, while `killGroup`'s negative-pid kill
  // reaches it.
  const script = join(repo, '..', 'slow-upload-pack.sh')
  writeFileSync(script, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 })
  const started = Date.now()
  try {
    await gitRemote(repo, ['fetch', `--upload-pack=${script}`, 'origin'], 1_000)
    throw new Error('should have thrown')
  } catch (err) {
    expect(err).toBeInstanceOf(RemoteError)
    expect((err as RemoteError).timedOut).toBe(true)
  }
  // execa's own timeout signals the process VADD spawned and not the command
  // underneath it — phase 4 measured a `sleep 5` under a 1s timeout taking
  // 5006ms and surviving. The group kill is what makes this bound real.
  expect(Date.now() - started).toBeLessThan(5_000)
})
