---
version: 1
phase: execute-task
expects: [task_result, evidence, failure]
---
Implement this task and nothing else.

Task: {{taskTitle}}
Detail: {{taskDescription}}

Work test-first. When the task is done, emit an `evidence` event for what you
ran, then a `task_result` event for the claim it supports. `taskId` is a short
stable slug for this task (derive it from the title; keep it the same if you
emit more than one `task_result` for the same task). `evidenceRefs` lists the
`evidence` event(s) that back the claim:

```vadd-event
{"type":"evidence","kind":"test","status":"pass","headline":"OK (12 tests, 30 assertions)","summary":["Added one case for the empty backspace"]}
```

```vadd-event
{"type":"task_result","taskId":"empty-backspace-fix","claim":"Empty backspace no longer throws","evidenceRefs":["OK (12 tests, 30 assertions)"]}
```

`summary` holds at most 6 items, each at most 100 characters. A longer item is
rejected and the evidence is lost, so keep each one to a single short clause.

If you cannot finish, emit a `failure` event with the probable cause instead of
a partial `task_result`.
