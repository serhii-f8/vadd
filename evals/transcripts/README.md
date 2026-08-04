# Transcripts

Recorded agent sessions. M1's kill-switch needs ≥10 golden transcripts, and
those can only come from real runs, so collection starts in M0 (design §1.2 B3).

**Two record shapes live here, and they are not interchangeable.**

`m0-first-session.jsonl` — and everything produced by `pnpm transcript:export`
from here on — is one exported `events` row per line:

```json
{ "id": 38, "objectiveId": "…", "type": "agent_update", "payload": { … }, "createdAt": "…" }
```

`spike-*.jsonl` is the Task 2 ACP handshake spike's raw capture, written by a
throwaway script before the server existed:

```json
{ "kind": "…", "at": "…", "data": { … } }
```

The spike file is kept because it is the only record of the adapter's behaviour
during the handshake investigation that `docs/superpowers/notes/acp-handshake.md`
is written from. Anything consuming this directory programmatically must
discriminate on shape, or filter to `m0-*.jsonl` and later.

## Completeness

Transcripts exported before the fix in `acp-agent-port.ts`
(`relaxNotificationSchema`) are **lossy**: the pinned ACP SDK validated
`session/update` against a strict schema before dispatching and silently dropped
whatever failed, which in practice meant `tool_call_update` records carrying a
non-object `rawOutput` — including tool *failures*. `m0-first-session.jsonl` has
been re-exported since. If you add a transcript, check the server log for
`Error handling notification` before trusting it as an eval seed.
