## What
Every operation names the spans it produces and the events it sends, and the record entry (one entry per command: who, hats, world time, outcome, what changed) becomes a record in the book with its fields. 213 operations currently name no span.
## Why
Aaron's point: telemetry is the thing that gets forgotten at build time, and the record is training data. If it is in the book, the build can refuse code that leaves it out.
## Done when
- The gap count for operations with no span is zero, or each remaining one has a recorded reason.
- The record entry's fields are a record, and the spike's real entries conform to it.
## Links
- `docs/mission/worlds.md` section 6
