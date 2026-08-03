# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repo is **pre-implementation** — currently in **M0 (Skeleton)**, spec §9, weeks 1–2. It contains only:

- `vadd-spec-final.md` — the authoritative, locked v1.0 spec (read it before writing any code)
- `docs/superpowers/specs/2026-08-03-m0-skeleton-design.md` — the approved M0 design; read it alongside the spec before touching M0 work
- `package.json` — an npm-init stub (`name: vadd`, no real scripts); the spec calls for a **pnpm workspaces monorepo**, so this stub will be replaced, not extended

There is no source, no build, no test runner, and no lint config. Commands below come from the spec and will only work after the corresponding scaffolding exists. Do not invent additional commands or "common tasks" until they are real.

Verified on this machine 2026-08-03: Node v22.20.0, pnpm 11.9.0, git 2.43.0, `@zed-industries/claude-code-acp@0.16.2`, `@zed-industries/agent-client-protocol@0.4.5`. Pin the two ACP packages exactly (spec §2).

## The spec is binding

`vadd-spec-final.md` is marked FINAL. Every choice in §1 (D1–D15) and §2 (stack) is locked. **Deviations require editing the spec file first** — if a task implies a different framework, a different isolation model, telemetry, gamification, an orchestrator role, or anything in §11 ("Explicitly out"), stop and raise it rather than implementing it.

Naming is settled: **VADD everywhere** — packages `@vadd/*`, binary `vadd`, state in `~/.vadd/`, fence tag `vadd-event`, repo config `.vadd/config.json`. (The directory was briefly named `flowforge`; that name is retired.)

## M0 scope

The M0 design spec fixes three boundaries the spec's one-line M0 summary left open. Don't re-litigate these without reading it:

- **Five tables migrate in M0** — `projects`, `events`, `agent_sessions`, `settings`, and a **reduced `objectives`** (`id, projectId, title, goalText, worktreePath, branchName, status, createdAt, updatedAt`). `objectives` is present because D4 keys worktree paths on `objectiveId`. The other four §3 tables are M1.
- **`AgentPort` is defined in M0** with `update: unknown` raw passthrough. M1 adds the contract pipeline as a transform over `onUpdate` — the interface shape must not change.
- **ACP is bidirectional.** `claude-code-acp` calls back with `session/request_permission` and `fs/*`; unanswered, it hangs on the first file write. M0 auto-approves resolved paths inside the objective's worktree and rejects everything outside.

Deferred out of M0: XState machine, contract pipeline, EvidenceCollector, verification spec resolution, shadcn/ui, `npx` packaging, Playwright.

## What VADD is

A localhost web app (`npx vadd`) that wraps an existing coding agent (v1: Claude Code only, over ACP via Zed's `claude-code-acp` child process). It is a **comprehension + verification layer**, not an agent and not an orchestrator. Two theses drive nearly every design decision:

1. **Read 10× less text** — the UI shows structured events, not log streams. §10 even makes this a unit test: a Level 1 string over 15 words or Level 2 block over 80 words fails a lint on bundled prompt templates.
2. **"Done" means proven, not claimed** — the state machine, not the UI, makes `integrating → done` unreachable without a full green evidence set.

## Architecture that spans files

Three concerns are where the real complexity lives; they are worth understanding together before touching any one of them.

**Output Contract pipeline** (`packages/server/contract`, spec §4). Agents emit ```` ```vadd-event ```` fenced JSON blocks inside their message stream. The pipeline scans for them, parses, validates against the Zod `AgentEvent` discriminated union, and emits. Zod is the single source of truth — JSON Schema is *exported* from it for prompt contracts, so never hand-write the schema twice. Fallback chain on validation failure: optional one-shot Haiku extraction using the exported JSON Schema (flagged `extracted: true`) → otherwise a plain `status` event pointing at the raw view. This pipeline is the product bet; §9 makes an eval-harness score of ≥90% on `decision_needed` and `evidence` extraction a CI gate and an explicit project kill-switch.

**Workflow machine** (`packages/core`, XState v5, spec §5). One machine for Feature/Bug with a Fast Fix shortcut (guard on `mode === "fastfix"` routes `exploring → planning`; verification is *never* skipped). Snapshots persist to `machine_snapshots` on every transition; on boot the server rehydrates all non-terminal objectives and resumes ACP sessions via `session/load` where supported. Guards — not UI checks — enforce the evidence gate. Checkpoints are real git commits (`vadd-checkpoint:` prefix) on the worktree branch; `rollingBack` is `git reset --hard`.

**Evidence + verification** (spec §6). The verification spec resolves in order: repo `.vadd/config.json` → auto-detection (package.json scripts, then composer.json, Makefile, go.mod, Cargo.toml) → per-objective DB overrides (which win). EvidenceCollector runs the commands and reconciles results against `verificationSpec` items; `checks` are satisfied by an agent `evidence` event of kind `check` or a manual user tick.

**Layering rule:** `packages/core` is domain-only — machine, ports, schemas, policies, **no I/O**. All agent communication goes behind the internal `AgentPort` interface; the ACP SDK and the `claude-code-acp` child process are wrapped entirely inside it so v1.1 (Codex) is an adapter swap. Server is Fastify + SSE only (no WebSocket); the frontend mirrors server snapshots and performs **no client-side transitions**.

## Hard constraints

- **Zero telemetry, zero outbound network** with the summarizer key unset — §10 requires a test proving this with the network disabled. The optional Anthropic summarizer uses the *user's own* key; VADD never ships or requires one.
- **Isolation is git worktrees only**, under `~/.vadd/worktrees/<projectId>/<objectiveId>`. No Docker. Worktree lifecycle must be leak-free (`git worktree list` clean after integrate/discard).
- **`strict: true`** TypeScript everywhere; Node 22 LTS (Bun was rejected for `better-sqlite3`/ACP SDK compatibility).
- State lives in `~/.vadd/` — `vadd.db` (SQLite/Drizzle), `artifacts/<objectiveId>/`, `prompts/` (user prompt overrides), `worktrees/`.
- Git operations use a direct CLI wrapper via `execa`, deliberately not `simple-git`.
- Localhost API, no auth (spec §7) — that is intentional, not an oversight.

## Planned commands (post-scaffold)

```
pnpm test                          # Vitest — unit + eval harness
pnpm eval                          # eval harness: precision/recall vs. golden transcripts (M1)
pnpm lint                          # Biome (lint + format; the only such tool)
pnpm transcript:export <objId>     # dump events rows → evals/transcripts/<name>.jsonl
npx vadd                           # packaged entry point → localhost web app (M2)
```

Single Vitest file: `pnpm vitest run <path>`; single test: add `-t "<name>"`. The real-adapter integration test is skipped unless `VADD_E2E=1`. Playwright covers 2–3 smoke E2E tests and lands in M2, not M0.
