// The frozen operations indexing designs: none. OPERATION_OWNERS (shared/foundation.ts) gives
// indexing no frozen operation (decision operations.owners: every concept but media, parties,
// indexing, approvals and notices owns at least one). Every command that shows a chain fact (a
// balance, a hat, a budget, an agreement, an escrow) is owned by the concept whose noun it shows,
// and that concept's rpc reads indexing's views. Decision: indexing.tables-only.

export {};
