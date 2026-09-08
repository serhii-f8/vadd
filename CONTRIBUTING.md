# Contributing to VADD

Thanks for your interest. VADD is developed in the open, and the bar for a change is the
same for everyone: it is specified, tested, and its verification is recorded.

## Setup

```sh
git clone <this repository>
cd vadd
pnpm install
pnpm dev
```

Requires Node.js 22 or newer and pnpm 11. `pnpm dev` starts the Fastify server on
`127.0.0.1:4319` and Vite on `127.0.0.1:5319` (Vite proxies `/api` to the server). Open the
Vite URL while developing the UI; the server URL serves the last production build.

`pnpm dev` does not forward signals to its children. Stop it with Ctrl-C (which signals the
whole process group), never by killing the wrapper alone.

### Running against a real agent

The server spawns the agent adapter lazily and the child inherits the server's environment. If
you start VADD from inside a Claude Code session, that session's own variables block the
adapter from starting; prefix the command with the `env -u` list in `CLAUDE.md` ("Traps
Task 14 paid for"). Point `VADD_HOME` at a scratch directory and `VADD_PORT` at a spare port so
a development run never touches your real `~/.vadd`.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Vitest, both projects: `node` (`packages/{core,server,cli}/test`) and `web` (jsdom, `packages/web/test`) |
| `pnpm typecheck` | `tsc -b` over all four packages, `strict: true` everywhere |
| `pnpm lint` / `pnpm format` | Biome, the only lint and format tool |
| `pnpm eval` | Replays the recorded transcript corpus against the human labels. **Exits non-zero today by design** — see below |
| `pnpm schema:export` | Regenerates `prompts/claude-code/v1/agent-event.schema.json` from the Zod union. Never edit that file by hand |
| `pnpm --filter @vadd/server db:generate` | drizzle-kit migration. Hand-check the generated SQL; see the drizzle-kit traps in `CLAUDE.md` |
| `pnpm --filter @vadd/web build` | Real Vite build. The only check that catches bundle-only failures |
| `pnpm --filter @vadd/cli build` / `smoke` | Bundle the package; pack, install into a scratch prefix and drive it over HTTP |

A single file: `pnpm vitest run <path>`. A single test: add `-t "<name>"` — and read the
counts, because a name that matches nothing exits 0 with every test skipped.

The real-adapter end-to-end test is skipped unless `VADD_E2E=1` and needs a logged-in agent.
CI runs lint → typecheck → test → CLI build on every pull request, with `pnpm eval` reported
but non-blocking.

## The specification is binding

[`docs/spec.md`](docs/spec.md) records the locked product decisions (§2), the architecture,
and every amendment made to a locked decision so far (§13). A change that deviates from it —
a different framework, a different isolation model, telemetry, anything §1's non-goals name —
is made by **amending the spec in the same commit as the design that justifies it**,
following the numbered amendments already there. Do not implement the deviation first and
document it later.

`CLAUDE.md` is the working engineering guide: the standing constraints and a long list of
traps that each cost a real defect. Read the relevant section before touching the area it
describes.

## How work is done

1. **Design first.** A non-trivial change starts as a dated design note, and for multi-step
   work a dated plan, before any code is written.
2. **Test first.** Write the failing test, watch it fail for the right reason, then make it
   pass. A test that was never seen red proves nothing.
3. **Verify for real.** Unit tests are the floor, not the ceiling. UI changes are opened in a
   browser — `scripts/browser-shot.mjs` drives a headless Chrome over the DevTools Protocol
   with no extra dependency, always against a scratch `VADD_HOME` and a scratch port. Server
   changes the suite drives only through `app.inject` are exercised against a running server.
   Record what was verified, including what was *not* proven.
4. **Claim only what you ran.** A change is done when a command was run and its output seen,
   never from intent.

## Layering rules

- `packages/core` is domain only: schemas, the workflow machine, policies. No I/O, no
  `node:` imports on any path a browser can reach (a test walks the import graph to enforce
  this).
- All agent communication goes behind `AgentPort`; the ACP SDK and the adapter child process
  never leak past it.
- The server is Fastify + SSE, localhost only, no auth. The frontend mirrors server snapshots
  and performs no client-side state transitions.
- Git is driven through `execa` directly. Only `packages/server/src/git/remote.ts` may issue
  a network-capable git subcommand.
- Zero telemetry and zero outbound network calls of VADD's own. The optional summarizer uses
  the user's key and is off by default.

## The eval gate

`evals/transcripts/` holds real recorded agent sessions and `evals/labels/` the human-authored
ground truth for what should have surfaced in each. `pnpm eval` scores the contract pipeline
against those labels and currently fails its 90% bar on `evidence` precision. That failure is
the harness working. Do not relax the bar, re-scope the metric, or edit a label file to close
the gap; labels are authored by a human from blind transcripts. Keep transcripts and labels
in exact name correspondence, because the harness refuses an orphan of either kind.

## Commits and pull requests

- One logical change per commit, with a message that says what and why. Conventional
  prefixes (`feat`, `fix`, `docs`, `refactor`, `test`) are used but not enforced.
- Keep the tree clean at every commit: lint, typecheck and tests green.
- A pull request describes what was verified and how, not just what was changed.

## Reporting problems

Open an issue with the smallest reproduction you can. For anything security-related, see
[SECURITY.md](SECURITY.md).
