// The approvals concept's operation records: none. OPERATION_OWNERS (shared/foundation.ts) gives
// approvals no frozen operation (decision operations.owners: every concept but media, parties,
// indexing and approvals owns at least one). Every command a person or an agent signs is owned by
// the concept whose intent it carries, and its flow composes approvals' rpcs; `dev approve` is
// devnet's. Decision `approvals.no-operations` records how approvals' rpcs are reached instead.

export {};
