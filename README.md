# VADD

VADD is a localhost web app that wraps an existing coding agent — Claude Code or Codex, over
the Agent Client Protocol (ACP) — as a **comprehension and verification layer**. It is not an
orchestrator and not an agent of its own. Two ideas drive almost every design decision: you
should be able to read 10× less than a raw agent transcript and still know what happened, and
"done" should mean a real evidence set was checked, not that the agent claimed to be finished.

- **Structured, not streamed.** The agent emits typed events (decisions, plans, evidence,
  clarifications) inside its normal output; VADD validates them and shows cards, not logs.
- **Proven, not claimed.** An objective only reaches `done` when every required verification
  command has a green result and every acceptance check is satisfied — enforced by the state
  machine, not the UI.
- **Isolated by default.** Every objective works in its own git worktree and branch. Nothing
  touches your checkout until you choose to integrate.
- **Local and silent.** No telemetry, no outbound network calls of its own. State lives in
  `~/.vadd/`.

## Install

```sh
npx @vadd/cli
```

This starts a local server on `http://127.0.0.1:4319/` and opens it in your browser.

### Prerequisites

- Node.js 22 or newer.
- One of the supported agents, already installed and logged in on this machine:
  - **Claude Code** — VADD reuses the credentials your `claude` login created.
  - **Codex CLI** — VADD reuses the credentials your `codex login` created.

VADD ships no model access and never asks for an API key of its own. The one optional
network feature — a Haiku-based fallback that recovers malformed agent events — uses a key you
supply and is off until you do (see [Configuration](docs/configuration.md)).

## First run

1. **Add a project** — point VADD at a local git repository, or clone one by URL, and pick
   which agent drives it.
2. **Create an objective** — describe a bug or feature in plain language and choose a mode:
   *standard* (explore → decide → plan → execute per task → verify → integrate), *Fast Fix*
   (a shorter path for small, low-risk changes) or *Investigation* (read-only, ends in a
   report rather than a commit).
3. **Watch the Focus View** — VADD shows what the agent decided, what it changed and what
   evidence it produced, with the raw transcript one click away when you want it.
4. **Review and approve** — decisions, plans and per-task diffs surface for your review. Low
   Energy Mode lets low-risk steps auto-approve under the policy you configured.
5. **Integrate** — commit the squashed branch, keep it for later, or discard it. The worktree
   is released either way.

## Configuration

Verification is per repository, in an optional `.vadd/config.json`; when it is absent VADD
detects `test`/`lint`/`build` scripts from `package.json`, `composer.json`, a `Makefile`,
`go.mod` or `Cargo.toml`, at the root and one directory down. Runtime settings are a handful
of environment variables (`VADD_HOME`, `VADD_PORT`). Prompt templates can be overridden per
machine. All of it is documented in [docs/configuration.md](docs/configuration.md).

## Security review

VADD doesn't ship a security scanner or an OWASP checklist by default — but its verification
step already supports both, with no VADD update required. Add a real dependency-vulnerability
scan as a command, and an OWASP-style checklist as a check the agent must explicitly address
before an objective can reach `done`:

```json
{
  "verify": {
    "commands": [
      { "id": "audit", "run": "pnpm audit --audit-level=high", "required": true }
    ],
    "checks": [
      "OWASP checklist reviewed: injection, broken auth, sensitive data exposure, access control — no obvious issues found in this change"
    ]
  }
}
```

The audit command runs for real and its evidence is classified as `kind: "security"` in
the Evidence Panel; the checklist item is satisfied by the agent's own attestation, the
same way any other check is — a claim, not proof, since no tool can catch every class of
issue a checklist names.

## Privacy

Zero telemetry, zero outbound network calls of VADD's own. The only network traffic is your
agent talking to its provider, git talking to remotes *you* configured or typed in, and the
optional summarizer if you gave it a key. A static check in the test suite pins that exactly
one server module may issue a network-capable git command, and the server itself makes no
HTTP requests unless the summarizer key is set.

## Development

```sh
pnpm install
pnpm dev          # server on 127.0.0.1:4319, Vite on 127.0.0.1:5319
pnpm test         # Vitest, both projects (node + web)
pnpm typecheck
pnpm lint
```

The repository is a pnpm monorepo: `packages/core` (domain: schemas, workflow machine,
policies — no I/O), `packages/server` (Fastify, SQLite via Drizzle, git, the ACP adapters),
`packages/web` (Vite + React) and `packages/cli` (bundles the three into the published
`@vadd/cli`). See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, the testing rules and
how design changes are recorded, and [docs/releasing.md](docs/releasing.md) for how the
package is built, smoke-tested and published.

## Learn more

- [`vadd-spec-final.md`](./vadd-spec-final.md) — the binding v1 specification: every locked
  decision, the output contract, the workflow machine, and the amendments made since.
- [`docs/superpowers/`](./docs/superpowers/) — the design notes, implementation plans and
  verification records for every pass, in date order. `notes/status-ledger.md` is the
  running status.
- [`evals/`](./evals/) — the recorded agent transcripts and human labels behind `pnpm eval`.

## License

Apache-2.0. See [LICENSE](LICENSE).
