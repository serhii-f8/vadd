# Transcripts

Recorded agent sessions. M1's kill-switch needs ≥10 golden transcripts, and
those can only come from real runs, so collection starts in M0 (design §1.2 B3).

**The v2 rule: every file the harness reads carries `schemaVersion: 2` on every
line.**

`m0-first-session.jsonl` — and everything produced by `pnpm transcript:export`
from here on — is one exported `events` row per line, stamped with the
transcript schema version:

```json
{ "id": 38, "objectiveId": "…", "type": "agent_update", "payload": { … }, "createdAt": "…", "schemaVersion": 2 }
```

`packages/server/src/evals/transcript.ts`'s `loadTranscript` **refuses**, rather
than normalizes, any record whose `schemaVersion` is missing or below 2. That
covers two things in this directory:

- Any export taken before the fix in `acp-agent-port.ts`
  (`relaxNotificationSchema`): the pinned ACP SDK validated `session/update`
  against a strict schema before dispatching and silently dropped whatever
  failed — in one recorded session, 6 of 25 updates, including a tool failure.
  A transcript exported before that fix is lossy in exactly the dimension the
  eval harness measures, so the loader treats it as unusable rather than
  quietly moving the gate. `m0-first-session.jsonl` has been re-exported at v2
  since.
- `spike-1785774233067.jsonl`, the Task 2 ACP handshake spike's raw capture,
  written by a throwaway script before the server existed:

  ```json
  { "kind": "…", "at": "…", "data": { … } }
  ```

  This file has no `schemaVersion` field at all and a completely different
  record shape, and it is **kept deliberately** — it is the only record of the
  adapter's behaviour during the handshake investigation that
  `docs/superpowers/notes/acp-handshake.md` is written from. It is **not
  loadable by the eval harness by design**; `loadTranscript` refuses it with
  the same "schemaVersion required" error rather than crashing on its shape.
  Anything consuming this directory programmatically should call
  `loadTranscript` and let it do that filtering rather than hand-rolling a
  shape check.
