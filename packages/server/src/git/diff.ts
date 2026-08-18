import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execa } from 'execa'

export type DiffFile = {
  path: string
  added: number
  removed: number
  /** Present in a commit on the objective branch. */
  committed: boolean
  /** Modified in the working tree, or untracked. */
  dirty: boolean
}

export type DiffSummary = {
  files: DiffFile[]
  totals: { files: number; added: number; removed: number }
}

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', ['-C', cwd, ...args])
  return stdout
}

/**
 * `--numstat` emits `<added>\t<removed>\t<path>`, with `-` for both counts on a
 * binary file. A binary file is reported as 0/0 rather than dropped: the panel
 * has to show that it changed even though it cannot show how.
 */
function parseNumstat(out: string): Map<string, { added: number; removed: number }> {
  const files = new Map<string, { added: number; removed: number }>()
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue
    const [a, r, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (!path) continue
    files.set(path, {
      added: a === '-' ? 0 : Number.parseInt(a ?? '0', 10) || 0,
      removed: r === '-' ? 0 : Number.parseInt(r ?? '0', 10) || 0,
    })
  }
  return files
}

/** The paths `git diff --name-only <range>` reports as touched. */
async function nameOnly(worktreePath: string, ...range: string[]): Promise<Set<string>> {
  const out = await git(worktreePath, ['diff', '--name-only', ...range])
  return new Set(out.split('\n').filter((p) => p.trim() !== ''))
}

/**
 * Spec §7's "stats + file list", spanning committed work and the working tree.
 *
 * Both halves are reported because a user reviewing an objective mid-execution
 * has uncommitted changes by definition — checkpoints are made on entry to
 * `executing`, not on exit — and a list that showed only committed work would
 * be silently missing the task in progress.
 *
 * Counts come from a single `git diff --numstat <baseSha>` — base commit
 * straight to the working tree, no `..HEAD` — rather than summing a
 * `baseSha..HEAD` segment with a `HEAD`-vs-worktree segment. Summing double
 * counts any line touched by both: a checkpoint commit that adds a line the
 * working tree later removes reports it as both an addition and a removal,
 * when the true base→worktree diff shows nothing for it at all. This is also
 * the same query `objectiveFileDiff` runs per-file, so the summary and the
 * per-file diff cannot disagree. The `committed`/`dirty` flags are set from
 * two cheap `--name-only` queries instead, which only need membership, not
 * counts.
 */
export async function objectiveDiff(worktreePath: string, baseSha: string): Promise<DiffSummary> {
  const net = parseNumstat(await git(worktreePath, ['diff', '--numstat', baseSha]))
  const committedPaths = await nameOnly(worktreePath, `${baseSha}..HEAD`)
  const dirtyPaths = await nameOnly(worktreePath, 'HEAD')
  const untracked = (await git(worktreePath, ['ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .filter((p) => p.trim() !== '')

  const merged = new Map<string, DiffFile>()
  for (const [path, counts] of net) {
    merged.set(path, {
      path,
      ...counts,
      committed: committedPaths.has(path),
      dirty: dirtyPaths.has(path),
    })
  }
  for (const path of untracked) {
    if (merged.has(path)) continue
    // An untracked file has no numstat — it never appears in a `git diff`
    // against anything. Counting its lines is the only way to show a size,
    // and a new file is exactly the case a reviewer most wants to see the
    // size of.
    const added = await countLines(worktreePath, path)
    merged.set(path, { path, added, removed: 0, committed: false, dirty: true })
  }

  const files = [...merged.values()].sort((a, b) => a.path.localeCompare(b.path))
  return {
    files,
    totals: {
      files: files.length,
      added: files.reduce((n, f) => n + f.added, 0),
      removed: files.reduce((n, f) => n + f.removed, 0),
    },
  }
}

async function countLines(worktreePath: string, path: string): Promise<number> {
  try {
    const text = await readFile(join(worktreePath, path), 'utf8')
    if (text === '') return 0
    return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
  } catch {
    // Unreadable (a symlink to nowhere, a permissions problem). Zero is the
    // honest count; the file still appears in the list.
    return 0
  }
}

/**
 * The unified diff for one path, spanning committed and working-tree changes.
 *
 * `--` separates the pathspec from revisions so a file named like a ref cannot
 * be reinterpreted as one. The caller has already checked the path against the
 * file list, so nothing arbitrary reaches this.
 */
export async function objectiveFileDiff(
  worktreePath: string,
  baseSha: string,
  path: string,
): Promise<string> {
  const tracked = await git(worktreePath, ['diff', baseSha, '--', path])
  if (tracked.trim() !== '') return tracked
  // Untracked: `git diff` ignores it entirely, so ask for it explicitly.
  const { stdout } = await execa(
    'git',
    ['-C', worktreePath, 'diff', '--no-index', '--', '/dev/null', path],
    { reject: false },
  )
  return stdout
}
