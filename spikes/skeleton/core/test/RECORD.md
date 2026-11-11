# Command record conformance

`blueprint/devnet/record-entry.ts` books the nested schema-1 JSON Lines entry. It is deliberately separate from `command-records`, the designed flattened search projection with future agent metadata and epochs. No historical entries are rewritten.

The recorder validates **redacted serialized bytes** at `appendTo`, before append/hash. It keeps extension fields (restore lineage and domain-specific change pointers). Restore's synthetic lineage entry now carries the same required command fields. Existing result truncation, secret scrubbing, append locking and hash chaining remain intact.

From the repository root after `pnpm install --frozen-lockfile`, run without a live stack:

```sh
pnpm record:test
```

This uses the root workspace's declared `effect` dependency. The offline recorder path needs no separate spike install or viem. These tests also run in the standard `pnpm test` gate, so missing dependencies or required configuration regressions fail that gate.

The runtime test calls the actual begin/finish/append boundary for success, refusal and failure, checks redaction and hash chaining, and validates the resulting JSON Lines. It sets a temporary state directory, an ephemeral generated test secret and an explicit world before importing config, and restores the environment afterward. The recorder loads chain dependencies only when querying hats for an actor in an organization; this actorless test needs neither viem nor compiled contract artifacts. No mocks or live services are used; no live-chain success is claimed.

Round 3 evidence: `pnpm exec tsc -p packages/blueprint-engine && pnpm test` passed with the record suite included (3 tests, 3 pass, 0 fail). `pnpm exec tsc -p blueprint` passed; book build reported 0 problems and 162 gaps; frozen check reported 0 breaches. No schema or recording behavior changed this round; only test-gate wiring and these instructions changed.

Round 2 evidence: running both tests together passed all 3 tests (0 failed). The runtime test wrote three actual entries with outcomes `ok`, `refused`, `failed`; each decoded against the booked schema, the sensitive result field was redacted, and the three-entry hash chain verified. Telemetry: 232 operations, zero no-span and zero state-change-without-event gaps. Both book typechecks passed; book build reported 0 problems and 162 gaps; frozen check reported 0 breaches.

Execution spans are explicit on SDK flows and RPC records; existing detailed spans remain. Helpers producing families of RPC records use the same stable `rpc.<id>` naming convention. Event telemetry remains derived from explicit emits and driven transitions (an empty event set on reads is intentional). These declarations are design obligations, not evidence that unbuilt runtime implementations already emit them.
