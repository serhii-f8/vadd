---
version: 1
phase: repair
expects: []
---
That turn owes {{missing}}.

Emit one now for work you actually did — a real command you ran and its real
output. Do not invent a result, and do not repeat the whole turn.

If a block you already sent was rejected, the reason is listed at the end of
this message. Fix that block and send it again; do not replace it with a
different event type.

```vadd-event
{"type":"evidence","kind":"test","status":"pass","headline":"OK (12 tests, 30 assertions)","summary":["Covers the empty-input case"]}
```

If the work did not happen, emit a `failure` event with the probable cause
instead. A claim with no evidence is not a result.
