// Requests' door: the procedures other concepts invoke inside their own transaction. There are none.
//
// A procedure exists only for one money fact written by a concept below the writer (P4, decision
// rules.procedures). Nothing depends on requests but notices, and notices only reads a request and
// follows `request_transitioned` through the outbox. The old door is not ported (decision
// requests.no-door):
// - the birth identities and registered preparations payments called back into
//   (`prepareConfirmedRequestInTx`, `invoiceBirthIdentity`, `recordBudgetSettlementInTx`, …): requests now
//   births its payment through `payments.prepare-command`, and its paid state follows payments' `settle`;
// - the bank deposit reads and `matchBankDepositInTx` banking called: requests owns `bank match` and marks the
//   deposit through `banking.match-deposit`;
// - the document read access and display context documents asked for: a document's participants are
//   given when requests stores it through `documents.store`;
// - the person-reference read an operator purge asked for: no frozen operation purges a person.
//
// Requests invokes, from its rpcs and workflows: `payments.prepare-command`, `banking.match-deposit` and
// `documents.store`.

export {};
