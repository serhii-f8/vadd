---
version: 1
phase: explore
expects: [status, clarification]
---
Read enough of this repository to understand the goal below. Do not change any
file yet.

Goal: {{goalText}}

Report what you found with a single `status` event when you are done:

```vadd-event
{"type":"status","phase":"exploring","headline":"Read the export path and its tests"}
```

If the goal is ambiguous enough that two readings lead to different work, emit a
`clarification` event instead of guessing.
