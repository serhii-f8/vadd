# Labels

Human ground truth: **what should have surfaced to the user**, annotated
independently of what the agent actually emitted (design §5.1). One file per
transcript, named `<transcript-name>.labels.json`.

This directory is empty of labels until Task 14 fills it. `pnpm eval` fails
until then, which is correct — an empty corpus must not read PASS.

```json
{
  "schemaVersion": 1,
  "transcript": "flexpick-bug-042",
  "holdout": false,
  "labels": [
    {
      "turn": 3,
      "type": "decision_needed",
      "key": "queue-vs-sync",
      "match": { "question": "(?i)queue|synchronous" },
      "note": "Agent chose async dispatch without asking; the user should have decided."
    },
    {
      "turn": 5,
      "type": "evidence",
      "key": "phpunit",
      "match": { "kind": "test", "status": "pass", "headline": "(?i)\\d+ (tests?|assertions)" }
    }
  ]
}
```

Rules the loader enforces, so a mistake is an error rather than a lost point:

- **`turn`** is the 1-based ordinal of the prompt turn — turn *n* spans every
  update between the *n*th `prompt_sent` and its terminal event. A `turn`
  outside the transcript's range is rejected; unchecked it would look exactly
  like the agent failing to emit.
- **`key`** is unique within the file. It is not used in matching; it is how
  `pnpm eval` names a miss so you can find it.
- **`match`** values are JavaScript regexes, with one addition: a **single
  leading `(?i)`** makes the pattern case-insensitive. That is the only inline
  flag supported, and `(?i)` anywhere else is rejected.
- **`kind` and `status` are the exceptions — they compare exactly, not as
  regexes**, and are validated against the schema's enums at load time
  (`kind`: test, diff, lint, build, check, artifact, warning; `status`: pass,
  fail, warn, info). `"status": "(?i)pass"` is an error, not a label that
  quietly never matches.
- A `match` field the event does not carry simply fails to match (design §5.3).
- **`holdout`** marks the four contract transcripts held out while tuning
  (design §5.6). Both subsets must be non-empty or the gate fails: with an empty
  holdout the tuning-vs-holdout gap is arithmetically incapable of exceeding
  10 points, so the overfitting alarm could never fire.

Labels are **exhaustive** for `decision_needed` and `evidence`: any emission of
those types matching no label is counted as a false positive. That is what
forces a label to mean "should have surfaced" rather than "did surface".
