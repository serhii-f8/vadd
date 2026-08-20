---
version: 1
phase: execute-task-investigation
expects: [task_result|failure, evidence|failure]
---
Investigate. Do not change any code — this objective ends in a report, not a
diff.

Task: {{taskTitle}}
Detail: {{taskDescription}}

Emit only: `evidence`, `task_result`, or `failure`.

Read what you need to answer this task, then emit an `evidence` event citing
what you actually consulted — a file:line, a command's real output, never a
guess — and a `task_result` event whose `claim` states what you found.
`taskId` is a short stable slug for this task (derive it from the title; keep
it the same if you emit more than one `task_result` for the same task).
`evidenceRefs` lists the `evidence` event(s) that back the claim:

```vadd-event
{"type":"evidence","kind":"check","status":"pass","headline":"Confirmed in auth.ts:42","summary":["Session tokens use a 30-minute TTL, not 24 hours as assumed"]}
```

```vadd-event
{"type":"task_result","taskId":"session-ttl","claim":"Session tokens expire after 30 minutes","evidenceRefs":["Confirmed in auth.ts:42"]}
```

`summary` holds at most 6 items, each at most 100 characters. A longer item is
rejected and the evidence is lost, so keep each one to a single short clause.

If you cannot answer, emit a `failure` event instead of a guessed
`task_result`. It carries `probableCause` and `suggestedActions` — not
`summary`:

```vadd-event
{"type":"failure","headline":"Cannot determine the answer","probableCause":"The relevant service has no logs retained past 7 days.","suggestedActions":["Ask the user whether an external log archive exists"]}
```
