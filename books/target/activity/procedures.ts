// Activity's door: no procedures (decision activity.no-procedures).
//
// A procedure is the only way another concept writes this concept's tables, and only for a write
// that is one money fact with its invoker's (rules.procedures). Nothing reads or writes activity
// back: it is the read model at the top of the map (concepts.activity), and its one table, the
// change log, is appended by its own workflows from payments' transitions through the outbox,
// because a change log may lag its Payment by a second and is never part of a money fact.

export {};
