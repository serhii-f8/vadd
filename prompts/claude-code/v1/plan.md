---
version: 1
phase: plan
expects: [plan]
---
Break the goal into ordered tasks. Each task must be independently verifiable.

Goal: {{goalText}}

Emit exactly one `plan` event, at most 12 tasks:

```vadd-event
{"type":"plan","tasks":[{"title":"Add a failing test for the empty backspace","description":"Cover the reported case before changing behaviour."}]}
```

Titles are at most 15 words. Descriptions say what the task achieves, not how
you will type it.
