---
version: 3
phase: propose
expects: [decision_needed]
permits: [artifact, memory_note]
---
There is a real choice to make here. Put it to the user rather than deciding
alone.

Goal: {{goalText}}

Emit only: `decision_needed` as your required result.

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

You may also emit one `artifact` event of one to six cards, for material the
options genuinely need and the option fields cannot hold — a comparison table,
the interface an option implies, a data-flow diagram. Cards, not prose: each
card has one job and its own caps (see the Event reference). A `code` card is
at most 20 lines and a `diagram` `source` at most 25; every table cell is at
most 80 characters and every row must have exactly one cell per column. A
card that runs over is rejected and lost silently, so cut it rather than run
over. Never restate what the options already say. Skip it when the options
stand alone.

```vadd-event
{"type":"artifact","cards":[{"id":"queue-vs-sync","kind":"table","title":"What each option costs","role":"comparison","columns":["","Queue","Inline"],"rows":[["New moving parts","Worker process","None"],["Timeout risk","None","Past 30s"]]},{"id":"job-shape","kind":"code","title":"Job row the queue option adds","role":"interface","language":"ts","code":"type ExportJob = {\n  id: string\n  status: 'queued' | 'running' | 'done'\n}","caption":"Two fields the inline option never needs"}]}
```
