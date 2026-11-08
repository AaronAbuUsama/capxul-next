// Access' door: the procedures other concepts invoke. There are none (decision access.no-procedures).
//
// A procedure writes this concept's tables inside another concept's transaction, and only for one
// money fact (P4, decision rules.procedures). No other concept's money fact writes a principal, a
// session, a grant or a flag. What other concepts need from access is read, not written:
//
// - Who is calling: the runtime resolves each request's bearer through `sessions` or
//   `assistant-grants` before the transaction and hands the rpc a Caller (person_id, kind, Safe,
//   how it signed in, an assistant's scopes). That is the runtime's, like the outbox, not a record.
// - Feature gates: a concept that refuses FEATURE_NOT_AVAILABLE reads `table_feature_flags`
//   (it depends on access, so the read is allowed) through access' one evaluator, and lists the
//   table in its rpc's `reads` and the error in its `errors`.
// - A person's or an agent's Safe: `table_principals.safe_address`.

export {};
