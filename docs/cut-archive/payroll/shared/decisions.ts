// Moved out of the built book by the cut, 10 November 2026, from books/target/shared/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision, type Concept } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import * as v from "./vocabulary.ts";
import * as x from "./external.ts";

export const decision_dependencies_of_payroll = dependencies(f.concept_payroll, {
  access: "the caller of every rpc.",
  parties: "the payee is resolved to a Party and its Safe.",
  indexing: "Agreements' events drive each agreement's process.",
  approvals: "offers, changes, acceptance and collection are approvals from the actor's Safe.",
  organizations: "an agreement is an Organization's, read by its members.",
  board: "an Organization payee's acceptance and collection are Board proposals: the payee is the company Safe (payroll.holder-writes).",
  budgets: "an agreement pays from a budget, whose office holder or anyone above may act on it.",
  books: "a submitted run Capxul computed posts its accrual through books.record-payroll-accrual, and a cancel takes it back (dependencies.books-payroll).",
  documents: "an agreement's terms document is stored at its offer.",
  payments: "a run is paid through payments.prepare-command, and its slips follow payment_transitioned to settled (dependencies.payments-payroll).",
});
