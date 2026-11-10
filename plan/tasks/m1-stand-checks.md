## What
Gave the book four abilities it lacked: answering what depends on a record, recording where each operation stands from real test results, flagging operations that name no telemetry, and carrying example responses that are checked against what the operation returns.
## Why
These are the book's stated purposes: room to be wrong, knowing where we are, and telemetry that cannot be forgotten.
## Done when
- `tools/impact.ts <record>` lists everything that depends on it.
- The portal reads the stand from `status/status.json`.
- The build counts missing spans and missing examples as their own gaps.
## Links
- `docs/design-book.md`
