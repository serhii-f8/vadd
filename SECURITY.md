# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use the repository's private
vulnerability reporting (the "Security" tab) if it is enabled, or contact the maintainer
directly through the profile linked from the repository. Include a reproduction and the
`@vadd/cli` version you are running. You will get an acknowledgement, and a fix or an
explanation before any public disclosure.

## Threat model

VADD is a **localhost, single-user** tool. Knowing what it does and does not defend against
helps decide what counts as a vulnerability.

- **The server binds to `127.0.0.1` and has no authentication**, by design (spec §7). Anyone
  who can reach that loopback port is treated as the user. Exposing the port beyond the
  machine — through a reverse proxy, a container port mapping, or a tunnel — is unsupported
  and unsafe.
- **The agent runs with the user's own permissions**, inside a git worktree under `~/.vadd/`.
  VADD constrains *what it will approve* (a path predicate keyed to the worktree, a command
  policy, protected globs on every commit-creating path) but it is not a sandbox: the agent
  is a child process of the user, not of a container.
- **Credentials are never stored by VADD.** The Claude Code adapter runs under an isolated
  profile directory into which the user's existing credentials file is copied; the Codex
  adapter does the same with its auth file. Git remote operations inherit the user's own git
  credential setup. The one secret VADD does keep — the optional summarizer API key — is
  stored in the local SQLite database and never echoed back by the API.
- **No outbound network of VADD's own.** Network-capable git subcommands are confined to one
  module and only ever target a remote the user configured or a URL the user typed into the
  clone dialog; that URL is validated (scheme allow-list, no `file://`, no option-injection
  through a leading `-`) before it reaches git.

Reports about any of the following are welcome and in scope: path or command policy bypass
that lets the agent act outside its worktree; a way to make the server issue a request the
user did not initiate; a way to read the summarizer key back; a git argument-injection through
any user-supplied string; and dependency advisories that reach a code path VADD actually uses.
