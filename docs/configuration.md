# Configuration

VADD has three configuration surfaces: a per-repository verification file, a few environment
variables for the server, and per-machine overrides under `~/.vadd/`. Nothing else is read.

## `.vadd/config.json` — verification, per repository

Committed to the repository VADD works on (not to VADD itself). It says how an objective's
work is verified and what the agent may not touch. Every field is optional; when the file is
absent VADD auto-detects commands instead (below).

```json
{
  "verify": {
    "setup": [
      { "id": "deps", "run": "composer install", "cwd": "backend" }
    ],
    "commands": [
      { "id": "test", "run": "pnpm test", "required": true },
      { "id": "lint", "run": "pnpm lint", "required": true, "allowWarn": true },
      { "id": "build", "run": "pnpm build", "required": false, "cwd": "frontend" }
    ],
    "checks": [
      "Bug is reproduced by a new failing-then-passing test"
    ],
    "timeoutSec": 600
  },
  "policy": {
    "protectedGlobs": ["**/migrations/**", "backend/.env*"],
    "maxFastFixLines": 150
  }
}
```

| Field | Meaning |
|---|---|
| `verify.setup[]` | Commands run **once per worktree**, at creation, for repositories whose dependencies are not tracked (`npm ci`, `composer install`, `cp .env.example .env`). A failing setup blocks the objective with a visible evidence row. |
| `verify.commands[]` | Commands VADD runs itself at each verification. `id` (≤40 chars) names the evidence row; `required: true` means the objective cannot reach `done` without a passing result; exit 0 with warnings in the output is recorded as `warn`, and `allowWarn: true` lets a `warn` satisfy a required command; `cwd` is relative to the worktree root and defaults to `.`. |
| `verify.checks[]` | Acceptance checklist items (≤300 chars each). Satisfied by the agent explicitly attesting to the item in an `evidence` event, or by you ticking it in the Evidence Panel. A claim, not proof. |
| `verify.timeoutSec` | Per-command timeout, default 600, maximum 3600. VADD kills the whole process group on timeout, not just the shell. |
| `policy.protectedGlobs` | Paths the agent's work may never carry into a commit. Enforced on every commit-creating path (the integrate squash and the git console alike); an excluded path is named in the objective's events rather than silently dropped. |
| `policy.maxFastFixLines` | The line bound the risk policy uses when it classifies a change as low-risk; low-risk tasks and simple Fast Fix plans are what Low Energy Mode may auto-approve. Default 150. Migrations, `.sql` files, lockfiles and dependency manifests always count as high-risk regardless of this setting. |

Commands run at the command's `cwd` inside the objective's worktree, with the agent's own
edits in place, via a plain shell. They inherit the server's environment.

### Auto-detection

When no `.vadd/config.json` exists, VADD looks — at the repository root and in every
immediate subdirectory — for, in order: `package.json` scripts (`test`, `lint`, `build`),
`composer.json`, a `Makefile`, `go.mod` (`go test ./...`) and `Cargo.toml`. The result is
shown when you create an objective, for confirmation or editing. Detecting nothing is an
explicit outcome, never an empty and therefore trivially green command set.

### Per-objective overrides

`POST /api/projects/:id/objectives` accepts a `verificationOverrides` object with the same
shape, every field optional. Whatever it carries is stored with that objective and wins field
by field over the file and over detection. The creation dialog does not expose this yet; the
resolved spec is shown on the objective once it exists.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `VADD_HOME` | `~/.vadd` | The state directory (below). Set it to a scratch path to run a second, isolated instance. |
| `VADD_PORT` | `4319` | The port the server binds on `127.0.0.1`. |
| `VADD_MIGRATIONS_DIR`, `VADD_PROMPTS_DIR`, `VADD_WEB_DIST` | set by the packaged binary | Where the bundled migrations, prompt templates and web build live. Only relevant when running from a source checkout in an unusual layout. |

There is no configuration file for the server itself.

## The state directory `~/.vadd/`

```
~/.vadd/
  vadd.db                      SQLite database: projects, objectives, events, evidence, memory…
  worktrees/<project>/<objective>/   one git worktree per objective, released on integrate/discard
  artifacts/<objective>/<run>/       captured command output per verification run
  prompts/                     your prompt template overrides (optional)
  agent-profiles/              isolated agent profile directories: an empty settings file, VADD's own
                               instructions, and a copy of your existing credentials
```

Deleting the directory resets VADD completely. Worktrees are registered with their
repositories, so remove them through VADD (or `git worktree prune` in the repository) rather
than with `rm` alone.

## Agents

Each project chooses which agent drives its objectives: **Claude Code** (default) or
**Codex**. Both are spawned as ACP child processes from the exact adapter versions VADD pins;
both run under an isolated profile directory so that third-party skills or plugins in your
real profile cannot leak into VADD's sessions. Your existing login is copied into that profile
so no separate authentication is needed.

The Claude Code adapter refuses to start if it inherits a Claude Code session's own
environment variables; if you launch VADD from inside a Claude Code terminal, start it with
those variables unset (the list is in `CLAUDE.md`).

## Prompt templates

The templates that ask the agent for structured events live in `prompts/claude-code/v1/` and
are shipped inside the package. To override one on your machine, copy it to
`~/.vadd/prompts/<name>.md` and edit; each file is resolved independently, so overriding
`plan.md` leaves every other template at its bundled default. Front-matter declares which
event types the template expects and permits, and the bundled templates are subject to a
reading-budget test — keep an override within the same limits or the events it solicits may
be rejected as violations.

## The summarizer (optional)

When an agent emits a block that does not parse, VADD can send the raw text to a small Claude
model once to try to recover the event. This is the only outbound request VADD ever makes and
it is off until you supply your own Anthropic API key:

```sh
curl -X PUT http://127.0.0.1:4319/api/settings \
  -H 'content-type: application/json' \
  -d '{"summarizerKey":"<your key>"}'
```

`GET /api/settings` reports only whether a key is present; `{"summarizerKey": null}` removes
it. Events recovered this way are flagged `extracted: true` in the UI.
