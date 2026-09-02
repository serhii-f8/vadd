---
version: 2
phase: explore
expects: [status|clarification]
permits: [memory_note]
---
Read enough of this repository to understand the goal below. Do not change any
file yet.

Goal: {{goalText}}

{{projectMemory}}

Emit only: `status` or `clarification` as your required result.

You may also emit an optional `memory_note` event alongside it if you learn
something about this project worth remembering for a future, unrelated
objective — a structural fact, or a real gotcha. Not required every turn.

Findings go in the headline, not in an `evidence` event. Evidence reports a
command you ran and its output; a turn that ran no commands has none.

Report what you found with a single `status` event when you are done:

```vadd-event
{"type":"status","phase":"exploring","headline":"Read the export path and its tests"}
```

If the goal is ambiguous enough that two readings lead to different work, emit a
`clarification` event instead of guessing.
