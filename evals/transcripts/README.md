# Transcripts

Recorded agent sessions. M1's kill-switch needs ≥10 golden transcripts, and
those can only come from real runs, so collection starts in M0 (design §1.2 B3).

## What the scorer reads

**Only the `.jsonl` files at the top level of this directory.**
`packages/server/src/evals/score.ts` lists this directory, requires a matching
`evals/labels/<name>.labels.json` for every file it finds, and refuses to run if
one is missing — or if a label file has no transcript. So membership in the gate
corpus is decided by *where a file sits*, and nothing else.

Two consequences:

- **`archive/` is not read.** Anything in it is kept for the record, not for
  scoring. Subdirectories are never recursed into.
- **A transcript that should not be gated goes in its own directory**, and is
  scored with `pnpm eval --dir <path>`. That is how the two raw no-contract
  "floor" transcripts (design §5.2) are measured without ever entering the
  gate's own number.

```
evals/transcripts/<name>.jsonl          gate corpus — 10 contract transcripts
evals/transcripts/floor/<name>.jsonl    raw no-contract floor, scored separately
evals/transcripts/archive/              kept, never scored
evals/labels/<name>.labels.json         human ground truth for either
```

## The v2 rule

**Every file the harness reads carries `schemaVersion: 2` on every line.**

Everything produced by `pnpm transcript:export` is one exported `events` row per
line, stamped with the transcript schema version:

```json
{ "id": 38, "objectiveId": "…", "type": "agent_update", "payload": { … }, "createdAt": "…", "schemaVersion": 2 }
```

`packages/server/src/evals/transcript.ts`'s `loadTranscript` **refuses**, rather
than normalizes, any record whose `schemaVersion` is missing or below 2. That is
why both files now in `archive/` are there:

- `archive/m0-first-session.jsonl` — the first real M0 session, recorded before
  the prompt contract existed. It is a valid v2 export (re-exported after the
  `relaxNotificationSchema` fix in `acp-agent-port.ts`; the pinned ACP SDK had
  been validating `session/update` against a strict schema before dispatch and
  silently dropping whatever failed — in this session, 6 of 25 updates,
  including a tool failure). It is nonetheless **not gate corpus**: no prompt
  contract was in force when it was recorded, so labelling it would measure the
  contract against a session that never saw it. Keep it as the M0 record.
- `archive/spike-1785774233067.jsonl` — the Task 2 ACP handshake spike's raw
  capture, written by a throwaway script before the server existed:

  ```json
  { "kind": "…", "at": "…", "data": { … } }
  ```

  It has no `schemaVersion` field and a different record shape entirely, and it
  is **kept deliberately** — it is the only record of the adapter's behaviour
  during the investigation that `docs/superpowers/notes/acp-handshake.md` is
  written from. `loadTranscript` refuses it with the same "schemaVersion
  required" error rather than crashing on its shape. Anything consuming this
  directory programmatically should call `loadTranscript` and let it do that
  filtering rather than hand-rolling a shape check.

## Provenance

Every record also carries `recordedUnder`, the repository HEAD at **export**
time. It approximates the code that produced the transcript: exact when a
transcript is exported promptly after recording, wrong if a corpus is
re-exported later from the same database, and unable to express a corpus
recorded *across* a pipeline change — which the 2026-08-09 corpus was, because
two contract fixes landed mid-recording.

`pnpm eval` prints the scoring commit and any mismatch. It never gates on it. A
transcript recorded under older code disagreeing with its own replay is the
expected outcome of a pipeline fix, and the whole point of replaying.
