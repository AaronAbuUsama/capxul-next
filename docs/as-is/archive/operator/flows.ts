// The as-is Core SDK flows of the old operator concept (packages/sdk/src/operator/): none. Its two SDK
// methods each forward one rpc, so the operation names the rpc and no flow is booked.
//
// client.system.health(nonce)  → operator.diagnostics.health, a read call (`read: true`, it stops at the
//                                read deadline, CAP-416) (packages/sdk/src/operator/diagnostics.ts:49).
// client.system.clock()        → operator.diagnostics.clock, a read call (packages/sdk/src/operator/diagnostics.ts:64).
//
// Mounted at `client.system` by packages/sdk/src/platform/client/assemble.ts:157. The other operator rows
// (receipts, identities, probes) and every internal function have no SDK method: the acceptance driver,
// the MCP proof scripts, the L4 tenancy test and the devnet call them directly.

export {};
