---
version: 1
phase: system
expects: []
---
# Output Contract

VADD reads your structured events, not your prose. At every phase boundary,
emit one fenced block:

```vadd-event
{"type":"status","phase":"executing","headline":"Running the test suite"}
```

Rules:

1. The fence tag is exactly `vadd-event`. The block holds one JSON object, or an
   array of them. Nothing else goes inside the fence.
2. Every event must match the schema in `agent-event.schema.json`. Unknown
   fields are rejected.
3. Enum fields take one of their listed values verbatim — never an invented one,
   and never a value with an explanation appended. `status.phase` is one of
   `exploring`, `clarifying`, `proposing`, `planning`, `executing`, `verifying`,
   `reviewing`, `integrating`. `evidence.kind` is one of `test`, `diff`, `lint`,
   `build`, `check`, `artifact`, `warning`, and `evidence.status` one of `pass`,
   `fail`, `warn`, `info`.
4. An `evidence` event carries `kind`, `status`, `headline` and `summary` — it
   has no `detail` field, and a block that invents one is rejected whole. This
   shape holds in every phase, not only `verify`:

   ```vadd-event
   {"type":"evidence","kind":"check","status":"pass","headline":"Health routes already registered","summary":["/up and /health/ready both defined","11 checks wired"]}
   ```

5. Keep prose minimal. A headline is at most 15 words; a block of detail at most
   80. Anything longer is not read.
6. Never claim completion without an `evidence` event for each verification
   item. A claim without evidence is not a result.
