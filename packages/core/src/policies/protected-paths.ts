/**
 * Spec §6's `policy.protectedGlobs`, given the one enforcement point it never
 * had: which repo-relative paths an `integrate: commit` refuses to carry.
 *
 * Until phase 6 this field was resolved, merged, persisted and read by nothing
 * at all — a boundary the design called "machine-enforced" that no machine
 * enforced. The exit run proved what that costs: amendment A1's `setup`
 * commands rewrote `backend/.env.testing` (a *tracked* file) to point the test
 * suite at host-exposed ports, every `vadd-checkpoint:` commit swept it up with
 * `git add -A`, and the final squash carried it onto the branch. Merging that
 * would have broken every other developer's Docker workflow.
 *
 * Matching is deliberately the small, predictable subset of glob syntax rather
 * than a dependency: a double star crosses separators, `*` and `?` do not, and
 * a leading double-star segment or a trailing one matches zero segments as well
 * as many — which is what makes a pattern like "any migrations directory,
 * anywhere" cover a top-level `migrations/0001.sql`. Anything else is a
 * literal. Paths are matched exactly as git prints them — repo-root relative,
 * forward slashes, no leading `./`.
 */
function globToRegExp(glob: string): RegExp {
  let out = ''
  let i = 0
  while (i < glob.length) {
    const rest = glob.slice(i)
    if (rest.startsWith('**/')) {
      // Zero or more leading segments, so a double-star prefix on `x` still
      // matches a bare `x`.
      out += '(?:.*/)?'
      i += 3
    } else if (rest === '/**') {
      // Trailing: the directory itself as well as everything under it.
      out += '(?:/.*)?'
      i += 3
    } else if (rest.startsWith('**')) {
      out += '.*'
      i += 2
    } else if (rest.startsWith('*')) {
      out += '[^/]*'
      i += 1
    } else if (rest.startsWith('?')) {
      out += '[^/]'
      i += 1
    } else {
      out += glob[i]?.replace(/[.+^${}()|[\]\\]/g, '\\$&') ?? ''
      i += 1
    }
  }
  return new RegExp(`^${out}$`)
}

/** True when `path` matches any of `globs`. An empty list protects nothing. */
export function isProtectedPath(path: string, globs: readonly string[]): boolean {
  const normalized = path.startsWith('./') ? path.slice(2) : path
  return globs.some((g) => globToRegExp(g).test(normalized))
}

/** The subset of `paths` that any glob protects, order preserved. */
export function protectedPaths(paths: readonly string[], globs: readonly string[]): string[] {
  if (globs.length === 0) return []
  return paths.filter((p) => isProtectedPath(p, globs))
}
