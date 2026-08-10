# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

*Last updated 2026-08-10 at `1fb56ca` (gate result), see `docs/superpowers/notes/m1-gate-result.md` for the full writeup. Keep this section and the ledger below current — see "Keeping status current".*

**M0 (Skeleton) is complete. M1 phases 1–2 (Output Contract pipeline + eval gate infrastructure) are merged. Task 14 is complete**: 12 transcripts recorded (10 gate + 2 floor), all 10 gate transcripts labelled with a 4-transcript holdout marked.

**M1 phase 2b is complete — code (tasks 1–6) and the one re-record + score (task 7).** All ten objectives were discarded and re-recorded fresh against the pinned `flexpick-corpus-base` (`f4251ea`), scored once under `1fb56ca`, every transcript stamped `recordedUnder: "1fb56ca"` (recorded and scored under the same commit):

| type | labels | matched | precision | recall |
|---|---|---|---|---|
| `decision_needed` | 10 | 10 | **100.0%** | **100.0%** |
| `evidence` | 30 | 24 | 61.5% | 80.0% |

**The gate does not clear, and phases 3–6 are therefore still closed.** `decision_needed` clears both bars; `evidence` recall (80.0%, up from 66.7%) still falls short, and `evidence` precision (61.5%, down from 80.0%) is a new gap. Tuning-vs-holdout recall gap 19.4% (over 10 points means the corpus is too small, not that the gate passed — and the direction here is the healthy one: holdout outscored tuning, a small-sample artifact given 12 vs 18 evidence labels, not overfitting).

The repair turn (A4) is the headline result: it fired on 9 of 10 objectives (12/40 turns, 30.0%), and **every repair that fired supplied what the turn owed** — zero `missing_expected` violations survive to scoring. The claimed-but-unevidenced failure mode that motivated phase 2b (eight of phase 2a's thirteen missed labels) is fixed. What's left is a different gap: six missed `evidence` labels are all a `kind` mismatch (the agent emitted evidence of the wrong kind, not no evidence), and `evidence` precision is depressed mostly by unlabelled exploration-turn evidence the exhaustive-labelling scheme was never going to predict (design §6, "declined to engineer around"). One live occurrence of a previously-undocumented fence-scanner limitation (an *opening* fence welded to prose) also surfaced, on `health-ready-disclosure`; not fixed, out of phase 2b's scope. Full detail, including the three named-and-declined limitations and the labelling-provenance caveat, is in `docs/superpowers/notes/m1-gate-result.md`.

**Per the plan's exit condition, phase 2b stops here — no second re-record.** Spec §9's timebox conversation is next: this is the third real gate run, and the package built to answer "does the repair turn close the gap" has run and given a real, mixed answer.

Read before touching M1 work, in this order:

- `vadd-spec-final.md` — the authoritative v1.0 spec, FINAL, plus amendments A1–A3 (2026-08-04) and A4 (2026-08-09)
- `docs/superpowers/specs/2026-08-04-m1-contract-machine-gate-design.md` — the approved M1 design
- `docs/superpowers/specs/2026-08-09-m1-phase2b-provenance-repair-design.md` — the approved phase 2b design, with the failure taxonomy behind it
- `docs/superpowers/plans/2026-08-09-m1-phase2b-provenance-repair.md` — the 7-task implementation plan for phase 2b, TDD throughout; **all 7 tasks done**
- `docs/superpowers/notes/m1-gate-result.md` — the phase 2b gate result: the number, the repair-rate/fence-drift detail, the missed-label breakdown, and what design §6 declined to engineer around
- `docs/superpowers/notes/m1-phase12-known-gaps.md` — what phases 1–2 left open, what's since been resolved (profile credentials, the A3 command permission policy, an `execute-task.md` template gap), and what Task 14's real corpus runs found
- `docs/superpowers/notes/m0-known-gaps.md` — what M0 left open, and what M1 inherits by construction
- `docs/superpowers/specs/2026-08-03-m0-skeleton-design.md` — M0's design, including the verification record in §7.1
- `vadd-spec-phase2.md` — Phase 2, which starts only after v1's Definition of Done. One of its items (the managed agent profile) is pulled into M1 by the M1 design.

## Status ledger

Where we are, what's next. Phases are the M1 design's §1.4 build order; 2b is the unplanned insert that the gate's first two real runs forced.

| Phase | Work | State | Evidence |
|---|---|---|---|
| M0 | Skeleton: ACP spike, ports, five tables, debug page | ✅ done | design §7.1; one criterion unmet (no browser render) |
| 1 — Foundation | Agent profile isolation; `AgentEvent` union; fence scanner + validator; prompt contracts; contract events persisted | ✅ done | merged `1f0ac6d` |
| 2 — Corpus + gate | Record + label 12 transcripts; eval harness; iterate prompt and pipeline. **Kill-switch checkpoint** | ⚠️ ran, does not clear | `8e8b385`; superseded by 2b's score |
| 2b — Provenance + repair | Fence-drift violations; `recordedUnder` stamp; A4 repair turn; re-record and score once | ⚠️ **done, does not clear** | `283a1a8`..`1fb56ca`, all 7/7 tasks; `docs/superpowers/notes/m1-gate-result.md` |
| 3 — Machine | Four remaining migrations; XState machine; snapshot persistence; boot rehydration | ⛔ blocked on the gate | — |
| 4 — Verification | Spec resolution + detection; `setup` commands; EvidenceCollector; command permissions | ⛔ blocked (A3's policy already landed, `83aabd8`) | — |
| 5 — Surfaces | Skeleton Focus View; Evidence Panel; `integrate` commit/keep/discard | ⛔ blocked | — |
| 6 — Exit run | One real `flexpick.net` bugfix driven to `done` through green evidence | ⛔ blocked | — |

### Next steps

1. **Spec §9 timebox conversation.** Phase 2b is complete and the gate still fails — `evidence` precision (61.5%) and the tuning-vs-holdout gap (19.4%) are the open items; `decision_needed` clears both bars and `evidence` recall improved to 80.0%. Decide, with `docs/superpowers/notes/m1-gate-result.md` in hand, whether to spend further budget narrowing `evidence` precision (kind-mismatches, exhaustive-label false positives), grow the corpus past ten to close the holdout gap, or invoke §9's timebox and move to phase 3 without a cleared gate. Do not silently start phase 3.

### Keeping status current

At the end of every phase (and after any run that moves the gate number), update in the same commit as the work:

- the **Current state** header date + commit, and the gate table if `pnpm eval` was re-run;
- the phase's row in the **Status ledger**, plus the evidence column (a commit sha, not a claim);
- **Next steps** — delete what's done, promote what's now next;
- the matching plan doc's checkboxes, and `docs/superpowers/notes/m1-phase12-known-gaps.md` if the phase opened or closed a gap.

Never mark a row ✅ from intent. A row is done when a command was run and its output seen — the gate row says "ran, does not clear" for exactly that reason.

The monorepo is real: `packages/core` (ports, Zod schemas, policies), `packages/server` (Fastify, Drizzle, GitManager, AcpAgentPort, EventBus), `packages/web` (Vite + React debug page). Five tables are migrated; M1 adds the other four.

Verified on this machine 2026-08-03: Node v22.20.0, pnpm 11.9.0, git 2.43.0, `@zed-industries/claude-code-acp@0.16.2`, `@zed-industries/agent-client-protocol@0.4.5`. Both ACP packages are pinned exactly (spec §2) — do not bump them casually; M0 found two places where the SDK's types disagree with the adapter's real output.

## The spec is binding

`vadd-spec-final.md` is FINAL. Every choice in §1 (D1–D15) and §2 (stack) is locked. **Deviations require editing the spec file first** — if a task implies a different framework, a different isolation model, telemetry, gamification, an orchestrator role, or anything in §11 ("Explicitly out"), stop and raise it rather than implementing it.

Three amendments exist, all 2026-08-04, all from the M1 design and all recorded in the spec itself: **A1** adds optional `cwd` and `setup` to §6's verification format and extends auto-detection to depth-1 subdirectories; **A2** changes M1's exit repo from Wheelership (no checkout on this machine) to `flexpick.net`; **A3** gives command authorization its own predicate, since §5's low-risk policy governs diffs and says nothing about which commands an agent may run. Follow that pattern for any further deviation: amend the spec in the same commit as the design that justifies it.

Naming is settled: **VADD everywhere** — packages `@vadd/*`, binary `vadd`, state in `~/.vadd/`, fence tag `vadd-event`, repo config `.vadd/config.json`.

## M1 scope

The design fixes several boundaries; don't re-litigate these without reading it.

- **Build order is risk-first.** Contract pipeline → corpus → eval gate, *then* machine, verification, and UI. The gate is spec §9's kill-switch and only has value if it can fire while budget remains. Phases 3–6 start only after the gate clears 90%.
- **The gate measures human-labelled ground truth** — what *should* have surfaced, not what the agent emitted — with the summarizer off, over ten contract transcripts (four held out). Two extra raw transcripts are a floor measurement and never part of the gate.
- **The pipeline validates everything itself.** M0's SDK silently discarded ~a quarter of one session's updates. No code path may turn a parse or validation failure into silence; failures become persisted `contract_violation` events.
- **`AgentPort`'s shape does not change.** M1 adds a transform over `onUpdate`, not new methods.
- **Four additions beyond spec §9's M1 line**, each blocking the exit criterion: the managed agent profile (`CLAUDE_CONFIG_DIR`) — done, `389673b`; the command permission policy (amendment A3) — done, `83aabd8`, ahead of its originally-planned phase 4 slot, once M0's fail-closed-on-Bash gap turned out to block Task 14 directly; `setup` commands and a skeleton Focus View — not started, still phase 4/5 work.

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
