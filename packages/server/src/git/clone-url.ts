import { isAbsolute } from 'node:path'

const ALLOWED_SCHEMES = ['https:', 'http:', 'ssh:', 'git:']

/**
 * Accepts a normal URL with an allowed scheme, git's scp-like short form
 * (`user@host:path`, no scheme), or a plain absolute local filesystem path.
 * Rejects `file://` (a URL-shaped disguise for the same local access a plain
 * path already gets — kept rejected for the transport-level ambiguity that
 * scheme carries, not because local access itself is the threat: this is a
 * no-auth localhost API, and `POST /api/projects` already registers any
 * local `repoPath` directly with no scheme restriction at all), any scheme
 * not listed above (`ext::` among them — a documented git remote-helper RCE
 * vector), and anything starting with `-` (option injection, the same
 * defense `knownRemote` already uses for remote names in
 * `packages/server/src/http/routes/git.ts` — this also covers a bare path,
 * since a real absolute path never starts with `-`). Also rejects usernames
 * and hostnames starting with `-` in both URL and scp-like forms
 * (CVE-2017-1000117: ssh option injection via user@host token).
 */
export function validateCloneUrl(
  input: string,
): { ok: true; url: string } | { ok: false; reason: string } {
  if (input.startsWith('-')) {
    return { ok: false, reason: 'URL may not start with -' }
  }
  try {
    const parsed = new URL(input)
    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
      return { ok: false, reason: `scheme ${parsed.protocol} is not allowed` }
    }
    // Reject if username or hostname starts with - (CVE-2017-1000117: ssh option injection)
    if (parsed.username?.startsWith('-')) {
      return { ok: false, reason: 'username may not start with -' }
    }
    if (parsed.hostname?.startsWith('-')) {
      return { ok: false, reason: 'hostname may not start with -' }
    }
    return { ok: true, url: input }
  } catch {
    // Check for scp-like short form: user@host:path
    const scpMatch = input.match(/^([\w.-]+)@([\w.-]+):(.+)$/)
    if (scpMatch?.[2]?.startsWith('-')) {
      return { ok: false, reason: 'hostname may not start with -' }
    }
    if (scpMatch) {
      return { ok: true, url: input }
    }
    if (isAbsolute(input)) {
      return { ok: true, url: input }
    }
    return { ok: false, reason: 'not a recognized git URL' }
  }
}
