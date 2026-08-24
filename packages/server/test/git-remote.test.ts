import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
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

test('interactive prompting is disabled, so a missing credential cannot hang', async () => {
  const repo = makeTempRepo()
  // A remote that does not exist locally and cannot be reached without
  // credentials. With GIT_TERMINAL_PROMPT unset git may block forever waiting
  // for input nobody can type; with it set to 0 it fails immediately.
  execFileSync('git', ['-C', repo, 'remote', 'add', 'fake', 'https://127.0.0.1:1/x.git'], {
    stdio: 'pipe',
  })
  const started = Date.now()
  await expect(gitRemote(repo, ['fetch', 'fake'], 20_000)).rejects.toThrow(RemoteError)
  // Bounded well under the timeout: this is the assertion that a hang would
  // fail. A prompt would sit until the 20s timeout fired.
  expect(Date.now() - started).toBeLessThan(15_000)
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
