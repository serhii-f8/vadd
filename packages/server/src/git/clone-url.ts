const ALLOWED_SCHEMES = ['https:', 'http:', 'ssh:', 'git:']

/**
 * Accepts a normal URL with an allowed scheme, or git's scp-like short form
 * (`user@host:path`, no scheme). Rejects `file://` (arbitrary local-path
 * access disguised as a clone), any scheme not listed above (`ext::` among
 * them — a documented git remote-helper RCE vector), and anything starting
 * with `-` (option injection, the same defense `knownRemote` already uses
 * for remote names in `packages/server/src/http/routes/git.ts`). Also rejects
 * usernames and hostnames starting with `-` in both URL and scp-like forms
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
    if (scpMatch && scpMatch[2]?.startsWith('-')) {
      return { ok: false, reason: 'hostname may not start with -' }
    }
    if (scpMatch) {
      return { ok: true, url: input }
    }
    return { ok: false, reason: 'not a recognized git URL' }
  }
}
