// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/procedures.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import {
  machine_fde_payment,
  machine_org_fde,
  machine_seat_purchase,
  table_org_fde_payments,
  table_org_fdes,
  table_org_invitations,
  table_org_seat_purchases,
  table_organizations,
} from "./data.ts";

export const procedure_organizations_extend_fde_hosting = defineProcedure({
  id: "organizations.extend-fde-hosting",
  title: "A settled hosting Payment moves the FDE's paid-through day on",
  about:
    "Money fact: a Payment that paid for the hosted FDE and the months of hosting it bought are one fact: the " +
    "Organization's FDE is paid for exactly while the chain shows those months paid. Payments invokes it in the " +
    "transaction that settles a Payment whose source is FDE hosting (`org fde pay`, organizations.fde-hosting), passing " +
    "the Payment, its command, token, amount and settling transaction, the payer and the months its source names. " +
    "`org_id` is the paying command's owner, never one the source names: an Organization pays only for its own FDE. " +
    "Under the hosting row's lock it records the payment counted (`add`, or `add_again` for a returned one) and moves " +
    "`paid_through` on by the months, in calendar months in the Organization's time zone, from the later of " +
    "`paid_through` and the settlement's now, so a lapse is never charged, and records both instants on the payment; a " +
    "running or due hosting is extended (`extend`), a paused one woken (`wake`), which its process then resumes on the " +
    "host, and a resuming one only has `paid_through` moved. A retired hosting still records the months and moves " +
    "nothing else. A Payment already counted is a no-op that answers the hosting as it " +
    "stands, so a replayed settlement adds nothing twice. No hosting for the Organization, or months that are not a " +
    "whole number from 1 to 12, is INVALID_INPUT, a defect in the invoker: payments checked both when it opened the " +
    "command. It makes no outside call.",
  was: [HOSTING],
  concept: concept_organizations,
  input: Schema.Struct({
    org_id: S,
    payment_id: S,
    command_id: S,
    months: Int,
    chain_id: Int,
    token_address: S,
    asset: S,
    amount_raw: S,
    paid_by_party_id: S,
    tx_hash: S,
    block_number: Int,
  }),
  output: Schema.Struct({ org_id: S, payment_id: S, paid_through: Schema.NullOr(Int), added: Schema.Boolean }),
  errors: [error_INVALID_INPUT],
  reads: [table_org_fdes, table_org_fde_payments, table_organizations],
  writes: [table_org_fdes, table_org_fde_payments],
  drives: [machine_fde_payment.t.add, machine_fde_payment.t.add_again, machine_org_fde.t.extend, machine_org_fde.t.wake],
  invokes: [],
  emits: [],
});

export const procedure_organizations_return_fde_hosting = defineProcedure({
  id: "organizations.return-fde-hosting",
  title: "A hosting Payment a reorg reopened takes its months back",
  about:
    "Money fact: the same fact undone. A reorg below finality took away the PaymentSent that settled a hosting payment, " +
    "so its months go with it, in the transaction where payments reopens the Payment and reverses its book fact. Under " +
    "the hosting row's lock it moves `paid_through` back by exactly the span that payment's count added " +
    "(`paid_through_after` less `paid_through_before`), whatever was counted since, and marks it returned (`take_back`); " +
    "the hosting's process, woken by that transition, falls due or pauses at once if the new `paid_through` says so. A " +
    "payment already returned, or none for that Payment, is a no-op. It makes no outside call.",
  was: [HOSTING],
  concept: concept_organizations,
  input: Schema.Struct({ org_id: S, payment_id: S }),
  output: Schema.Struct({ org_id: S, payment_id: S, paid_through: Schema.NullOr(Int), returned: Schema.Boolean }),
  errors: [],
  reads: [table_org_fdes, table_org_fde_payments],
  writes: [table_org_fdes, table_org_fde_payments],
  drives: [machine_fde_payment.t.take_back],
  invokes: [],
  emits: [],
});
