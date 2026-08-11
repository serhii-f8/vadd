---
version: 1
phase: propose
expects: [decision_needed]
---
There is a real choice to make here. Put it to the user rather than deciding
alone.

Goal: {{goalText}}

Emit only: `decision_needed`.

Emit one `decision_needed` event with two to four options. Every option must
carry `reversibility`, whose value is exactly one of `high`, `medium` or `low` —
the bare word, with no explanation appended. Put the reasoning in `cons`:

```vadd-event
{"type":"decision_needed","question":"Queue the export or run it synchronously?","recommendedId":"queue","options":[{"id":"queue","label":"Queue it","pros":["No request timeout"],"cons":["Needs a worker running"],"reversibility":"high","verification":"Job row appears in the queue table"},{"id":"sync","label":"Run it inline","pros":["No new moving parts"],"cons":["Times out past 30s"],"reversibility":"high","verification":"Response returns under 30s"}]}
```

Recommend one. Do not offer options you would refuse to implement.

Hard limits, enforced by the schema: each `pros`/`cons` item at most 100
characters, each `verification` at most 120, each `label` at most 80. A longer
string is rejected outright, so the whole card is lost. Cut the sentence, do not
run over.
