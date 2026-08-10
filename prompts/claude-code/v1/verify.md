---
version: 1
phase: verify
expects: [evidence]
---
Run the verification commands for this objective and report what they produced.

Run every command again now, even if you already ran it during execute-task —
this turn's evidence must be freshly produced, not recalled from earlier.

Commands (report each separately, even if you ran them together):
{{verificationCommands}}

Emit one `evidence` event per command listed above — never fold two
commands' output into one event, even if you ran them chained.

```vadd-event
{"type":"evidence","kind":"lint","status":"warn","headline":"3 warnings, 0 errors","summary":["Two unused imports in ExportController"]}
```

Report failures as failures. A green claim without a matching command output is
not evidence, and the workflow will not accept it.

`summary` holds at most 6 items, each at most 100 characters. A longer item is
rejected and the evidence is lost, so keep each one to a single short clause.
