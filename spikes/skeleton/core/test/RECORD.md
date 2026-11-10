# Command record conformance

`books/target/devnet/record-entry.ts` books the nested schema-1 JSON Lines entry. It is deliberately separate from `command-records`, the designed flattened search projection with future agent metadata and epochs. No historical entries are rewritten.

The recorder validates **redacted serialized bytes** at `appendTo`, before append/hash. It keeps extension fields (restore lineage and domain-specific change pointers). Restore's synthetic lineage entry now carries the same required command fields. Existing result truncation, secret scrubbing, append locking and hash chaining remain intact.

Run without a live stack:

```
node --experimental-strip-types --test spikes/skeleton/core/test/record-schema.test.ts
node --experimental-strip-types --test spikes/skeleton/core/test/record-runtime.test.ts
```

The runtime test calls the actual begin/finish/append boundary for success, refusal and failure, checks redaction and hash chaining, and validates the resulting JSON Lines. It needs the spike's `viem` dependency installed; this lane has no spike node_modules, so its first run failed with ERR_MODULE_NOT_FOUND for viem. No live-chain success is claimed. The schema/whole-book telemetry tests run without that dependency: 232 operations, zero no-span and zero state-change-without-event gaps.

Execution spans are explicit on SDK flows and RPC records; existing detailed spans remain. Helpers producing families of RPC records use the same stable `rpc.<id>` naming convention. Event telemetry remains derived from explicit emits and driven transitions (an empty event set on reads is intentional). These declarations are design obligations, not evidence that unbuilt runtime implementations already emit them.
