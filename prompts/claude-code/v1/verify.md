---
version: 1
phase: verify
expects: [evidence]
---
Run the verification commands for this objective and report what they produced.

Commands: {{verificationCommands}}

Emit one `evidence` event per command, with the real headline from its output:

```vadd-event
{"type":"evidence","kind":"lint","status":"warn","headline":"3 warnings, 0 errors","summary":["Two unused imports in ExportController"]}
```

Report failures as failures. A green claim without a matching command output is
not evidence, and the workflow will not accept it.
