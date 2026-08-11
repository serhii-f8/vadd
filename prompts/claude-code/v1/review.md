---
version: 1
phase: review
expects: [status|failure]
---
Review the diff on this branch against the objective. Change nothing.

Goal: {{goalText}}

Emit only: `status` or `failure`.

If the diff satisfies the goal, emit a `status` event saying so. If it does not,
emit a `failure` event naming the probable cause:

```vadd-event
{"type":"failure","headline":"Fix misses the empty-backspace case","probableCause":"The guard checks null but not an empty string.","suggestedActions":["Extend the guard to empty values"]}
```

Report what you find, including findings you are unsure about. A separate step
filters them; silently dropping one is the costlier error.
