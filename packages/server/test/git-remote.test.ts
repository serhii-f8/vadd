import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, test } from 'vitest'
import {
  cloneRepo,
  fetchRemote,
  gitRemote,
  listRemotes,
  pullFastForward,
  pushBranch,
  RemoteError,
} from '../src/git/remote.js'
import { cloneOf, makeBareRemote } from './fixtures/bare-remote.js'
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

  // Its own temp directory, not `join(repo, '..')` — that is the shared
  // system temp root, so the earlier version left a mode-0755 script called
  // `blocking-askpass.sh` sitting in `/tmp` after every run, and handed it to
  // git as `GIT_ASKPASS`. Removed in the `finally` below.
  const scriptDir = mkdtempSync(join(tmpdir(), 'vadd-askpass-'))
  const askpass = join(scriptDir, 'blocking-askpass.sh')
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
    rmSync(scriptDir, { recursive: true, force: true })
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
  // Its own temp directory, cleaned up below: `join(repo, '..')` is the shared
  // system temp root, and the earlier version left this script in `/tmp`.
  const scriptDir = mkdtempSync(join(tmpdir(), 'vadd-uploadpack-'))
  const script = join(scriptDir, 'slow-upload-pack.sh')
  writeFileSync(script, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 })
  const started = Date.now()
  try {
    await gitRemote(repo, ['fetch', `--upload-pack=${script}`, 'origin'], 1_000)
    throw new Error('should have thrown')
  } catch (err) {
    expect(err).toBeInstanceOf(RemoteError)
    expect((err as RemoteError).timedOut).toBe(true)
  } finally {
    rmSync(scriptDir, { recursive: true, force: true })
  }
  // execa's own timeout signals the process VADD spawned and not the command
  // underneath it — phase 4 measured a `sleep 5` under a 1s timeout taking
  // 5006ms and surviving. The group kill is what makes this bound real.
  expect(Date.now() - started).toBeLessThan(5_000)
})

function head(dir: string): string {
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

/** Pushes `repo`'s current branch to `bare`, then commits once in a clone. */
function seedRemoteAhead(repo: string, bare: string): { clone: string; sha: string } {
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'master'], { stdio: 'pipe' })
  const clone = cloneOf(bare)
  writeFileSync(join(clone, 'from-elsewhere.txt'), 'x\n')
  execFileSync('git', ['-C', clone, 'add', '-A'], { stdio: 'pipe' })
  execFileSync('git', ['-C', clone, 'commit', '-qm', 'made elsewhere'], { stdio: 'pipe' })
  execFileSync('git', ['-C', clone, 'push', '-q'], { stdio: 'pipe' })
  return { clone, sha: head(clone) }
}

test('fetch updates the remote-tracking ref without touching HEAD', async () => {
  const repo = makeTempRepo()
  const bare = makeBareRemote(repo)
  const { sha } = seedRemoteAhead(repo, bare)
  const before = head(repo)

  await fetchRemote(repo, 'origin')

  const tracking = execFileSync('git', ['-C', repo, 'rev-parse', 'refs/remotes/origin/master'], {
    encoding: 'utf8',
  }).trim()
  expect(tracking).toBe(sha)
  // The whole reason fetch is not gated: it moves nothing local.
  expect(head(repo)).toBe(before)
  expect(
    execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
  ).toBe('')
})

test('pull fast-forwards the branch', async () => {
  const repo = makeTempRepo()
  const bare = makeBareRemote(repo)
  const { sha } = seedRemoteAhead(repo, bare)
  expect(head(repo)).not.toBe(sha)

  await pullFastForward(repo, 'origin')

  expect(head(repo)).toBe(sha)
})

test('a pull that would need a merge refuses, and says so', async () => {
  const repo = makeTempRepo()
  const bare = makeBareRemote(repo)
  seedRemoteAhead(repo, bare)
  // Diverge locally: now neither side is an ancestor of the other.
  writeFileSync(join(repo, 'local-only.txt'), 'y\n')
  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'made here'], { stdio: 'pipe' })
  // This machine's git already refuses an unconfigured divergent pull on its
  // own ("Need to specify how to reconcile divergent branches"), which would
  // let this test pass even with --ff-only dropped — a false sense of
  // coverage confirmed by mutation-checking without this line. `pull.rebase
  // false` removes that incidental safety net and forces the exact case
  // --ff-only exists for: without it, this repo config makes git attempt (and
  // succeed at) a real merge commit instead of refusing.
  execFileSync('git', ['-C', repo, 'config', 'pull.rebase', 'false'], { stdio: 'pipe' })
  const before = head(repo)

  await expect(pullFastForward(repo, 'origin')).rejects.toThrow(RemoteError)
  // Refuses cleanly rather than stopping in a conflicted state — the reason
  // --ff-only was chosen, since conflict resolution is out of scope.
  expect(head(repo)).toBe(before)
  expect(
    execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
  ).toBe('')
})

test('a fast-forward pull leaves every existing commit reachable', async () => {
  const repo = makeTempRepo()
  const bare = makeBareRemote(repo)
  const original = head(repo)
  const { sha } = seedRemoteAhead(repo, bare)

  await pullFastForward(repo, 'origin')

  // Asserted FIRST, and load-bearing. `seedRemoteAhead` does not move this
  // repo's HEAD, so without this line `original === head(repo)` on entry and
  // `merge-base --is-ancestor X X` exits 0 — a `pullFastForward` that did
  // nothing at all passed the ancestry check below.
  expect(head(repo)).toBe(sha)
  // This is why pull needs no checkpoint repair: a fast-forward only advances
  // a ref along existing history, so every recorded checkpointRef stays
  // reachable. `rewritesHistory` is correctly false.
  execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', original, 'HEAD'], {
    stdio: 'pipe',
  })
})

function remoteHead(bare: string, branch: string): string {
  return execFileSync('git', ['-C', bare, 'rev-parse', branch], { encoding: 'utf8' }).trim()
}

test('push moves the ref on the remote', async () => {
  const repo = makeTempRepo()
  const bare = makeBareRemote(repo)

  await pushBranch(repo, 'origin', 'master', false)

  expect(remoteHead(bare, 'master')).toBe(head(repo))
})

test('setUpstream records the tracking branch; without it none is set', async () => {
  const repo = makeTempRepo()
  makeBareRemote(repo)

  await pushBranch(repo, 'origin', 'master', false)
  const withoutUpstream = execFileSync(
    'git',
    ['-C', repo, 'for-each-ref', '--format=%(upstream:short)', 'refs/heads/master'],
    { encoding: 'utf8' },
  ).trim()
  // Asserted before the second push: without this the closing assertion
  // holds against an implementation that always sets an upstream.
  expect(withoutUpstream).toBe('')

  await pushBranch(repo, 'origin', 'master', true)
  const upstream = execFileSync(
    'git',
    ['-C', repo, 'for-each-ref', '--format=%(upstream:short)', 'refs/heads/master'],
    { encoding: 'utf8' },
  ).trim()
  expect(upstream).toBe('origin/master')
})

test('a push that would not fast-forward the remote is refused, not forced', async () => {
  const repo = makeTempRepo()
  const bare = makeBareRemote(repo)
  const { clone } = seedRemoteAhead(repo, bare)
  const remoteBefore = remoteHead(bare, 'master')

  // Diverge locally from what the remote now holds.
  writeFileSync(join(repo, 'local-only.txt'), 'y\n')
  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'pipe' })
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'made here'], { stdio: 'pipe' })

  await expect(pushBranch(repo, 'origin', 'master', false)).rejects.toThrow(RemoteError)
  // The remote is untouched. Nothing in this pass may overwrite history on a
  // machine VADD does not control — force push is out of scope entirely.
  expect(remoteHead(bare, 'master')).toBe(remoteBefore)
  expect(clone).toBeTruthy()
})

test('a credential embedded in a remote url is never put on the wire', async () => {
  const repo = makeTempRepo()
  execFileSync(
    'git',
    ['-C', repo, 'remote', 'add', 'creds', 'https://alice:ghp_secret@github.com/me/x.git'],
    { stdio: 'pipe' },
  )
  const [remote] = await listRemotes(repo)
  // Host and path stay, because they are what makes the value readable at
  // all; only the userinfo goes. Asserted both ways round so the test cannot
  // pass by returning some other redacted-looking string.
  expect(remote?.fetchUrl).toBe('https://***@github.com/me/x.git')
  expect(remote?.pushUrl).toBe('https://***@github.com/me/x.git')
  expect(remote?.fetchUrl).not.toContain('ghp_secret')
})

test('an scp-style remote comes back byte-identical', async () => {
  const repo = makeTempRepo()
  // The regression guard. `git@github.com:me/x.git` carries an `@` and NO
  // credential — it is the ordinary ssh form — so a redaction that strips
  // everything before an `@` turns every ssh remote in the console into
  // nonsense.
  const url = 'git@github.com:me/x.git'
  execFileSync('git', ['-C', repo, 'remote', 'add', 'ssh', url], { stdio: 'pipe' })
  expect((await listRemotes(repo))[0]?.fetchUrl).toBe(url)
})

test('a local-path remote comes back byte-identical', async () => {
  const repo = makeTempRepo()
  const bare = makeBareRemote(repo)
  const [remote] = await listRemotes(repo)
  expect(remote?.fetchUrl).toBe(bare)
  expect(remote?.pushUrl).toBe(bare)
})

test('an unencoded @ inside a password does not escape redaction', async () => {
  const repo = makeTempRepo()
  // Defence in depth, not a live leak: git 2.43 rejects this url outright
  // ("URL rejected: Bad hostname"), measured — `git remote add` stores it
  // happily, but no fetch could ever use it. The greedy class takes the last
  // `@` before the path, so nothing of the password survives.
  execFileSync('git', ['-C', repo, 'remote', 'add', 'creds', 'https://a:p@ssword@h/x.git'], {
    stdio: 'pipe',
  })
  const [remote] = await listRemotes(repo)
  expect(remote?.fetchUrl).toBe('https://***@h/x.git')
  expect(remote?.fetchUrl).not.toContain('ssword')
})

test('pullFastForward refuses a detached HEAD instead of pulling into it', async () => {
  const repo = makeTempRepo()
  makeBareRemote(repo)
  execFileSync('git', ['-C', repo, 'checkout', '-q', '--detach'], { stdio: 'pipe' })
  // `rev-parse --abbrev-ref HEAD` returns the literal string `HEAD` here, so
  // without the guard VADD would run `git pull --ff-only origin HEAD`.
  // Asserted on the message rather than the class: the class is local to
  // `remote.ts` and unexported on purpose, and what the route needs from it
  // is the status, which the route test pins.
  await expect(pullFastForward(repo, 'origin')).rejects.toThrow(/detached/i)
  await expect(pullFastForward(repo, 'origin')).rejects.toThrow(/check out a branch/i)
})

test('an option-shaped remote name is passed as a value, not executed as an option', async () => {
  const repo = makeTempRepo()
  // Measured on git 2.43.0, not assumed: `git remote add` accepts this name
  // (behind its own `--`) and `git remote` prints it back verbatim, so the
  // "validated against a real list" guard in `routes/git.ts` does NOT by
  // itself mean a name cannot be read as an option.
  const hostile = '--upload-pack=/bin/echo'
  execFileSync('git', ['-C', repo, 'remote', 'add', '--', hostile, '/nonexistent/nowhere.git'], {
    stdio: 'pipe',
  })
  expect((await listRemotes(repo)).map((r) => r.name)).toEqual([hostile])

  let message = ''
  try {
    await fetchRemote(repo, hostile)
    throw new Error('should have thrown')
  } catch (err) {
    expect(err).toBeInstanceOf(RemoteError)
    message = (err as RemoteError).message
  }
  // The discriminating pair. Without `--`, git parses the name as
  // `--upload-pack` and really runs `/bin/echo` as the transport, whose
  // output it then fails to read as protocol ("bad line length character").
  // With `--`, the name is a remote, its configured url is resolved, and the
  // failure is about that url instead. No network either way: the url is a
  // local path that does not exist.
  expect(message).toMatch(/does not appear to be a git repository/)
  expect(message).not.toMatch(/protocol error/)
})

test('a user own core.sshCommand survives, with BatchMode appended to it', async () => {
  const repo = makeTempRepo()
  const dir = mkdtempSync(join(tmpdir(), 'vadd-ssh-'))
  const log = join(dir, 'argv.log')
  const fakeSsh = join(dir, 'fake-ssh.sh')
  // Records the argv git hands it and fails. Never opens a socket, and
  // `example.invalid` is a reserved TLD that resolves nowhere — nothing in
  // this test can reach a network.
  writeFileSync(fakeSsh, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 1\n`, { mode: 0o755 })
  execFileSync('git', ['-C', repo, 'remote', 'add', 'sshr', 'git@example.invalid:me/x.git'], {
    stdio: 'pipe',
  })
  const identity = join(dir, 'id_test')
  execFileSync('git', ['-C', repo, 'config', 'core.sshCommand', `${fakeSsh} -i ${identity}`], {
    stdio: 'pipe',
  })

  // The runner's own environment must not decide this test's answer: git
  // reads GIT_SSH_COMMAND ahead of core.sshCommand, which is exactly the
  // precedence `userSshCommand` reproduces.
  const previous = process.env.GIT_SSH_COMMAND
  delete process.env.GIT_SSH_COMMAND
  try {
    await expect(fetchRemote(repo, 'sshr')).rejects.toThrow(RemoteError)
    const argv = readFileSync(log, 'utf8')
    // A fixed `GIT_SSH_COMMAND: 'ssh -o BatchMode=yes'` discards the user's
    // own ssh command wholesale — measured, the script below was never
    // invoked at all — and a user whose key lives behind `-i` then gets
    // `Permission denied (publickey)` reported by VADD as a 502 blaming the
    // remote. Design §4 and amendment A20 both promise the opposite.
    expect(argv).toContain(`-i ${identity}`)
    // And the batch-mode mitigation still binds: git shell-interprets the
    // value, so the appended option arrives as one more argument.
    expect(argv).toContain('-o BatchMode=yes')
  } finally {
    if (previous === undefined) delete process.env.GIT_SSH_COMMAND
    else process.env.GIT_SSH_COMMAND = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('cloneRepo', () => {
  it('clones a real local repository', async () => {
    const source = makeTempRepo()
    const dest = join(mkdtempSync(join(tmpdir(), 'vadd-clone-dest-')), 'cloned')
    await cloneRepo(source, dest)
    const head = execFileSync('git', ['-C', dest, 'rev-parse', 'HEAD']).toString().trim()
    expect(head).toHaveLength(40)
  })

  it('throws RemoteError on a nonexistent source', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'vadd-clone-dest-')), 'cloned')
    await expect(cloneRepo('/tmp/vadd-does-not-exist-source', dest)).rejects.toBeInstanceOf(
      RemoteError,
    )
  })

  it('a clone that outruns its timeout is killed and reports timedOut', async () => {
    const source = makeTempRepo()
    const bare = makeBareRemote(source)
    const scriptDir = mkdtempSync(join(tmpdir(), 'vadd-uploadpack-'))
    const script = join(scriptDir, 'slow-upload-pack.sh')
    writeFileSync(script, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 })
    const dest = join(mkdtempSync(join(tmpdir(), 'vadd-clone-dest-')), 'cloned')
    const started = Date.now()
    try {
      // `--no-local` forces git to go through the smart-transport upload-pack
      // path even for a local filesystem source; without it, git's own
      // hardlink-based local-clone optimization never spawns upload-pack at
      // all, and this test would pass for the wrong reason (finishing fast,
      // not timing out). Verify this empirically against the real git on
      // this machine — if `--no-local` isn't sufficient to force the
      // subprocess path, try prefixing `bare` with `file://` instead, same
      // reasoning CLAUDE.md's "Traps Pass C paid for" already documents for
      // the fetch case.
      await gitRemote(
        dirname(dest),
        ['clone', '--no-local', `--upload-pack=${script}`, bare, dest],
        1_000,
      )
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(RemoteError)
      expect((err as RemoteError).timedOut).toBe(true)
    } finally {
      rmSync(scriptDir, { recursive: true, force: true })
    }
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
