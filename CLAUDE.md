# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

**M0 (Skeleton) is complete; M1 (Contract + Machine + Gate) is designed and not yet started.**

Read before touching M1 work, in this order:

- `vadd-spec-final.md` — the authoritative v1.0 spec, FINAL, plus amendments A1–A3 dated 2026-08-04
- `docs/superpowers/specs/2026-08-04-m1-contract-machine-gate-design.md` — the approved M1 design
- `docs/superpowers/notes/m0-known-gaps.md` — what M0 left open, and what M1 inherits by construction
- `docs/superpowers/specs/2026-08-03-m0-skeleton-design.md` — M0's design, including the verification record in §7.1
- `vadd-spec-phase2.md` — Phase 2, which starts only after v1's Definition of Done. One of its items (the managed agent profile) is pulled into M1 by the M1 design.

The monorepo is real: `packages/core` (ports, Zod schemas), `packages/server` (Fastify, Drizzle, GitManager, AcpAgentPort, EventBus), `packages/web` (Vite + React debug page). Five tables are migrated; M1 adds the other four.

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
- **Four additions beyond spec §9's M1 line**, each blocking the exit criterion: the managed agent profile (`CLAUDE_CONFIG_DIR`), the command permission policy, `setup` commands, and a skeleton Focus View.

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
- **The permission policy denies every path-less tool.** `Bash`, `BashOutput`, `KillShell` carry no `locations` and no path-bearing `rawInput`, so they hit the fail-closed branch. M1 amendment A3 adds the command predicate; do not try to reach commands by extending the path predicate.
- **`requestPermission.toolCall.locations` is often absent**, even when the earlier `tool_call` notification for the same `toolCallId` carried them. Paths come from three sources, and an empty path set must fail closed — `[].every()` returns `true`.
- **An allow is granted once.** `allow_always` maps to `acceptEdits` in this adapter, which bypasses `requestPermission` for the rest of the session and would silently disable the policy.
- **`pnpm dev` does not forward signals.** `Ctrl-C` signals the whole process group and is fine; `kill %1` orphans the server, Vite, and any adapter.
- **Transcripts have two incompatible record shapes**, and anything exported before the dropped-update fix is lossy. See `evals/transcripts/README.md`; the M1 loader discriminates on `schemaVersion` and refuses pre-fix exports.
- **No browser automation exists in this environment.** The debug page has never been rendered in a browser — M0's one unmet exit criterion. Verify React changes by hand and say so plainly.

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

Single Vitest file: `pnpm vitest run <path>`; single test: add `-t "<name>"`. The real-adapter integration test is skipped unless `VADD_E2E=1`. `pnpm eval` does not exist yet — it lands in M1 phase 2.
