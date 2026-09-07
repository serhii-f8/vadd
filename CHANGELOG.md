# Changelog

All notable changes to `@vadd/cli` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows
semantic versioning.

## [Unreleased]

## [0.1.0] — 2026-09-07 — first public release

- Localhost web app wrapping Claude Code (and Codex) over the Agent Client Protocol.
- Output contract: typed agent events validated against a Zod schema, with every parse or
  validation failure persisted as a visible contract violation rather than dropped.
- Workflow machine for standard, Fast Fix and Investigation objectives; per-task checkpoints;
  `done` is unreachable without a complete green evidence set.
- Verification from a per-repository `.vadd/config.json` or auto-detection, run in an isolated
  git worktree per objective, with protected globs enforced on every commit-creating path.
- Focus View, Objective Board, Evidence Panel, daily summary, Quest Map, git console with
  local surgery and user-configured remote operations, clone by URL, cross-session project
  memory, card artifacts, Low Energy Mode.
- Zero telemetry and no outbound network calls of the tool's own; optional user-keyed
  summarizer, off by default.
