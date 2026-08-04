---
version: 1
phase: execute-task
expects: [task_result, evidence, failure]
---
Implement this task and nothing else.

Task: {{taskTitle}}
Detail: {{taskDescription}}

Work test-first. When the task is done, emit an `evidence` event for what you
ran and a `task_result` event for the claim it supports:

```vadd-event
{"type":"evidence","kind":"test","status":"pass","headline":"OK (12 tests, 30 assertions)","summary":["Added one case for the empty backspace"]}
```

If you cannot finish, emit a `failure` event with the probable cause instead of
a partial `task_result`.
