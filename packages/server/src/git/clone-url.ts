const ALLOWED_SCHEMES = ['https:', 'http:', 'ssh:', 'git:']

/**
 * Accepts a normal URL with an allowed scheme, or git's scp-like short form
 * (`user@host:path`, no scheme). Rejects `file://` (arbitrary local-path
 * access disguised as a clone), any scheme not listed above (`ext::` among
 * them — a documented git remote-helper RCE vector), and anything starting
 * with `-` (option injection, the same defense `knownRemote` already uses
 * for remote names in `packages/server/src/http/routes/git.ts`).
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
    return { ok: true, url: input }
  } catch {
    if (/^[\w.-]+@[\w.-]+:.+/.test(input)) {
      return { ok: true, url: input }
    }
    return { ok: false, reason: 'not a recognized git URL' }
  }
}
