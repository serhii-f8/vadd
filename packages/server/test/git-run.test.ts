import { expect, test } from 'vitest'
import { GitError, git, gitChecked } from '../src/git/run.js'
import { makeTempRepo } from './fixtures/temp-repo.js'

test('git returns trimmed stdout', async () => {
  const repo = makeTempRepo()
  expect(await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toMatch(/^\S+$/)
})

test('gitChecked wraps a failure in GitError naming the command', async () => {
  const repo = makeTempRepo()
  await expect(gitChecked(repo, ['rev-parse', 'refs/heads/no-such-branch'])).rejects.toBeInstanceOf(
    GitError,
  )
  // The command is in the message: a bare execa error names the binary and
  // nothing about which of the dozen git calls in a request actually failed.
  await expect(gitChecked(repo, ['rev-parse', 'refs/heads/no-such-branch'])).rejects.toThrow(
    /rev-parse/,
  )
})

test('git does not wrap, so callers that want the raw error still get one', async () => {
  const repo = makeTempRepo()
  await expect(git(repo, ['rev-parse', 'refs/heads/no-such-branch'])).rejects.not.toBeInstanceOf(
    GitError,
  )
})
