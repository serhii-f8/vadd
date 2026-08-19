# VADD

VADD is a localhost web app that wraps an existing coding agent — Claude Code, via ACP — as
a **comprehension and verification layer**, not an orchestrator and not an agent of its own.
Two ideas drive almost every design decision: you should be able to read 10x less than a raw
agent transcript and still know what happened, and "done" should mean a real evidence set
was checked, not that the agent claimed to be finished.

## Install

```sh
npx @vadd/cli
```

This starts a local server on `http://127.0.0.1:4319/` and opens it in your browser. State
lives entirely on your machine, under `~/.vadd/` (SQLite database, git worktrees, artifacts).

### Prerequisites

- Node.js 22 or newer.
- A Claude Code subscription or an Anthropic API key — VADD drives your existing Claude Code
  installation over ACP; it does not ship or require its own model access.

## First run

1. **Add a project** — point VADD at a local git repository.
2. **Create an objective** — describe a bug or feature in plain language.
3. **Watch the Focus View** — VADD shows structured events (what the agent decided, what it
   changed, what evidence it produced), not a raw log stream.
4. **Review and approve** — plans, task diffs, and decisions surface for your review before
   anything is committed.
5. **Done means proven** — an objective only reaches `done` after a full green evidence set
   (tests, checks, builds) — never on the agent's claim alone.

## Privacy

Zero telemetry, zero outbound network calls, by design — the only network access is your own
Claude Code session talking to Anthropic (or your own API key). Nothing about your code,
prompts, or usage is sent anywhere else.

## Learn more

The full design — every decision and why — lives in [`vadd-spec-final.md`](./vadd-spec-final.md).
