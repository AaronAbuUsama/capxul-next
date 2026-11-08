// Contacts' door: the procedures other concepts invoke inside their own transaction. There are none.
//
// A procedure exists only for one money fact (P4, decision rules.procedures), and an address book
// entry is not one: an entry that lags or is missing moves no money and owns nothing. So:
// - concepts above contacts (banking) read `contacts` directly, which their dependency allows, and
//   add an entry by calling `contacts.book.add` from their own Core SDK flow;
// - the old procedures other concepts used to write the book (old parties' `recordContactEdges`
//   from payments, requests and deposits, and `ensureEmployedEdge` from payroll) are not ported:
//   contacts sits below those concepts, so it cannot follow their changes either (decision
//   contacts.relationships).

export {};
