# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

*Last updated 2026-08-16 at the phase 4 merge (verification), see `docs/superpowers/notes/m1-gate-result.md` for the gate numbers and `docs/superpowers/notes/m1-timebox-decision.md` for why phase 2 closed uncleared. Keep this section and the ledger below current — see "Keeping status current".*

**M0 (Skeleton) is complete. M1 phases 1, 2, 2b, 2c and 2d are all finished as work** — every task in every plan is done and every package produced its scored run. "Finished" is not "cleared": five real gate runs have been scored, each under different code, and none reached the bar.

**Phase 2 is closed — uncleared — under spec §9's timebox.** The decision, its reasoning and what it does *not* license are in `docs/superpowers/notes/m1-timebox-decision.md`. **Phases 3 and 4 are done; phases 5–6 are open.** Do not read that as the gate passing: `pnpm eval` still exits non-zero, and it must stay that way.

**Phase 4 made `done` reachable.** Spec resolution (`.vadd/config.json` → auto-detection → per-objective override), A1's `setup` commands, and an EvidenceCollector whose `evidence_items` rows carry a `commandId` are all in, and `workflow-verification.test.ts` drives an objective to `done` through a real green evidence set — the first test in this project able to assert that. `verifying` now `invoke`s the collector, so a `PAUSE` aborts a running suite through the actor's own `AbortSignal`, and the agent's verify turn judges the acceptance `checks` instead of re-running commands VADD has already run.

**What still blocks the milestone is phase 5's surfaces, not the guard.** M1's exit criterion — one real `flexpick.net` bugfix driven to `done` — needs the Focus View and Evidence Panel to drive by hand, and design §12's "no orphan adapter process" is still open from phase 3.

Phase 2d's score, under `72894a1`, with one `recordedUnder` stamp across all ten transcripts equal to the scoring commit:

| type | labels | matched | precision | recall |
|---|---|---|---|---|
| `decision_needed` | 10 | 10 | **100.0%** | **100.0%** |
| `evidence` | 30 | 27 | **75.0%** | **90.0%** |

Three of four bars clear. `evidence` precision is 15 points short and the tuning-vs-holdout recall gap is 16.7% (line is 10). Best run on every axis; full history in the gate note.

**Why the timebox was invoked rather than a sixth round.** All nine remaining false positives are `evidence` events in `execute-task` turns — a turn whose `expects` solicits exactly that. The out-of-contract counter added this phase settles what earlier rounds could only guess: 25 out-of-contract emissions, **all `status`**, zero of them a gated type. The agent obeyed its budget everywhere. Closing the gap now means labelling six more emissions, and labels are the human's to author. Design §10 named this combination in advance as the evidence that moves the diagnosis from the agent to the labels.

**The finding that reframes phases 2b and 2c.** `FenceScanner.push()` decides only on complete lines, so a closing fence with no trailing newline — the end of nearly every agent message — stayed buffered until `flush()`, which runs inside `endTurn()`, *after* the A4 repair decision. The repair routinely read a turn the pipeline had not finished parsing and demanded events the agent had already sent; the duplicate re-emissions that followed were false positives on gated types. Phases 2b and 2c both saw that behaviour and reworded `repair.md` twice to chase it. `ContractPipeline.settle()` fixes it: repairs carrying rejection detail went 0/6 → 5/6, duplicate gated emissions 2 → 0, repair rate 40.0% → 15.0%.

**Standing caveat on every number above.** The ten label files were blind-drafted inside the sessions that recorded the transcripts, not written independently against blind transcripts as design §5.6 requires. A cleared gate on these labels would have been worth less than it looked. Independent re-labelling and a corpus larger than ten remain the highest-value outstanding work on the measurement.

Read before touching M1 work, in this order:

- `vadd-spec-final.md` — the authoritative v1.0 spec, FINAL, plus amendments A1–A3 (2026-08-04) and A4 (2026-08-09)
- `docs/superpowers/specs/2026-08-04-m1-contract-machine-gate-design.md` — the approved M1 design
- `docs/superpowers/specs/2026-08-09-m1-phase2b-provenance-repair-design.md` — the approved phase 2b design, with the failure taxonomy behind it
- `docs/superpowers/plans/2026-08-09-m1-phase2b-provenance-repair.md` — the 7-task implementation plan for phase 2b, TDD throughout; **all 7 tasks done**
- `docs/superpowers/specs/2026-08-10-m1-evidence-precision-design.md` — the approved phase 2c design (Fixes A–D), with the `evidence`-precision breakdown behind it
- `docs/superpowers/plans/2026-08-10-m1-evidence-precision.md` — the 5-task implementation plan for phase 2c; **all 5 tasks done**
- `docs/superpowers/notes/m1-timebox-decision.md` — why phase 2 closed uncleared, what that does and does not permit, and the follow-ups it defers
- `docs/superpowers/plans/2026-08-11-m1-phase3-workflow-machine.md` — the 11-task phase 3 plan (machine, persistence, rehydration, command surface); **all 11 tasks done**
- `docs/superpowers/specs/2026-08-11-m1-phase2d-contract-delivery-design.md` — the approved phase 2d design (contract delivery, repair feedback, turn budget, fence recovery)
- `docs/superpowers/plans/2026-08-11-m1-phase2d-contract-delivery.md` — the 10-task phase 2d plan; **all 10 tasks done**
- `docs/superpowers/specs/2026-08-15-m1-phase4-verification-design.md` — the approved phase 4 design (resolution, setup, EvidenceCollector, the machine's `invoke`)
- `docs/superpowers/plans/2026-08-15-m1-phase4-verification.md` — the 12-task phase 4 plan, TDD throughout; **all 12 tasks done**, with its deviations recorded at the top
- `docs/superpowers/notes/m1-gate-result.md` — all gate results, newest section last: the numbers, the repair-rate/fence-drift detail, the missed-label breakdown, the holdout-purity caveat from phase 2c, and what each design declined to engineer around
- `docs/superpowers/notes/m1-phase12-known-gaps.md` — what phases 1–2 left open, what's since been resolved (profile credentials, the A3 command permission policy, an `execute-task.md` template gap), and what Task 14's real corpus runs found
- `docs/superpowers/notes/m0-known-gaps.md` — what M0 left open, and what M1 inherits by construction
- `docs/superpowers/specs/2026-08-03-m0-skeleton-design.md` — M0's design, including the verification record in §7.1
- `vadd-spec-phase2.md` — Phase 2, which starts only after v1's Definition of Done. One of its items (the managed agent profile) is pulled into M1 by the M1 design.

## Status ledger

Where we are, what's next. Phases are the M1 design's §1.4 build order. **2b, 2c and 2d are all unplanned inserts** — each one a package built to answer why the gate would not clear, and each one ending in a scored run. Phase 2 as a whole is now closed by spec §9's timebox rather than by clearing.

| Phase | Work | State | Evidence |
|---|---|---|---|
| M0 | Skeleton: ACP spike, ports, five tables, debug page | ✅ done | design §7.1; one criterion unmet (no browser render) |
| 1 — Foundation | Agent profile isolation; `AgentEvent` union; fence scanner + validator; prompt contracts; contract events persisted | ✅ done | merged `1f0ac6d` |
| 2 — Corpus + gate | Record + label 12 transcripts; eval harness; iterate prompt and pipeline. **Kill-switch checkpoint** | 🛑 **CLOSED UNCLEARED, 2026-08-11, by spec §9's timebox.** The kill-switch fired and was resolved the way §9 words it — *"fix pipeline"*, across 2b/2c/2d — not by clearing 90% | `0c9b9c2`; five scored runs, final `decision_needed` 100%/100%, `evidence` 75.0%/90.0%; `docs/superpowers/notes/m1-timebox-decision.md` |
| 2b — Provenance + repair | Fence-drift violations; `recordedUnder` stamp; A4 repair turn; re-record and score once | ⚠️ **done, does not clear** | `283a1a8`..`1fb56ca`, all 7/7 tasks; `docs/superpowers/notes/m1-gate-result.md` |
| 2c — Evidence precision | `verify.md` copy fixes; dangling-`evidenceRefs` repair trigger; one relabel; 6-of-10 targeted re-record | ⚠️ **done, does not clear; holdout comparison compromised** | `e0b4c98`..`823f95a`, all 5/5 tasks; `docs/superpowers/notes/m1-gate-result.md` |
| 2d — Contract delivery | Schema reference to the agent; repair carries rejection reason; per-turn event budget; both malformed opening fences; per-worktree `vendor` | ⚠️ **done; gate does not clear, phase 2 closed by §9 timebox** | `c008a19`..`72894a1`, all 10/10 tasks; `docs/superpowers/notes/m1-timebox-decision.md` |
| 3 — Machine | Four remaining migrations; XState machine; snapshot persistence; boot rehydration; spec §7 command surface | ✅ done, opened by the timebox rather than a cleared gate | `9c03808`..`m1-phase3`, all 11/11 tasks; 364 tests; crash/reboot verified by hand against the real server (see "Traps phase 3 paid for") |
| 4 — Verification | Spec resolution + detection; `setup` commands; EvidenceCollector; command permissions | ✅ done — **`done` is reachable now**, proven by a test and by hand against a real suite | `6f2c653`..`93b120a`, all 12/12 tasks; 459 tests |
| 5 — Surfaces | Skeleton Focus View; Evidence Panel; `integrate` commit/keep/discard | 🟢 open | — |
| 6 — Exit run | One real `flexpick.net` bugfix driven to `done` through green evidence | 🟢 open — **still M1's binding exit criterion, not waived by the timebox** | — |

### Next steps

1. **Phase 5 — surfaces.** Skeleton Focus View, Evidence Panel, and `integrate` commit/keep/discard. Phase 4 leaves it three things to consume: `GET /api/projects/:id/verification` (the resolution preview, for a confirm/edit step before creation), `tick_check` (the manual check tick, already writing `decidedBy: user` rows), and the run-scoped evidence set. `GET /api/evidence/:id/artifact` — spec §7's artifact stream — is phase 5's to add; the collector already writes every log under `~/.vadd/artifacts/<objectiveId>/<runId>/`.

2. **One orphan-process gap, found by hand and not fixed** (see "Traps phase 3 paid for"): `kill -9` on the server leaves the `claude-code-acp` child running. Graceful shutdown stops it; a hard crash does not, because nothing records the child's pid. Design §12's exit criterion says a crash-and-reboot must leave "no orphan adapter process", so **phase 6 cannot be signed off until this is closed** — most likely a `childPid` column on `agent_sessions` that `reconcileOnBoot` kills.

3. **Independent re-labelling, and a corpus past ten — the human's call, and the highest-value work on the measurement.** Every gate number to date rests on labels blind-drafted inside the recording sessions, which is not design §5.6's standard. Six more labelled emissions would close the precision gap; more transcripts would close the holdout gap. Neither is agent work. Nothing in phases 3–5 depends on it, so it need not block them — but it should not quietly disappear either.

4. **Smaller follow-ups the gate run left open**, in `docs/superpowers/notes/m1-timebox-decision.md` §7: a parse failure gives the repair turn no diagnostic (a schema rejection now names its field and rule); and reading-budget violations rose to six from one. (§7's third item — `execute-task` driven from `tasks[0]` — is closed: the machine reads `currentTaskIndex`, with a test that fails if it regresses.)

5. **One command surface gap phase 3 deliberately left**: spec §7 lists `cancel` among the machine's commands, meaning "abandon the objective", but M0 already spent that name on "cancel the in-flight turn" and the corpus-recording path depends on the M0 meaning. The turn meaning was kept, so the machine's terminal `CANCEL` has no route today. Phase 5's Focus View needs both, under two different names.

**The gate stays red and stays in CI.** `pnpm eval` exits non-zero by design. Do not relax it, re-scope it, or lower its bar; and do not edit a label file to close the gap — that is the human's to author, from blind transcripts.

### Keeping status current

At the end of every phase (and after any run that moves the gate number), update in the same commit as the work:

- the **Current state** header date + commit, and the gate table if `pnpm eval` was re-run;
- the phase's row in the **Status ledger**, plus the evidence column (a commit sha, not a claim);
- **Next steps** — delete what's done, promote what's now next;
- the matching plan doc's checkboxes, and `docs/superpowers/notes/m1-phase12-known-gaps.md` if the phase opened or closed a gap.

Never mark a row ✅ from intent. A row is done when a command was run and its output seen — the gate row says "ran, does not clear" for exactly that reason.

The monorepo is real: `packages/core` (ports, Zod schemas, policies, the workflow machine), `packages/server` (Fastify, Drizzle, GitManager, AcpAgentPort, EventBus, contract pipeline, WorkflowRunner), `packages/web` (Vite + React debug page). All nine spec §3 tables are migrated as of phase 3.

Verified on this machine 2026-08-03: Node v22.20.0, pnpm 11.9.0, git 2.43.0, `@zed-industries/claude-code-acp@0.16.2`, `@zed-industries/agent-client-protocol@0.4.5`. Both ACP packages are pinned exactly (spec §2) — do not bump them casually; M0 found two places where the SDK's types disagree with the adapter's real output.

## The spec is binding

`vadd-spec-final.md` is FINAL. Every choice in §1 (D1–D15) and §2 (stack) is locked. **Deviations require editing the spec file first** — if a task implies a different framework, a different isolation model, telemetry, gamification, an orchestrator role, or anything in §11 ("Explicitly out"), stop and raise it rather than implementing it.

Seven amendments exist, all recorded in the spec itself. **A1** adds optional `cwd` and `setup` to §6's verification format and extends auto-detection to depth-1 subdirectories; **A2** changes M1's exit repo from Wheelership (no checkout on this machine) to `flexpick.net`; **A3** gives command authorization its own predicate, since §5's low-risk policy governs diffs and says nothing about which commands an agent may run (all three 2026-08-04, from the M1 design). **A4** (2026-08-09) allows one repair prompt per turn. **A5** (2026-08-11, phase 3) adds `evidence_items.commandId`: §5's verification guard reads "every verificationSpec item has an evidence_item with status `pass`", and with no stored link back to the `verify.commands[].id` that produced a row, that guard has nothing to join on. **A6** (2026-08-15, phase 4) adds `evidence.checkId`: §6 says a `checks` entry is satisfied by an agent `evidence` event "referencing the check id", and no field existed to carry that reference — it narrows A5, since a `check`-kind event naming a *declared* id does set `commandId`. **A7** (2026-08-15, phase 4) adds `evidence_items.decidedBy`, because §6 requires a manual tick be "recorded as `decidedBy: user`" and the table had nowhere to put it. Follow that pattern for any further deviation: amend the spec in the same commit as the design that justifies it.

Naming is settled: **VADD everywhere** — packages `@vadd/*`, binary `vadd`, state in `~/.vadd/`, fence tag `vadd-event`, repo config `.vadd/config.json`.

## M1 scope

The design fixes several boundaries; don't re-litigate these without reading it.

- **Build order is risk-first.** Contract pipeline → corpus → eval gate, *then* machine, verification, and UI. The gate is spec §9's kill-switch and only has value if it can fire while budget remains. Phases 3–6 start only after the gate clears 90%.
- **The gate measures human-labelled ground truth** — what *should* have surfaced, not what the agent emitted — with the summarizer off, over ten contract transcripts (four held out). Two extra raw transcripts are a floor measurement and never part of the gate.
- **The pipeline validates everything itself.** M0's SDK silently discarded ~a quarter of one session's updates. No code path may turn a parse or validation failure into silence; failures become persisted `contract_violation` events.
- **`AgentPort`'s shape does not change.** M1 adds a transform over `onUpdate`, not new methods.
- **Four additions beyond spec §9's M1 line**, each blocking the exit criterion: the managed agent profile (`CLAUDE_CONFIG_DIR`) — done, `389673b`; the command permission policy (amendment A3) — done, `83aabd8`, ahead of its originally-planned phase 4 slot, once M0's fail-closed-on-Bash gap turned out to block Task 14 directly; `setup` commands — done in phase 4, and running at worktree creation rather than before the first verification; a skeleton Focus View — not started, still phase 5 work.

Deferred to M2: shadcn/ui and Decision Card styling, Low Energy Mode, Fast Fix auto-approval (the machine guard ships in M1), daily summary, `npx` packaging, `react-diff-view`, `integrate` via `pr`/`merge`, Playwright.

## What VADD is

A localhost web app (`npx vadd`) that wraps an existing coding agent (v1: Claude Code only, over ACP via Zed's `claude-code-acp` child process). It is a **comprehension + verification layer**, not an agent and not an orchestrator. Two theses drive nearly every design decision:

1. **Read 10× less text** — the UI shows structured events, not log streams. §10 makes this a unit test: a Level 1 string over 15 words or Level 2 block over 80 words fails a lint on bundled prompt templates. The M1 design §4.2 defines exactly which fields are Level 1 and Level 2.
2. **"Done" means proven, not claimed** — the state machine, not the UI, makes `integrating → done` unreachable without a full green evidence set.

## Architecture that spans files

**Output Contract pipeline** (`packages/server/contract`, spec §4 + M1 design §3). Agents emit ```` ```vadd-event ```` fenced JSON blocks inside their message stream. The pipeline buffers `agent_message_chunk` text (thought chunks are excluded), scans for closing fences, parses, validates against the Zod `AgentEvent` union, and emits. Zod is the single source of truth — JSON Schema is *exported* from it for prompt contracts, never hand-written twice. Fallback chain: optional one-shot Haiku extraction using the exported schema (flagged `extracted: true`) → otherwise a `status` event pointing at the raw view. Emissions persist to the existing `events` table, so SSE, the raw view, transcript export, and the eval corpus all come free.

**Workflow machine** (`packages/core`, XState v5, spec §5 + M1 design §6). Defined in `core` with `setup()`, side effects named but not implemented; the server binds them with `provide()`. One machine for Feature/Bug with a Fast Fix shortcut (guard on `mode === "fastfix"` routes `exploring → planning`; verification is *never* skipped). Execution is one prompt per plan task, each preceded by a `vadd-checkpoint:` commit. Snapshots persist on every transition **in the same SQLite transaction as the event append**. Only three things feed the actor: validated `AgentEvent`s, user commands, and `EVIDENCE_RESULT` — raw ACP updates never reach it.

**Evidence + verification** (spec §6 + M1 design §7). Resolution: repo `.vadd/config.json` if present, else auto-detection (root and depth-1 subdirectories), with per-objective DB overrides merged on top and winning field by field. `setup` runs once per worktree before the first verification. EvidenceCollector runs commands via `execa` at each command's `cwd` and reconciles results against `verificationSpec`; `checks` are satisfied by an agent `evidence` event of kind `check` or a manual user tick.

**Layering rule:** `packages/core` is domain-only — machine, ports, schemas, policies, **no I/O**. All agent communication goes behind `AgentPort`; the ACP SDK and the `claude-code-acp` child process are wrapped entirely inside it so v1.1 (Codex) is an adapter swap. Server is Fastify + SSE only (no WebSocket); the frontend mirrors server snapshots and performs **no client-side transitions**.

## Hard constraints

- **Zero telemetry, zero outbound network** with the summarizer key unset — §10 requires a test proving this with the network disabled. The optional Anthropic summarizer uses the *user's own* key; VADD never ships or requires one. The eval gate runs with it off.
- **Isolation is git worktrees only**, under `~/.vadd/worktrees/<projectId>/<objectiveId>`. No Docker. Worktree lifecycle must be leak-free (`git worktree list` clean after integrate/discard).
- **`strict: true`** TypeScript everywhere; Node 22 LTS (Bun was rejected for `better-sqlite3`/ACP SDK compatibility).
- State lives in `~/.vadd/` — `vadd.db` (SQLite/Drizzle), `artifacts/<objectiveId>/`, `prompts/` (user prompt overrides), `worktrees/`, `agent-profiles/` (M1).
- Git operations use a direct CLI wrapper via `execa`, deliberately not `simple-git`.
- Localhost API, no auth (spec §7) — intentional, not an oversight.

## Traps M0 paid for

Each of these cost a review finding or a wrong claim. They are not hypothetical.

- **Never spawn `npx claude-code-acp`.** With `cwd` set to a worktree — which never has `node_modules` — npx falls back to the registry and silently runs an unrelated package. Resolve the pinned adapter's bin by path (`resolveAdapterBin()`).
- **The SDK drops what it cannot parse.** `ClientSideConnection` validates `session/update` before dispatch and throws on failure, so the handler never sees it and only its own `console.error` records the loss. `relaxNotificationSchema()` works around this. Treat client-side validation on the receive path as a liability.
- **The permission policy denies every path-less tool.** `Bash`, `BashOutput`, `KillShell` carry no `locations` and no path-bearing `rawInput`, so they hit the fail-closed branch. Fixed by amendment A3's command predicate (`packages/core/src/policies/command-policy.ts`, wired into `AcpAgentPort.requestPermission` in `83aabd8`) — do not reach commands by extending the path predicate.
- **`requestPermission.toolCall.locations` is often absent**, even when the earlier `tool_call` notification for the same `toolCallId` carried them. Paths come from three sources, and an empty path set must fail closed — `[].every()` returns `true`.
- **An allow is granted once.** `allow_always` maps to `acceptEdits` in this adapter, which bypasses `requestPermission` for the rest of the session and would silently disable the policy.
- **`pnpm dev` does not forward signals.** `Ctrl-C` signals the whole process group and is fine; `kill %1` orphans the server, Vite, and any adapter.
- **Transcripts have two incompatible record shapes**, and anything exported before the dropped-update fix is lossy. See `evals/transcripts/README.md`; the M1 loader discriminates on `schemaVersion` and refuses pre-fix exports.
- **No browser automation exists in this environment.** The debug page has never been rendered in a browser — M0's one unmet exit criterion. Verify React changes by hand and say so plainly.

## Traps Task 14 paid for

Found recording the real corpus, not hypothetical either.

- **The managed profile had no way to authenticate.** `ensureAgentProfile()` isolates `CLAUDE_CONFIG_DIR` from the user's real one so third-party skills can't leak in, but that also hides the OAuth session — the very first real session under the profile failed with "Authentication required" before the isolation question was even reached. Fixed in `389673b` by copying `.credentials.json` into the profile on every regeneration; isolation is about skills/plugins, not identity.
- **A Claude Code session's own env vars block its own adapter.** `claude-code-acp` refuses to start when `CLAUDECODE` is set. The server only spawns the adapter lazily, and the child inherits the *server process's* env, not the caller's — so `env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u AI_AGENT -u CLAUDE_CODE_SESSION_ID -u CLAUDE_PID -u CLAUDE_EFFORT -u CLAUDE_CODE_MAX_OUTPUT_TOKENS -u CLAUDE_CODE_BRIDGE_SESSION_ID -u CLAUDE_CODE_SSE_PORT -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH` in front of `pnpm dev` (or the E2E test) is enough — no separate terminal required.
- **`execute-task.md` never showed a `task_result` example.** It showed `evidence`'s JSON shape but not `task_result`'s, so the agent reliably invented the wrong fields (`status`/`headline`/`summary` instead of `taskId`/`claim`/`evidenceRefs`) and hit a schema `contract_violation` on every real execute-task turn. Fixed in `77f13f1`; affected transcripts re-recorded in `2e7c91f`.
- **A worktree's `docker compose exec` runs against the wrong checkout.** `flexpick.net`'s real test workflow bind-mounts the *main* checkout into Sail, not a VADD worktree — a worktree-scoped agent that reaches for `docker compose exec` is operating on code it didn't write. Worked around for corpus recording by symlinking `vendor`/`node_modules` and pointing a copied `.env` at the Sail containers' host-exposed ports directly (bypassing Docker entirely); `setup` commands (phase 4) are the real fix.
- **The eval corpus is turn-indexed, so anything turn-opening invalidates all 40 labels.** `loadTranscript` opens a turn on `prompt_sent` alone; a `prompt_cancelled` is turn-closing. That is why A4's repair is emitted as `repair_prompt_sent` inside the open turn, and why a cancelled turn means discarding and re-recording that whole objective rather than re-prompting it.
- **A corpus recorded across a pipeline change measures neither version.** Two contract fixes landed mid-recording from a concurrent session (`11e35d4`, `0180334`), and the resulting replay-vs-live divergence cost hours to diagnose because transcripts recorded what the agent said and not what parsed it. Confirm a clean tree and note HEAD before recording; phase 2b's `recordedUnder` stamp makes it visible afterwards.
- **Zod's length caps and thorough reasoning are in tension.** `decision_needed` options (`verification` ≤120 chars, `pros`/`cons` items ≤100 each) and `evidence.summary` items (≤100 chars) were exceeded routinely across the real corpus whenever the agent reasoned carefully. Left as-is — this is real signal for the gate, not a bug — but expect it to recur and possibly cap achievable recall.

## Traps phase 3 paid for

All four were found by running the thing, not by reading it. The first two were invisible to the unit tests that existed at the time.

- **Test setup can hide a missing production step.** `runTurn` requires an already-live agent session (`agents.get`, throwing otherwise); the prompt *route* calls `ensure()` first, but the machine's `sendPrompt` did not — so every machine-driven objective failed its very first turn into `paused`. Both `workflow-effects.test.ts` and `workflow-runner.test.ts` called `agents.ensure()` in their own setup, which made the gap invisible. The fix is guarded by `agents.get()` rather than always awaiting: an unconditional `await` defers `prompt()` by a microtask, and every turn-driving test settles the fake prompt synchronously after `send()`.
- **`PAUSE` has to stop the turn, not just the machine.** Without that, `RESUME` re-entered a state whose entry sends a prompt, `runTurn` refused with "a turn is already in flight", and the objective bounced straight back to `paused` — pause was unusable in exactly the situation it exists for. `cancelOpenTurn()` is shared by the `cancel` route and the runner's `paused` entry.
- **`createActor` does not reject a snapshot it cannot restore.** It returns an actor whose state value is `undefined` and then throws from xstate's own scheduler **asynchronously**, outside any caller's `try`/`catch` — an uncaught exception on an actor that already looked resumed. `WorkflowRunner.resume` validates `value` against `MACHINE_STATES` up front so one corrupt row cannot abort boot rehydration or take the process with it.
- **A `kill -9` orphans the adapter child.** Verified by hand: graceful shutdown stops it, a hard crash does not, because nothing records the child's pid. Design §12 requires "no orphan adapter process" after a crash-and-reboot, so this is still open. **Related trap:** `pgrep -f "tsx src/index.ts"` matches the wrapper shells, not the node process that actually holds the port — the first kill in that session silently did nothing and the run had to be redone. Confirm a server is dead by checking the listener (`ss -tlnp | grep <port>`), never by the absence of a pattern match.
- **Deleting an objective now touches six tables.** `machine_snapshots`, `decisions`, `plan_tasks` and `evidence_items` all carry a foreign key on `objectives.id` with no cascade. `integrate: discard` cleared only `agent_sessions`, so against the real server it removed the worktree and *then* 500'd on the constraint, leaving a row pointing at a directory that no longer existed. The deletes now run in one transaction, `evidence_items` first (it also references `plan_tasks`).

## Traps phase 4 paid for

- **`execa`'s `timeout` and `cancelSignal` reach the shell, not the suite.** Both signal the process VADD spawned, and a dying shell does not take `phpunit` — or `vitest`, or `sleep` — with it. The survivor also holds the output pipe open, so `await` on the subprocess resolves only when the command finishes *naturally*: `sleep 5` under a 1s timeout measured 5006ms and left the `sleep` running, which makes `timeoutSec` decorative and a `PAUSE` mid-suite a lie. `verification/run-command.ts` spawns `detached: true` and kills the process **group** (`process.kill(-pid)`), SIGTERM then SIGKILL after a grace period: 1004ms, nothing left behind. Both `runSetup` and the collector go through it; a test pins the bound itself, not just the resulting `fail` status.
- **A `VerificationSpec` cannot serve as its own override.** `CreateObjectiveBody.verificationOverrides` took the full schema, whose zod defaults fill `setup`/`commands`/`checks` with `[]` — so an override meaning "raise the timeout" arrived carrying three empty arrays, and `mergeSpec`'s leaf replacement then erased everything config or detection had just found. `VerificationOverride` (every leaf optional, absent meaning "no opinion") is the fix; a caller supplying a whole spec still parses.
- **drizzle-kit emits `?` placeholders for a `sql.join`-built CHECK.** `0002_verification.sql` came out with `status in (?, ?, …)` — nineteen bound parameters in a DDL statement that never gets any. Hand-substitute the literals, following `0001_workflow_machine.sql`, which needed exactly the same fix and is the reason to check the generated file every time rather than trusting it.
- **A bare worktree cannot run the repo's own suite, and pnpm makes it worse.** Verified by hand: a fresh worktree of this repo with only a root `node_modules` symlink still failed with `Cannot find package 'zod'`, because pnpm workspaces resolve through *per-package* `node_modules` too. This is the same class of problem as the `flexpick.net` `vendor` trap, and it is why `setup` moved from "before the first verification" to worktree creation — an agent asked to work test-first cannot run a test otherwise.
- **`setup_failed` is deliberately not swept by `reconcileOnBoot`.** Unlike `creating`, the row owns the `evidence_items` row carrying the failure log; deleting it would lose the diagnostic and trip the same foreign key that broke `integrate: discard` in phase 3. `reconcileOnBoot` selects only `creating`, and a test now pins that rather than leaving it to a comment.

## Commands

```
pnpm dev                           # Fastify on 127.0.0.1:4319 + Vite on 127.0.0.1:5319
pnpm test                          # Vitest
pnpm typecheck                     # tsc -b
pnpm lint                          # Biome (lint + format; the only such tool)
pnpm format                        # Biome, writing fixes
pnpm transcript:export <objId>     # dump events rows → evals/transcripts/<name>.jsonl
pnpm eval                          # eval harness: precision/recall vs. golden transcripts (M1)
npx vadd                           # packaged entry point → localhost web app (M2)
```

Single Vitest file: `pnpm vitest run <path>`; single test: add `-t "<name>"`. The real-adapter integration test is skipped unless `VADD_E2E=1`. `pnpm eval` runs against the recorded corpus and its labels and **currently exits non-zero** — the gate genuinely fails (see Current state), which is the harness working, not a setup problem. It exits non-zero on an unlabelled transcript or an orphan label too, so keep `evals/transcripts/*.jsonl` and `evals/labels/*.labels.json` in exact name correspondence.

For a corpus re-record, run the server as `npx tsx src/index.ts` under the `env -u` list below — **not** `pnpm dev`, whose `tsx watch` reloads on any file touch into an `EADDRINUSE` race that has already killed one run mid-turn.
