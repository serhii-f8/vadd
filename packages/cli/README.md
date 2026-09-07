# @vadd/cli

`@vadd/cli` is the installable package for VADD, a localhost comprehension and verification
layer that wraps an existing coding agent (Claude Code or Codex) over the Agent Client
Protocol.

## Usage

```sh
npx @vadd/cli
```

This starts a local server on `http://127.0.0.1:4319/` and opens it in your browser. All
state stays on your machine under `~/.vadd/`. Set `VADD_PORT` to use another port and
`VADD_HOME` to use another state directory.

## Prerequisites

- Node.js 22 or newer.
- A working, logged-in Claude Code installation, or a logged-in Codex CLI. VADD drives the
  agent you already have; it ships no model access of its own.

See the main VADD README for first-run instructions, configuration, and the project's
privacy guarantees.
