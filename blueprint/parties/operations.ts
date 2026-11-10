// The frozen operations parties designs: none. OPERATION_OWNERS (shared/foundation.ts) gives
// parties no frozen operation: every command that names a counterparty (`payment send`,
// `contact add`, `org member invite`, `agent sweep --to`, ...) is owned by the concept whose record
// it writes, which resolves the counterparty through `parties.resolve-recipient` or by reading
// `parties`. Parties' own rpcs serve the web app's setup page through ./flows.ts.
// Decision: parties.no-operations.

export {};
