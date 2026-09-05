---
version: 3
phase: verify
expects: [evidence]
permits: [memory_note]
---
VADD has already run this objective's verification commands and recorded their
results. Do not run them again. What they found:

{{commandResults}}

Judge each acceptance check below against the work as it stands, and report one
`evidence` event per check.

Checks:
{{verificationChecks}}

Emit only: `evidence`.

Set `kind` to `check`, and `checkId` to the id shown beside the check. A check
whose id you omit is counted as unsatisfied.

```vadd-event
{"type":"evidence","kind":"check","checkId":"check-0","status":"pass","headline":"Reproduced by a failing-then-passing test","summary":["ExportTest covers the regression"]}
```

Report an unmet check as `"status":"fail"`. A pass you cannot point at evidence
for is not a pass, and the workflow will not accept it.

`summary` holds at most 6 items, each at most 100 characters.
