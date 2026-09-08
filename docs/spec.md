# VADD — project specification

This is the specification for VADD v1: what it is, what it deliberately is not, and how each
part works. It describes the system as built. Where a design decision is locked, it says so,
and the amendment log at the end records every change made to a locked decision since the
original specification was frozen.

- Practical instructions for using VADD are in the [user guide](user-guide.md).
- Every configuration surface is documented in [configuration](configuration.md).

---

## 1. What VADD is

VADD is a localhost web application that wraps an existing coding agent — Claude Code or
Codex, spoken to over the Agent Client Protocol (ACP) as a child process — and turns its
output into something a person can supervise.

Two theses drive nearly every decision below:

1. **Read 10× less text.** The interface shows structured events, not a log stream. The agent
   emits typed events at phase boundaries; VADD validates them and renders cards. The raw
   transcript stays one click away and is never the primary surface.
2. **"Done" means proven, not claimed.** An objective reaches its terminal `done` state only
   when a full green evidence set exists. This is enforced by the workflow state machine, not
   by the interface — no button, route or user action can shortcut it.

VADD is not an agent, an orchestrator, or an IDE. It runs no model of its own, holds no API
key of its own, and adds no autonomy to the agent it wraps.

### Non-goals

Explicitly out of scope for v1, and not to be built without amending this document:

VADD's own agent · gamification · Docker or cloud sandboxes · mobile · Tauri · team features ·
provider or cost dashboards · MCP server management · additional workflow packs · an AHP
adapter · a Goose adapter.

---

## 2. Locked product decisions

These fifteen decisions are binding. A change to any of them requires an amendment (§13).

| # | Decision | Choice |
|---|---|---|
| D1 | Positioning | A comprehension and verification layer. Not an orchestrator, not an agent, not an IDE. *Amended by A19.* |
| D2 | Agent | Claude Code, over ACP via Zed's `claude-code-acp` adapter process. *Amended by A14, which adds Codex.* |
| D3 | Protocol | ACP primary; all agent I/O behind an internal `AgentPort` interface. No AHP work. *Interpreted by A16.* |
| D4 | Isolation | Git worktrees only, under `~/.vadd/worktrees/<projectId>/<objectiveId>`. No Docker. |
| D5 | Workflow | One state machine — Feature/Bug — with a Fast Fix shortcut path through the same machine. *Extended by A15, which adds an Investigation mode.* |
| D6 | Gamification | None. A plain daily summary of verified outcomes, and nothing else. |
| D7 | UI surfaces | Objective Board, Focus View, Decision Card, Evidence Panel, Review screen. *Amended by A17 and A18.* |
| D8 | Low Energy Mode | A single header toggle: Focus View only, non-blocking notifications suppressed, low-risk steps auto-approved, a "good stopping point" after each verified outcome. |
| D9 | Parallel objectives | The schema supports any number of active objectives per project; the interface renders one active workflow at a time and lists the rest on the board. |
| D10 | Verification spec | Auto-detected defaults, plus an optional `.vadd/config.json` committed in the repository, plus per-objective overrides stored in the database. |
| D11 | Prompt contracts | Versioned prompt templates bundled per agent; user overrides in `~/.vadd/prompts/`. |
| D12 | Diff presentation | Diff stats and a per-file collapsed list; expanding a file opens a real syntax-highlighted diff. A real viewer is required for trust. |
| D13 | Stopping point | After every verified task, Low Energy Mode shows a good-stopping-point banner with a session summary. |
| D14 | Licensing | Apache-2.0, permanently, for the core. |
| D15 | Telemetry | None. Zero network calls except to the user's own agent and integrations. *Interpreted by A20 and A21.* |

---

## 3. Stack and layout

| Layer | Choice |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript, `strict: true`, everywhere |
| Monorepo | pnpm workspaces |
| Backend | Fastify — REST plus one SSE endpoint. No WebSocket. |
| Database | SQLite via `better-sqlite3`, schema and migrations through Drizzle |
| Workflow | XState v5, with a snapshot persisted on every transition |
| Validation | Zod as the single source of truth; JSON Schema is *exported* from it for the prompt contract, never hand-written twice |
| ACP | `@zed-industries/agent-client-protocol`, with the adapter launched as a child process. Every version is pinned exactly. |
| Git | A direct CLI wrapper over `execa`, deliberately not `simple-git` |
| Frontend | Vite, React, Tailwind, shadcn/ui |
| Diff UI | `react-diff-view`, in a lazy chunk |
| Live updates | SSE at `/api/events`, resumable with `Last-Event-ID` |
| Lint and format | Biome |

```
vadd/
  packages/
    core/      domain only: schemas, the workflow machine, policies, scoring — no I/O
    server/    Fastify, Drizzle, git, the ACP adapters, the contract pipeline, verification
    web/       the React application
    cli/       bundles the three into the published @vadd/cli binary
  prompts/     the bundled prompt contract templates
  evals/       recorded agent transcripts and human labels
```

**The layering rule is load-bearing.** `packages/core` performs no I/O. All agent
communication goes behind `AgentPort`, and the ACP SDK and adapter child process are wrapped
entirely inside it, so a second agent is an adapter swap rather than a change to the machine.
The frontend mirrors server snapshots and performs no state transitions of its own.

---

## 4. The Output Contract

The agent emits typed events as fenced JSON blocks inside its ordinary message stream:

~~~
```vadd-event
{ "type": "status", "phase": "executing", "headline": "Added the onRequest hook" }
```
~~~

### The event union

Nine types. Every length bound is deliberate: they are what enforces the reading budget
(§12), not decoration.

| Type | Carries | Drives the machine |
|---|---|---|
| `status` | `phase`, a headline of at most 120 characters | yes |
| `decision_needed` | a question, 2–4 options, a `recommendedId` | yes |
| `clarification` | a question and up to 4 suggested answers | yes |
| `plan` | 1–12 tasks, each with a title, a description and optional `expectFailing` | yes |
| `task_result` | `taskId`, a claim, evidence references | yes |
| `evidence` | `kind`, `status`, a headline, up to 6 summary lines, an optional `checkId` | yes |
| `failure` | a headline, a probable cause, up to 3 suggested actions | yes |
| `memory_note` | `architecture` or `known_issue`, a headline, up to 400 characters | no |
| `artifact` | 1–6 typed cards | no |

An option on a `decision_needed` carries `pros`, `cons`, an optional `effort` of S/M/L, a
`verification` string, and — the only mandatory analysis field — a `reversibility` of
high/medium/low.

`memory_note` and `artifact` are validated exactly like every other event but are intercepted
before the machine sees them: one becomes durable project memory, the other becomes supporting
material rendered beneath a decision or a plan. Neither can advance a workflow.

An `artifact`'s cards are a discriminated union of four kinds — `text` (600 characters),
`table` (2–4 columns, up to 6 rows), `code` (up to 20 lines) and `diagram` (Mermaid, up to 25
lines). They are a sketch beside a decision, not a document.

### The pipeline

`packages/server/src/contract` buffers the agent's message text (thought chunks excluded),
scans for closing fences, parses, and validates against the Zod union. Failures never become
silence:

1. A block that parses and validates is emitted and persisted.
2. A block that does not can be sent once to a small Claude model, using the exported JSON
   Schema, to try to recover the event. This fallback is off unless you supply your own API
   key; a recovered event is flagged `extracted: true`.
3. Otherwise VADD emits a `status` event pointing at the raw view, and records a
   `contract_violation` event carrying what actually arrived.

Every emission lands in the append-only `events` table, which is the single source for SSE,
the raw view, transcript export and the evaluation corpus.

Each prompt template declares in its front matter which event types it **expects** and which
it **permits**. An expected type that never arrives is an unmet expectation; a permitted type
is allowed but never required, and never satisfies a phase's contract on its own.

---

## 5. The workflow machine

One machine, defined in `packages/core` with `setup()` and side effects named but not
implemented; the server binds them with `provide()`.

```
idle → exploring → clarifying? → proposing → awaitingDecision
     → planning → awaitingPlanApproval → executing → verifying
     → awaitingReview → { executing (next task) | revising | rollingBack }
     → integrating → done

any → paused | cancelled | failed
```

Two further statuses exist on the objective row without ever being machine states: `creating`,
while the worktree is being made and its setup commands run, and `setup_failed`, a permanent
row that owns the evidence item carrying the failure log.

### Locked semantics

- **The evidence guard.** `verifying → awaitingReview` requires a collector result in which
  every item of the verification spec has an evidence item with status `pass` — or `warn`,
  where the item is marked `allowWarn`. **`integrating → done` is unreachable without a full
  green evidence set, and that is enforced in the machine.**
- **Fast Fix.** A guard on `mode === "fastfix"` routes `exploring → planning` directly,
  skipping `proposing` and `awaitingDecision`, and auto-approves the plan when the low-risk
  policy passes. Verification is never skipped.
- **Investigation.** A read-only mode that produces a report rather than a commit. It runs
  through the same machine and the same states; no new transitions exist for it.
- **The low-risk policy.** No change to files matching the protected globs (migrations, `.sql`
  files, lockfiles, dependency manifests, and anything else configured); no new dependency; a
  diff no larger than the configured line bound; no deleted public export. A violation
  escalates to the full path.
- **Checkpoints.** Before each entry into `executing`, VADD commits the worktree with a
  `vadd-checkpoint:` prefix. `rollingBack` is a hard reset to a recorded checkpoint.
- **Persistence.** A snapshot is written on every transition, **in the same SQLite
  transaction as the event append**. On boot the server rehydrates every non-terminal
  objective; a session that has to start mid-objective is seeded with a brief carrying the
  goal, the decision that was taken, the plan markers and the project's memory notes.

Only three things reach the machine: validated agent events, user commands, and the
verification result. Raw ACP updates never do.

---

## 6. Verification and evidence

Verification is described per repository, in an optional `.vadd/config.json`. Resolution order
is: the file if present, otherwise auto-detection at the repository root and one directory
down, with per-objective overrides merged on top, winning field by field. Detecting nothing is
an explicit outcome — never an empty and therefore trivially green command set.

- `verify.setup[]` runs once per worktree, at creation, for repositories whose dependencies
  are not tracked.
- `verify.commands[]` are run by VADD itself, not by the agent, at each verification. Each
  produces an evidence row linked back to the command id that produced it. A command is killed
  by process group on timeout, so a dying shell cannot leave a test suite running.
- `verify.checks[]` are acceptance checklist items. Each is satisfied either by an agent
  `evidence` event of kind `check` naming the check's id, or by a manual tick in the Evidence
  Panel, which is recorded as decided by the user. A check is a claim, not proof, and the
  interface says so.

Agent-emitted evidence that names no command is displayed and never counted. The evidence set
the guard reads is the newest row per command id; earlier runs stay visible as history.

The full format is documented in [configuration](configuration.md).

---

## 7. Isolation and integration

Every objective gets its own git worktree and branch, under `~/.vadd/worktrees/`. Nothing
touches the main checkout until the user chooses to integrate. The starting commit is recorded
at creation, so both the diff and the eventual squash have a fixed point to compare against.

Integration offers three outcomes:

- **commit** — squash the checkpoints into one commit on the branch, then release the
  worktree. Refused for an investigation objective, which has no diff by construction.
- **keep** — leave the branch and the worktree in place.
- **discard** — remove both.

Any path that creates a commit re-checks the protected globs against the objective's starting
commit and excludes what it must, naming every excluded path in the objective's events rather
than silently dropping it.

---

## 8. Data model

Twelve tables, all in `~/.vadd/vadd.db`.

| Table | Holds |
|---|---|
| `projects` | a registered repository, its config and its chosen agent |
| `objectives` | one unit of work: goal, mode, status, worktree, branch, starting commit, integration outcome, resolved verification spec |
| `machine_snapshots` | the latest XState snapshot per objective; history lives in `events` |
| `events` | append-only: the audit log, the SSE source and the transcript export |
| `agent_sessions` | one ACP session per objective, with the adapter child's pid |
| `decisions` | a `decision_needed` and the option chosen |
| `plan_tasks` | the approved plan, ordered, each with its checkpoint commit |
| `evidence_items` | every command result, check and agent claim |
| `git_undo` | the single-step undo record for a git mutation, keyed on the worktree |
| `project_memory` | durable architecture notes and known issues, injected into later objectives |
| `artifacts` | the cards an `artifact` event carried |
| `settings` | key/value; today, the optional summarizer key |

Captured command output lives on disk under `~/.vadd/artifacts/<objectiveId>/`, referenced
from the evidence row.

---

## 9. HTTP API

Fastify, bound to `127.0.0.1`, with no authentication. That is a deliberate consequence of
being a localhost single-user tool, not an oversight.

```
POST   /api/projects                       register a repository
POST   /api/projects/clone                 clone a URL, then register it
GET    /api/projects
GET    /api/projects/:id/verification      the resolved verification spec
GET    /api/projects/:id/memory            the project's memory notes
GET    /api/projects/:id/today             the daily summary
POST   /api/projects/:id/objectives        { title, goalText, mode, verificationOverrides? }
GET    /api/objectives                     the board
GET    /api/objectives/:id                 the full aggregate: state, tasks, decisions,
                                           evidence, artifacts, activity
DELETE /api/objectives/:id
POST   /api/objectives/:id/events          user commands (below)
GET    /api/objectives/:id/diff            stats and file list; ?file= returns a unified diff
GET    /api/objectives/:id/raw             the raw agent transcript
GET    /api/evidence/:id/artifact          streams a captured log
GET    /api/events?objectiveId=&lastId=    SSE
GET    /api/fs/browse                      directory picker for project registration
GET|PUT /api/settings
```

User commands are `decide`, `answer_clarification`, `approve_plan`, `approve_task`, `revise`,
`rollback`, `tick_check`, `pause`, `resume`, `cancel`, `abandon` and `integrate`. A command
the current state does not accept is refused with the state named in the message.

A further 23 routes under `/api/projects/:id/git/…` back the git console: `log`, `status`,
`stage`, `unstage`, `discard`, `commit`, `amend`, `squash`, `reword`, `drop`, `stash`,
`stash/pop`, `branch`, `branch/delete`, `checkout`, `worktree`, `worktree/remove`, `release`,
`undo`, and the four network-capable ones, `fetch`, `pull`, `push` and `remotes`.

---

## 10. Interface

- **Objective Board** (`/`) — objectives grouped by whether they need you, are working, are
  paused or are finished, each row a status dot, a headline in plain words, a branch and a
  `verified/total` progress bar. Project memory sits beneath.
- **Focus View** (`/o/:id`) — **exactly one primary element per state**: a Decision Card or
  clarification prompt, the plan awaiting approval, the live task card, the Evidence Panel
  with review actions, the integration chooser, or the terminal outcome. A phase stepper sits
  above it; the full task list and any supporting material sit below.
- **Decision Card** — options with pros, cons and badges; the recommended one preselected;
  reversibility always visible. Actions: approve the recommendation, choose another, ask for
  alternatives, or pause.
- **Evidence Panel** — required, advisory and warning groups; required items decide whether
  `done` is reachable and say so; checks are tickable; the diff and the raw log come last.
- **Quest Map** (`/map`) — the project's objectives laid out in five status columns.
- **Git console** (`/git`) — the commit graph, branches, worktrees, remotes, and the local
  operations listed in §9, each behind a confirmation.
- **Daily summary** (`/today`) — verified outcomes, decisions made, checks passed. Text only.
- **Raw view** (`/debug`) — deliberately outside the application shell, so it keeps working
  when the shell is what is broken.

The interface performs no state transitions. Everything on screen is a mirror of the server's
own snapshot.

---

## 11. Security, privacy and network posture

- **No telemetry, and no outbound request of VADD's own** with the summarizer key unset. A
  test in the suite pins this with the network disabled.
- **The only network traffic** is your agent talking to its provider, git talking to remotes
  you configured or typed in yourself, and the optional summarizer if you gave it a key.
- **Git network operations are structurally constrained.** Only one server module may issue a
  network-capable git command, and a static test enforces that. Every fetch, pull and push
  takes a remote *name*, validated against the repository's own remotes — no route accepts a
  URL. There is no force push, no non-fast-forward pull, and no remote add, remove or branch
  deletion.
- **Clone is the one exception**, and it validates before the URL ever reaches git: an
  allow-listed scheme, git's scp-like short form, or a plain absolute local path. `file://`,
  every other scheme (`ext::` among them, a documented remote-helper execution vector), and
  anything beginning with `-` are refused — including a username or hostname beginning with
  `-` inside an otherwise well-formed URL, which is CVE-2017-1000117's ssh option injection.
- **Credentials are never stored or requested.** Every git operation inherits your own git
  credentials; each agent inherits your own login, copied into an isolated profile directory
  so that third-party skills or plugins in your real profile cannot leak into a VADD session.
- **The agent's tool use is policed.** File edits are checked against a path predicate and
  shell commands against a separate command predicate; a tool call carrying no path fails
  closed rather than being allowed through. A permission grant applies to one call, never to
  the rest of the session.

---

## 12. Quality gates

- **The reading budget is a test.** Any Level 1 string over 15 words, or Level 2 block over 80
  words, fails a unit test against the bundled prompt templates.
- **The evidence gate is a test.** Every machine transition is covered, and `done` is provably
  unreachable without a green set.
- **Isolation is a test.** Create → work → integrate or discard leaves `git worktree list`
  clean, and both the path and the registration are asserted — git-level success and
  filesystem-level success are different facts.
- **The extraction gate.** `pnpm eval` replays a frozen corpus of recorded agent transcripts
  against human labels of what *should* have surfaced, with the summarizer off, and reports
  precision and recall per event type. The bar is 90% on `decision_needed` and `evidence`.

  **The gate does not currently clear, and `pnpm eval` exits non-zero by design.**
  `decision_needed` scores 100% precision and recall; `evidence` scores 75% precision against
  a 90% bar. The labels were drafted inside the recording sessions rather than blind, so
  clearing them on this corpus would be worth less than it looks; an independent re-labelling
  and a corpus larger than ten transcripts are what the number is waiting on. CI runs the gate
  without blocking on it.

---

## 13. Amendments

Every change to a locked decision is recorded here, in the same commit as the design that
justified it. Twenty-four exist; twenty-three are in force.

| # | Change |
|---|---|
| A1 | `cwd` and `setup` added to the verification format; auto-detection extended to depth-1 subdirectories. |
| A2 | The exit-criterion repository changed. |
| A3 | Command authorisation gets its own predicate: the low-risk policy governs diffs and says nothing about which commands an agent may run. |
| A4 | One repair prompt allowed per turn. |
| A5 | `evidence_items.commandId`: the verification guard needs a stored link back to the command that produced a row. |
| A6 | `evidence.checkId`: a check is satisfied by an event "referencing the check id", and no field carried that reference. |
| A7 | `evidence_items.decidedBy`: a manual tick must be recorded as such. |
| A8 | `objectives.baseSha`, `objectives.integrateAction`, `agentSessions.childPid`: a fixed starting point for the diff and the squash, a discarded objective distinguishable from a committed one, and a pid to kill an orphaned adapter. |
| A9 | The spec's `cancel` — abandon this objective — is renamed `abandon`, because `cancel` already meant cancelling the in-flight turn. |
| A10 | `REVISE` may re-enter `planning` from `awaitingPlanApproval`, carrying the instruction: there was no way to say "the plan is wrong, think again". |
| A11 | A plan task may declare `expectFailing` command ids, so a test-first red step can reach review without weakening the `done` guard. |
| A12 | Low Energy Mode and the policy fields get their first real implementation: a low-risk task and a simple Fast Fix plan auto-approve by dispatching the same event a human click would. |
| A13 | The npm name is `@vadd/cli`; the unscoped name was taken. |
| A14 | `projects.agentKind`: a per-project choice of Claude Code or Codex. Overrides D2's "Claude Code only". |
| A15 | `investigation` added as a third objective mode — read-only, no diff, ends in a report. No new states. |
| A16 | Clarifies D3 against a reduced, non-pairwise, deterministic option priority score — a reading of D3's text, not a change to it. |
| A17 | Adds the application shell, project switcher, theme control and the two creation dialogs to the UI scope, closing the gap where registering a project was unreachable from any screen. |
| A18 | Overrides D7's "no Quest Map graph" outright, by explicit decision: `/map` lays objectives out in five status columns, with no edges and no server change. |
| A19 | Overrides D1's exclusion of a general git client, by explicit decision, adding local git surgery to a `/git` console. Four constraints are part of the amendment: a mutation is refused while a writer holds the objective; the protected globs bind on every commit-creating path; a rewrite nulls unreachable checkpoint references and names the affected tasks; and switching an objective's branch or removing its worktree is refused outright. No network call is authorised. |
| A20 | Reads D15's "except to the user's own agent/integrations" as covering a remote the user configured in their own repository, and adds fetch, fast-forward pull, push and a read-only remotes listing. No route accepts a URL; every operation takes a validated remote name. |
| A21 | Extends A20's reading to a URL the user types into the Clone tab at the moment of the click, and adds one route to clone it. Validation happens before the URL reaches git (§11). |
| A22 | Adds cross-session project memory: a `memory_note` event, a table, and a capped slice injected into every objective's first prompt. |
| A23 | *Reserved, not in force.* GitHub account linking over OAuth device flow. Designed and planned; it cannot work until a GitHub OAuth App is registered. |
| A24 | Adds typed card artifacts: an `artifact` event, a table, a secondary block under the Decision Card and Plan Approval, and the `permits` template front-matter key — event types allowed but not required. |
