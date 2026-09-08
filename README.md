<div align="center">

# VADD

**Your coding agent says it's done. VADD makes it prove it.**

A localhost dashboard that wraps Claude Code or Codex, turns their output into structured
decisions and evidence instead of a wall of text, and refuses to mark work finished until the
tests actually ran and passed.

[Quickstart](#quickstart) · [User guide](docs/user-guide.md) · [Specification](docs/spec.md) ·
[Configuration](docs/configuration.md)

</div>

![The VADD objective board](docs/images/board.png)

---

## The problem

An agent writes code in minutes. Checking it takes you an hour — scrolling a two-thousand-line
transcript for the one decision it made silently, the test it never ran, the "all tests pass"
that meant "the three I remembered to run".

You end up doing the one job you can't delegate — deciding whether to trust the work — with
the worst possible interface for it.

## What VADD does about it

**Structured, not streamed.** The agent emits typed events — decisions, plans, evidence,
clarifications — inside its normal output. VADD validates every one against a schema and
renders cards. Nothing is summarised by another model and nothing is silently dropped: a block
that fails to parse becomes a visible violation, never a gap.

**"Done" means proven.** An objective reaches `done` only when every required verification
command has a green result and every acceptance check is satisfied. That rule lives in the
state machine, not the UI — there is no button, route or flag that gets around it.

**Isolated by default.** Every objective works in its own git worktree and branch, with a
checkpoint commit before each task. Your checkout is untouched until you choose to integrate,
and rolling back one task is one click.

**Local and silent.** No telemetry. No outbound request of VADD's own. No API key of its own —
it drives the agent you already pay for, with the login you already have.

---

## Decisions you can actually make

![A decision card](docs/images/decision.png)

When the agent hits a real fork, it stops and asks — with pros, cons, effort, **how reversible
the choice is**, and **how each option would be verified**. Not a paragraph of prose you have
to reverse-engineer a question out of.

It can attach a comparison table, a code sketch or a diagram beside the question. All of it is
capped small, on purpose.

## Work you can watch without reading

![An objective mid-execution](docs/images/live.png)

Which task, how long, the agent's own last line, how much of the plan is verified. If the
agent goes quiet for a minute, VADD says so instead of showing you a spinner it can't explain.
The raw transcript is always one click away — and never the default.

## Evidence, separated from claims

![The evidence panel](docs/images/review.png)

VADD runs your verification commands **itself**. What the agent says about its own work is
shown as advisory and never counted. A checklist item you tick by hand stays labelled *ticked
by you*, forever, because a claim and a proof should never look alike.

Red evidence doesn't reach review at all: the objective stops and shows you the failure.

---

## Quickstart

```sh
npx @vadd/cli
```

Opens `http://127.0.0.1:4319/`.

**Requirements:** Node.js 22+, and Claude Code or the Codex CLI installed and logged in. VADD
reuses that login; it never asks for a key.

Then:

1. **Add a project** — a local repository, or clone one by URL, and pick which agent drives it.
2. **Create an objective** — describe a bug or feature in a sentence. Choose *Standard*,
   *Fast Fix* (short path for small changes; verification still runs) or *Investigation*
   (read-only, ends in a report).
3. **Answer what it asks** — a decision, a plan, a review. Low Energy Mode auto-approves
   low-risk steps under a policy you set.
4. **Integrate** — squash to one commit, keep the branch, or discard. The worktree is released
   either way.

The [user guide](docs/user-guide.md) walks through all of it screen by screen.

### Telling VADD what "proven" means

Optional, and the highest-value thing you can do per repository — a `.vadd/config.json`:

```json
{
  "verify": {
    "commands": [
      { "id": "test", "run": "pnpm test", "required": true },
      { "id": "lint", "run": "pnpm lint", "required": true, "allowWarn": true }
    ],
    "checks": ["Bug is reproduced by a test that failed before the fix and passes after it"]
  },
  "policy": { "protectedGlobs": ["**/migrations/**", ".env*"] }
}
```

Without it, VADD detects `test`/`lint`/`build` scripts itself — and says so explicitly rather
than treating "found nothing" as green. Full format in
[configuration](docs/configuration.md).

---

## Privacy

Zero telemetry. Zero outbound calls of VADD's own. The only network traffic is your agent
talking to its provider, git talking to remotes *you* configured or typed in, and an optional
event-recovery call to Anthropic that exists only if you supply your own key.

A static test pins that exactly one server module may issue a network-capable git command, and
every fetch, pull and push takes a remote *name* validated against your repository — no route
accepts a URL. Details in the [specification](docs/spec.md#11-security-privacy-and-network-posture).

## Documentation

| | |
|---|---|
| [User guide](docs/user-guide.md) | Every screen, from adding a project to integrating the work |
| [Specification](docs/spec.md) | Architecture, the output contract, the workflow machine, the locked decisions and every amendment |
| [Configuration](docs/configuration.md) | `.vadd/config.json`, environment variables, the state directory, prompt overrides |
| [Contributing](CONTRIBUTING.md) | Workflow, testing rules, how design changes are recorded |
| [Security](SECURITY.md) | Reporting a vulnerability |

## Development

```sh
pnpm install
pnpm dev          # server on 127.0.0.1:4319, Vite on 127.0.0.1:5319
pnpm test         # Vitest, both projects (node + web)
pnpm typecheck
pnpm lint
```

A pnpm monorepo: `packages/core` (domain — schemas, the workflow machine, policies; no I/O),
`packages/server` (Fastify, SQLite via Drizzle, git, the ACP adapters), `packages/web`
(Vite + React) and `packages/cli` (bundles the three into the published `@vadd/cli`).

## Status

VADD runs real objectives end to end today. One quality gate is deliberately still red: the
extraction gate (`pnpm eval`) scores 100% on decision extraction and 75% precision on evidence
extraction against a 90% bar, so it exits non-zero on purpose. What it is waiting on — an
independent re-labelling and a larger corpus — is described in
[the specification](docs/spec.md#12-quality-gates).

## License

Apache-2.0. See [LICENSE](LICENSE).
