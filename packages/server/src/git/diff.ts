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

async function git(cwd: string, args: string[]): Promise<string> {
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

/**
 * Spec §7's "stats + file list", spanning committed work and the working tree.
 *
 * Both halves are reported because a user reviewing an objective mid-execution
 * has uncommitted changes by definition — checkpoints are made on entry to
 * `executing`, not on exit — and a list that showed only committed work would
 * be silently missing the task in progress.
 */
export async function objectiveDiff(worktreePath: string, baseSha: string): Promise<DiffSummary> {
  const committed = parseNumstat(await git(worktreePath, ['diff', '--numstat', `${baseSha}..HEAD`]))
  const unstaged = parseNumstat(await git(worktreePath, ['diff', '--numstat', 'HEAD']))
  const untracked = (await git(worktreePath, ['ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .filter((p) => p.trim() !== '')

  const merged = new Map<string, DiffFile>()
  for (const [path, counts] of committed) {
    merged.set(path, { path, ...counts, committed: true, dirty: false })
  }
  for (const [path, counts] of unstaged) {
    const prev = merged.get(path)
    merged.set(path, {
      path,
      added: (prev?.added ?? 0) + counts.added,
      removed: (prev?.removed ?? 0) + counts.removed,
      committed: prev?.committed ?? false,
      dirty: true,
    })
  }
  for (const path of untracked) {
    if (merged.has(path)) continue
    // An untracked file has no numstat. Counting its lines is the only way to
    // show a size, and a new file is exactly the case a reviewer most wants to
    // see the size of.
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
