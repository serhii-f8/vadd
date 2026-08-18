---
version: 1
phase: plan
expects: [plan]
---
Break the goal into ordered tasks. Each task must be independently verifiable.

Goal: {{goalText}}

Available verification commands: {{verifyCommandIds}}

If a task is a deliberate TDD "red" step — its entire purpose is a test that
must fail until a later task fixes it — declare `expectFailing` naming the
command id(s) from that list this task is expected to leave failing. Every
other required command must still be expected to pass. Omit `expectFailing`
for a task meant to leave everything green.

Emit only: `plan`.

Findings go in the plan's task descriptions, not in an `evidence` event.
Evidence reports a command you ran and its output; a turn that ran no commands
has none.

Emit exactly one `plan` event, at most 12 tasks:

```vadd-event
{"type":"plan","tasks":[{"title":"Add a failing test for the empty backspace","description":"Cover the reported case before changing behaviour.","expectFailing":["test"]},{"title":"Fix the empty backspace","description":"Make the new test pass without changing its assertions."}]}
```

Titles are at most 15 words. Descriptions say what the task achieves, not how
you will type it.
