// Indexing's Core SDK flows: none. The SDK never reads the indexer (components.core-sdk): it calls
// the backend's rpcs, which read indexing's views under row-level security. Indexing owns no rpc,
// so it has nothing for a flow to compose. Decision: indexing.tables-only.

export {};
