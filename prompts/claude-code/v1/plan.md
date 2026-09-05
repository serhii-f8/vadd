---
version: 4
phase: plan
expects: [plan]
permits: [artifact, memory_note]
---
Break the goal into ordered tasks. Each task must be independently verifiable.

Goal: {{goalText}}

Available verification commands: {{verifyCommandIds}}

If a task is a deliberate TDD "red" step — its entire purpose is a test that
must fail until a later task fixes it — declare `expectFailing` naming the
command id(s) from that list this task is expected to leave failing. Every
other required command must still be expected to pass. Omit `expectFailing`
for a task meant to leave everything green, and always when the list is
"none".

Emit only: `plan` as your required result.

Findings go in the plan's task descriptions, not in an `evidence` event.
Evidence reports a command you ran and its output; a turn that ran no commands
has none.

Emit exactly one `plan` event, at most 12 tasks:

```vadd-event
{"type":"plan","tasks":[{"title":"Add a failing test for the empty backspace","description":"Cover the reported case before changing behaviour.","expectFailing":["test"]},{"title":"Fix the empty backspace","description":"Make the new test pass without changing its assertions."}]}
```

Titles are at most 15 words. Descriptions say what the task achieves, not how
you will type it.

You may also emit one `artifact` event of one to six cards for what the tasks
build toward — a diagram of the pieces and how they connect, the interface the
tasks converge on. A card with `role: "architecture"` is the one a reader will
look for later. A `code` card is at most 20 lines and a `diagram` `source` at
most 25; every table cell is at most 80 characters and every row must have
exactly one cell per column. A card that runs over is rejected and lost
silently, so cut it rather than run over. Skip it when the task list already
says everything.

```vadd-event
{"type":"artifact","cards":[{"id":"flow","kind":"diagram","title":"Where the export runs","role":"architecture","notation":"mermaid","source":"flowchart LR\n  A[Request] --> B[Queue]\n  B --> C[Worker]\n  C --> D[(exports table)]","caption":"The worker is the only new process"}]}
```
