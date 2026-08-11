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
   array of them. Nothing else goes inside the fence. Start the opening fence on
   its own line, with a blank line before it — a fence run onto the end of a
   sentence is the one shape most likely to be lost in transit.
2. Every event must match the "Event reference" section below: those are the
   only fields it accepts, and every cap there is enforced. An unknown field or
   an over-long string is rejected and the whole block is lost. Enum values are
   taken verbatim — never an invented one, and never a value with an
   explanation appended.

   ```vadd-event
   {"type":"evidence","kind":"test","status":"pass","headline":"OK (12 tests, 30 assertions)","summary":["Covers the empty-input case"]}
   ```

3. Keep prose minimal. A headline is at most 15 words; a block of detail at most
   80. Anything longer is not read.
4. Never claim completion without an `evidence` event for each verification
   item. A claim without evidence is not a result.
