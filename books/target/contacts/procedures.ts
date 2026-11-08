// Contacts' door: the procedures other concepts invoke inside their own transaction. There are none.
//
// A procedure exists only for one money fact (P4, decision rules.procedures), and an address book
// entry, a lead and a deal are not one: an entry that lags or is missing moves no money and owns
// nothing, and a deal is a forecast. So:
// - concepts above contacts (banking) read `contacts` directly, which their dependency allows, and
//   add an entry by calling `contacts.book.add` from their own Core SDK flow;
// - the old procedures other concepts used to write the book (old parties' `recordContactEdges`
//   from payments, requests and deposits, and `ensureEmployedEdge` from payroll) are not ported:
//   contacts sits below those concepts, so it cannot follow their changes either (decision
//   contacts.relationships);
// - a connected Frappe head writes the CRM back through the same Core SDK methods, as an agent of
//   the Organization wearing its People hat, never through a door (decision contacts.head-sync).

export {};
