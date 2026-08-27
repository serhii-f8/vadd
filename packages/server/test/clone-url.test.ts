import { describe, expect, it } from 'vitest'
import { validateCloneUrl } from '../src/git/clone-url.js'

describe('validateCloneUrl', () => {
  it('accepts https URLs', () => {
    expect(validateCloneUrl('https://github.com/user/repo.git')).toEqual({
      ok: true,
      url: 'https://github.com/user/repo.git',
    })
  })

  it('accepts ssh URLs', () => {
    expect(validateCloneUrl('ssh://git@example.com/repo.git').ok).toBe(true)
  })

  it('accepts the scp-like short form', () => {
    expect(validateCloneUrl('git@github.com:user/repo.git')).toEqual({
      ok: true,
      url: 'git@github.com:user/repo.git',
    })
  })

  it('rejects file:// URLs', () => {
    const result = validateCloneUrl('file:///etc/passwd')
    expect(result.ok).toBe(false)
  })

  it('accepts a plain absolute local filesystem path', () => {
    expect(validateCloneUrl('/tmp/vadd-repo-abc123')).toEqual({
      ok: true,
      url: '/tmp/vadd-repo-abc123',
    })
  })

  it('rejects a relative path', () => {
    expect(validateCloneUrl('relative/path').ok).toBe(false)
  })

  it('rejects ext:: transport strings', () => {
    expect(validateCloneUrl('ext::sh -c "touch /tmp/pwned"').ok).toBe(false)
  })

  it('rejects a value starting with -', () => {
    expect(validateCloneUrl('--upload-pack=/bin/sh').ok).toBe(false)
  })

  it('rejects plain garbage', () => {
    expect(validateCloneUrl('not a url at all').ok).toBe(false)
  })

  it('rejects ssh URLs with a dash-prefixed hostname (CVE-2017-1000117 shape)', () => {
    expect(validateCloneUrl('ssh://-oProxyCommand=id/repo.git').ok).toBe(false)
  })

  it('rejects scp-like form with a dash-prefixed hostname (CVE-2017-1000117 shape)', () => {
    expect(validateCloneUrl('user@-evilhost:repo.git').ok).toBe(false)
  })

  it('rejects ssh URLs with a dash-prefixed username (CVE-2017-1000117 shape)', () => {
    expect(validateCloneUrl('ssh://-oProxyCommand=id@host/repo.git').ok).toBe(false)
  })
})
