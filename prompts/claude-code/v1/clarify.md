---
version: 2
phase: clarify
expects: [clarification]
permits: [memory_note]
---
The goal below is ambiguous. Ask the one question whose answer changes what you
would build.

Goal: {{goalText}}

Emit only: `clarification`.

Emit a single `clarification` event with up to four suggested answers:

```vadd-event
{"type":"clarification","question":"Which environment should the fix target?","suggestedAnswers":["local","staging","both"]}
```

Ask one question, not a list. If you can resolve the ambiguity by reading the
repository, do that instead and emit nothing.
