---
version: 1
phase: repair
expects: []
---
That turn's evidence doesn't back its claim: {{missing}}.

Emit one now for work you actually did — a real command you ran and its real
output. Do not invent a result, and do not repeat the whole turn.

```vadd-event
{"type":"evidence","kind":"test","status":"pass","headline":"OK (12 tests, 30 assertions)","summary":["Covers the empty-input case"]}
```

If the work did not happen, emit a `failure` event with the probable cause
instead. A claim with no evidence is not a result.
