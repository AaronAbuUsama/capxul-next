// The organizations concept's door: the procedures other concepts invoke inside their own
// transaction (P4). Three: budgets binds an invitation's grants, and payments counts and takes back
// the seats a settled purchase bought (organizations.buy-seats). Everything else a concept above needs from organizations it reads
// (the Organization, its deployment, its Seats, its invitations) or learns from this concept's
// transitions through the outbox (org_setup_transitioned, org_member_transitioned,
// org_invite_transitioned).

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { machine_seat_purchase, table_org_invitations, table_org_seat_purchases, table_organizations } from "./data.ts";

const S = Schema.String;
const Int = Schema.Int;

export const procedure_organizations_bind_invitation_grants = defineProcedure({
  id: "organizations.bind-invitation-grants",
  title: "Bind an invitation's grants to the Board proposal that carries them",
  about:
    "Money fact: an invitation's offered grants (officer hats and allowances, which carry authority over the company's " +
    "money) and the company Safe transaction that carries them on chain are one fact. Budgets invokes it in the " +
    "transaction that opens the Board proposal of an authorizing invitation's grants (`board.propose`), as the second " +
    "step of its `org member invite` flow. It records the Safe transaction's hash and nonce on the invitation, so the " +
    "invitation's process opens the offer only when the chain shows that transaction executed, and cancels it when " +
    "the nonce went to another transaction. If the two disagreed at a commit, an invitee could be offered authority no " +
    "proposal grants, or hold hats no invitation accounts for. Binding the same transaction again is a no-op; another " +
    "transaction, or an invitation that is not authorizing, is WRONG_STATE. It makes no outside call.",
  was: [
    "packages/backend/src/organizations/invitations/writes/phases.ts:55",
    "docs/as-is/archive/organizations/procedures.ts:1007",
    "docs/as-is/archive/organizations/procedures.ts:1042",
  ],
  concept: concept_organizations,
  input: Schema.Struct({ org_id: S, invitation_id: S, safe_tx_hash: S, safe_nonce: S }),
  output: Schema.Struct({ invitation_id: S, bound: Schema.Boolean }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_org_invitations],
  writes: [table_org_invitations],
  drives: [],
  invokes: [],
  emits: [],
});

// ── seat purchases (aaron.buy-seats) ────────────────────────────────────────────────────────

const RULING = "books/target/shared/rulings.ts (aaron.buy-seats)";

export const procedure_organizations_add_bought_seats = defineProcedure({
  id: "organizations.add-bought-seats",
  title: "A settled seat Payment adds the seats it bought",
  about:
    "Money fact: a Payment that bought seats and the seats it bought are one fact: the Organization holds them exactly " +
    "while the chain shows them paid for. Payments invokes it in the transaction that settles a Payment whose source is " +
    "a seat purchase (organizations.buy-seats), passing the Payment, its command, token, amount and settling " +
    "transaction, the buyer and the seats its source names. `org_id` is the paying command's owner, an Organization, " +
    "never one the source names: a company buys seats only for itself. Under the Organization row's lock it raises `seat_limit` by " +
    "the seats, stamps `seat_limit_raised_by` `purchase`, and records the purchase counted (`add`), or counts a returned " +
    "one again (`add_again`). A Payment already counted is a no-op that answers the limit as it stands, so a replayed " +
    "settlement adds nothing twice. An Organization that does not exist, or seats that are not a whole number from 1 to " +
    "1,000, is INVALID_INPUT, a defect in the invoker: payments checked both when it opened the command. It makes no " +
    "outside call.",
  was: [RULING],
  concept: concept_organizations,
  input: Schema.Struct({
    org_id: S,
    payment_id: S,
    command_id: S,
    seats: Int,
    chain_id: Int,
    token_address: S,
    asset: S,
    amount_raw: S,
    bought_by_party_id: S,
    tx_hash: S,
    block_number: Int,
  }),
  output: Schema.Struct({ org_id: S, payment_id: S, seat_limit: Int, added: Schema.Boolean }),
  errors: [error_INVALID_INPUT],
  reads: [table_organizations, table_org_seat_purchases],
  writes: [table_organizations, table_org_seat_purchases],
  drives: [machine_seat_purchase.t.add, machine_seat_purchase.t.add_again],
  invokes: [],
  emits: [],
});

export const procedure_organizations_return_bought_seats = defineProcedure({
  id: "organizations.return-bought-seats",
  title: "A seat Payment a reorg reopened takes its seats back",
  about:
    "Money fact: the same fact undone. A reorg below finality took away the PaymentSent that settled a seat purchase, so " +
    "its seats go with it, in the transaction where payments reopens the Payment and reverses its book fact. Under the " +
    "Organization row's lock it lowers `seat_limit` by the purchase's seats and marks it returned (`take_back`). Seats " +
    "and live offers already past the lowered limit stay; the next offer is refused until the count is under it " +
    "(SEAT_LIMIT_REACHED). A purchase already returned, or none for that Payment, is a no-op. It makes no outside call.",
  was: [RULING],
  concept: concept_organizations,
  input: Schema.Struct({ org_id: S, payment_id: S }),
  output: Schema.Struct({ org_id: S, payment_id: S, seat_limit: Int, returned: Schema.Boolean }),
  errors: [],
  reads: [table_organizations, table_org_seat_purchases],
  writes: [table_organizations, table_org_seat_purchases],
  drives: [machine_seat_purchase.t.take_back],
  invokes: [],
  emits: [],
});
