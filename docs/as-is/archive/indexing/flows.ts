// The as-is Core SDK flows of the old indexing concept (packages/sdk/src/indexing/): none. The folder holds
// no `client.*` method: it is the `IndexerReadPort` (port.ts:268) and its Ponder adapter
// (ponder/adapter.ts), which reads the Ponder read model directly over SQL and SSE, with a 30-second
// deadline on one-shot reads (indexing/README.md:24). Other SDK folders read through it (activity,
// holdings, books) under their own methods; those flows belong to the concepts that mount them.
//
// No SDK method calls an indexing backend function: every one is internal and cron-driven.

export {};
