import { GitError, gitChecked } from './run.js'

export type BranchRow = { name: string; sha: string; isCurrent: boolean; upstream: string | null }

export type WorktreeRow = {
  path: string
  /** Null when the worktree has a detached HEAD. */
  branch: string | null
  head: string
  isMain: boolean
  locked: boolean
  prunable: boolean
}

export type CommitRow = {
  sha: string
  parents: string[]
  subject: string
  author: string
  /** ISO 8601, from %aI. */
  at: string
  /** Branch and tag names pointing at this commit. */
  refs: string[]
}

export type StatusCounts = { staged: number; unstaged: number; untracked: number }

/** Unit separator: between fields of one record. */
const US = '\x1f'
/** Record separator: between records. */
const RS = '\x1e'

export async function listBranches(repoPath: string): Promise<BranchRow[]> {
  const out = await gitChecked(repoPath, [
    'for-each-ref',
    `--format=%(refname:short)${US}%(objectname)${US}%(upstream:short)${US}%(HEAD)`,
    'refs/heads',
  ])
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name = '', sha = '', upstream = '', head = ''] = line.split(US)
      return {
        name,
        sha,
        upstream: upstream === '' ? null : upstream,
        // `%(HEAD)` is '*' for the branch checked out in the repository this
        // ran against — the main checkout — and ' ' otherwise. A branch that
        // is current in some *other* worktree is not marked here; that
        // binding comes from `listWorktreesDetailed`, which knows about all
        // of them.
        isCurrent: head === '*',
      }
    })
}

export async function listWorktreesDetailed(repoPath: string): Promise<WorktreeRow[]> {
  const out = await gitChecked(repoPath, ['worktree', 'list', '--porcelain'])
  const rows: WorktreeRow[] = []
  // Records are blank-line separated; the first record is always the main
  // checkout, which is how `isMain` is determined — there is no porcelain
  // attribute for it.
  for (const block of out.split('\n\n')) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (lines.length === 0) continue
    const path = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length) ?? ''
    if (path === '') continue
    const head = lines.find((l) => l.startsWith('HEAD '))?.slice('HEAD '.length) ?? ''
    const branchLine = lines.find((l) => l.startsWith('branch '))
    rows.push({
      path,
      branch: branchLine ? branchLine.slice('branch refs/heads/'.length) : null,
      head,
      isMain: rows.length === 0,
      // `locked` and `prunable` may appear bare or with a trailing reason.
      locked: lines.some((l) => l === 'locked' || l.startsWith('locked ')),
      prunable: lines.some((l) => l === 'prunable' || l.startsWith('prunable ')),
    })
  }
  return rows
}

/**
 * Bound on how far back `before` pagination will search for the cursor's
 * ordinal position within `tip`'s history. A UI paging 50 commits at a time
 * never realistically approaches this, so exceeding it means the cursor is
 * stale, from a different `ref`, or otherwise not `tip`'s own history — a
 * genuine caller bug, which should fail loudly rather than silently return
 * page 1 again.
 */
const CURSOR_SEARCH_LIMIT = 10_000

export async function readLog(
  repoPath: string,
  opts: { ref?: string; limit: number; before?: string },
): Promise<CommitRow[]> {
  const tip = opts.ref ?? 'HEAD'

  // A freshly `git init`ed repo with no commits has no HEAD target at all
  // (an "unborn" branch) — `validateRepo` only checks `rev-parse
  // --show-toplevel`, so this is reachable in production. `git log` on it
  // exits 128, which would otherwise surface as a throw here while
  // `listBranches`/`listWorktreesDetailed` both degrade gracefully on the
  // same input. Detect the no-commits case explicitly up front rather than
  // blanket-catching the log call below, so a genuine git failure there
  // still throws.
  try {
    await gitChecked(repoPath, ['rev-parse', '--verify', 'HEAD'])
  } catch {
    return []
  }

  const args = [
    'log',
    `--format=%H${US}%P${US}%s${US}%an${US}%aI${US}%D${RS}`,
    `--max-count=${opts.limit}`,
  ]
  // `before` is a cursor from a page already shown. `git log --skip=1 <sha>`
  // re-roots the walk at `<sha>` itself, so it only follows *that commit's*
  // ancestry — on a merge, a sibling branch reachable from `tip` via the
  // merge's other parent (and due to appear later in `tip`'s own ordering)
  // is silently dropped, since it is not an ancestor of the cursor. `<sha>^`
  // has the same problem plus failing outright on a root commit. The
  // correct continuation keeps walking `tip`, skipping past the cursor's
  // ordinal position in *that* walk — found with a bounded, shas-only pass.
  //
  // Accepted risk, not fixed: this is two sequential git calls, so a commit
  // landing on `tip` between the lookup below and the paged log above could
  // shift the index by one. Low risk for single-user localhost use.
  if (opts.before !== undefined) {
    const shas = (
      await gitChecked(repoPath, ['log', '--format=%H', `--max-count=${CURSOR_SEARCH_LIMIT}`, tip])
    )
      .split('\n')
      .filter((l) => l !== '')
    const idx = shas.indexOf(opts.before)
    if (idx === -1) {
      throw new GitError(
        `readLog: cursor ${opts.before} was not found in the first ${CURSOR_SEARCH_LIMIT} commits of ${tip}`,
        'EGIT',
      )
    }
    args.push(`--skip=${idx + 1}`, tip)
  } else {
    args.push(tip)
  }
  args.push('--')

  const out = await gitChecked(repoPath, args)
  return out
    .split(RS)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim() !== '')
    .map((record) => {
      const [sha = '', parents = '', subject = '', author = '', at = '', refs = ''] =
        record.split(US)
      return {
        sha,
        // A root commit's %P is empty; ''.split(' ') yields [''], which would
        // open a rail waiting for a commit that can never arrive.
        parents: parents === '' ? [] : parents.split(' '),
        subject,
        author,
        at,
        refs: refs === '' ? [] : refs.split(', ').map((r) => r.replace(/^HEAD -> /, '')),
      }
    })
}

export async function readStatus(worktreePath: string): Promise<StatusCounts> {
  // `-z` matters here specifically: a path can legally contain a newline.
  const out = await gitChecked(worktreePath, ['status', '--porcelain=v1', '-z'])
  const counts = { staged: 0, unstaged: 0, untracked: 0 }
  // Porcelain v1 -z records are NUL-terminated; a rename record is followed by
  // a second NUL-terminated path, which `skipNext` consumes.
  const entries = out.split('\0').filter((e) => e !== '')
  let skipNext = false
  for (const entry of entries) {
    if (skipNext) {
      skipNext = false
      continue
    }
    const x = entry[0] ?? ' '
    const y = entry[1] ?? ' '
    if (x === '?' && y === '?') {
      counts.untracked += 1
      continue
    }
    if (x === 'R' || x === 'C') skipNext = true
    if (x !== ' ' && x !== '?') counts.staged += 1
    if (y !== ' ' && y !== '?') counts.unstaged += 1
  }
  return counts
}
