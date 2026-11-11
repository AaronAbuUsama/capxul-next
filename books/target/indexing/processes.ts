// Indexing's durable processes: none (shared decision concepts.indexing). Ponder follows the chain
// and handles reorgs (indexing.reorgs-are-ponders). Every concept that reacts to a chain fact does
// so in its own workflow, triggered by the chain event (`contract_x.e.<Event>`). The old drift
// reconcile goes because nothing copies chain rows any more, and the added-token scan is books'
// (concepts.books-token-scan). Decision: indexing.tables-only.

export {};
