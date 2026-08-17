import { describe, expect, it } from 'vitest'
import { isProtectedPath, protectedPaths } from '../src/policies/protected-paths.js'

describe('isProtectedPath', () => {
  it('matches a prefix glob within one directory only', () => {
    const globs = ['backend/.env*']
    expect(isProtectedPath('backend/.env.testing', globs)).toBe(true)
    expect(isProtectedPath('backend/.env', globs)).toBe(true)
    // `*` does not cross a separator, so a deeper path is a different file.
    expect(isProtectedPath('backend/config/.env.testing', globs)).toBe(false)
    expect(isProtectedPath('frontend/.env', globs)).toBe(false)
    expect(isProtectedPath('backend/app/Collector.php', globs)).toBe(false)
  })

  it('matches a trailing double star against the directory and everything under it', () => {
    const globs = ['backend/vendor/**']
    expect(isProtectedPath('backend/vendor/autoload.php', globs)).toBe(true)
    expect(isProtectedPath('backend/vendor/a/b/c.php', globs)).toBe(true)
    expect(isProtectedPath('backend/vendor', globs)).toBe(true)
    expect(isProtectedPath('backend/vendored.php', globs)).toBe(false)
  })

  it('matches a leading double star against zero segments as well as many', () => {
    const globs = ['**/migrations/**']
    expect(isProtectedPath('migrations/0001.sql', globs)).toBe(true)
    expect(isProtectedPath('backend/database/migrations/0001.sql', globs)).toBe(true)
    expect(isProtectedPath('database/migrations', globs)).toBe(true)
    expect(isProtectedPath('backend/database/migrationsx/0001.sql', globs)).toBe(false)
  })

  it('treats regex metacharacters in a glob as literals', () => {
    expect(isProtectedPath('a.b.c', ['a.b.c'])).toBe(true)
    expect(isProtectedPath('axbxc', ['a.b.c'])).toBe(false)
    expect(isProtectedPath('src/(x)/f.ts', ['src/(x)/*.ts'])).toBe(true)
  })

  it('protects nothing when the list is empty', () => {
    expect(isProtectedPath('backend/.env', [])).toBe(false)
    expect(protectedPaths(['backend/.env', 'a.ts'], [])).toEqual([])
  })

  it('filters a path list in order', () => {
    expect(
      protectedPaths(
        ['a.ts', 'backend/.env.testing', 'b.ts', 'backend/vendor/x.php'],
        ['backend/.env*', 'backend/vendor/**'],
      ),
    ).toEqual(['backend/.env.testing', 'backend/vendor/x.php'])
  })
})
