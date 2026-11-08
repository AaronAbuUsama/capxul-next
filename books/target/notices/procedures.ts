// Notices' door: the procedures other concepts invoke. There are none, by design.
//
// Nothing depends on notices but devnet (dependencies.notices-top), and devnet only reads the
// delivery records (`dev mail notices`). A notice is never one money fact with another concept's
// write: it may lag its change by seconds and must never roll it back, so every notice starts from
// the outbox, triggered by the transition it tells about (P4, rules.procedures). A procedure here
// would be the case the `notice-in-transaction` rule exists to refuse. Decision notices.no-door.

export {};
