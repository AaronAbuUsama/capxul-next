// The frozen operations media designs: none. OPERATION_OWNERS (shared/foundation.ts) gives media no
// frozen operation (decision operations.owners: every concept but media, parties, indexing,
// approvals and notices owns at least one). A file is uploaded as a step of the operation that
// uses it (`verify start` in banking) or from the web app (./flows.ts), and the operation that
// points at a file owns its refusal when the file is not admitted (`org create`'s invalid logo).
// Media introduces no refusal and no world.

export {};
