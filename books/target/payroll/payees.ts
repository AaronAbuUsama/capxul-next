// The payees area: what the payee does with the agreements that pay its Safe: read them, accept an
// offer at its exact terms, and collect what has been released. The payee is a person (their own
// personal Safe) or, with `--org`, an Organization, whose Safe acts through a Board proposal.
//
// A write is one rpc and one transaction: the checks, then the write and what carries it, the
// approval of one Agreements call from the payee's own Safe (`approvals.open`) or the Board proposal
// of that call on the payee Organization's Safe (`board.propose`). No gate applies to a payee: with
// payment agreements off, a payee can still accept and collect what was offered.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { contract_agreements, contract_erc20, contract_roles, integration_chain_rpc } from "../shared/external.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PAYER_BALANCE_TOO_LOW,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_agreement_write, table_agreement_writes, table_agreements } from "./data.ts";
import { AcceptInput, Agreement, AgreementRow, NothingReleased, PayeeListInput, PayeeRef, Prepared, PreparedCollection } from "./shapes.ts";

const OPS = "packages/backend/src/payroll/agreements/operations";
const AG = "packages/backend/src/payroll/agreements";

const WHO_PAYEE =
  "A signed-in person or agent the agreement pays at its own Safe. With `--org`, a Director of the payee Organization, " +
  "whose own approval is the Board proposal's first.";

const PAYEE_ABOUT =
  "The agreement is found by its `ag_` id among those that pay the payee's Safe: the caller's own, or with `orgId` the " +
  "payee Organization's (INVALID_INPUT for an unknown id, and for a prepared or abandoned offer, which is not the payee's " +
  "to see). One that pays another Safe is ROLE_PERMISSION_DENIED, naming whom, including for the holder who offered it. " +
  "A write of the same Safe still awaiting on it is WRONG_STATE.";

const CARRY_ABOUT =
  "Then, in one transaction: the write is born `awaiting` (agreement-write.open) and, without `orgId`, `approvals.open` " +
  "opens the approval of the one call from the payee's own Safe; with `orgId`, `board.propose` opens the Board proposal " +
  "of that call from the payee Organization's Safe at its next nonce, with the caller's own approval as the first " +
  "Director's (a caller who is not a Director is refused there). The agreement's process is signalled to follow it.";

const PAYEE_WRITE_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_WRONG_STATE,
  error_ROLE_PERMISSION_DENIED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
] as const;

const READ_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_ROLE_PERMISSION_DENIED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
] as const;

// ── writes ──────────────────────────────────────────────────────────────────────────────────

export const rpc_payroll_payees_accept = defineRpc({
  id: "payroll.payees.accept",
  title: "Prepare the payee's acceptance of an offer at its exact terms",
  about:
    PAYEE_ABOUT +
    " The offer must be open: lapsed (naming its expiry), withdrawn or already accepted is WRONG_STATE, and the message " +
    "says which. A pinned `termsHash`, in any letter case, must be the offer's (INVALID_INPUT on `termsHash`, before " +
    "anything is signed); without one the call pins the terms the offer has now. `agreementOf` confirms the offer is " +
    "still open on chain. The call is `Agreements.accept(id, termsHash)`. " +
    CARRY_ABOUT,
  was: [`${OPS}/accept.ts:23`, `${OPS}/organization-accept.ts:25`, `${AG}/guards.ts:221`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: WHO_PAYEE,
  input: AcceptInput,
  output: Prepared,
  errors: [...PAYEE_WRITE_ERRORS],
  reads: [table_agreements, table_agreement_writes, table_organizations],
  writes: [table_agreement_writes],
  drives: [machine_agreement_write.t.open],
  invokes: [procedure_approvals_open, procedure_board_propose],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_agreements.f.agreementOf, contract_agreements.f.accept],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_payroll_payees_collect = defineRpc({
  id: "payroll.payees.collect",
  title: "Prepare the payee's collection of everything released",
  about:
    PAYEE_ABOUT +
    " The agreement must be accepted: `active`, `paused`, `ending` or `ended` (WRONG_STATE for an offer not accepted or " +
    "withdrawn; an earlier collection still awaiting blocks the next). `availableOf` answers what is released: nothing " +
    "returns `nothing_released` with the next release, and nothing is signed or stored. Otherwise the payer's funds are " +
    "read before anything is signed: the company Safe's balance of the token (PAYER_BALANCE_TOO_LOW below the amount) and " +
    "what the token's payout ceiling has left on the payout role (Roles' `allowances`, on the Roles modifier organizations' " +
    "deployment names; ROLE_PERMISSION_DENIED naming what is left, as during a freeze). The pay stays owed either way. A release " +
    "larger than the ceiling can ever hold is collected up to it and the rest stays owed for the next collection. The " +
    "window runs from where the last collection ended. With the payer's `payslip-preview` gate on, the payslip comes " +
    "with it. The call is `Agreements.collect(id, amount)`, which Budgets pays from the reservation (kind 4). " +
    CARRY_ABOUT,
  was: [`${OPS}/collect.ts:40`, `${OPS}/collect.ts:82`, `${OPS}/organization-collect.ts:24`, `${AG}/external/v4-funds.ts:22`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: WHO_PAYEE,
  input: PayeeRef,
  output: Schema.Union([PreparedCollection, NothingReleased]),
  errors: [...PAYEE_WRITE_ERRORS, error_PAYER_BALANCE_TOO_LOW],
  reads: [table_agreements, table_agreement_writes, table_organizations, table_org_deployments, table_feature_flags],
  writes: [table_agreement_writes],
  drives: [machine_agreement_write.t.open],
  invokes: [procedure_approvals_open, procedure_board_propose],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_chain_rpc.c.getBlock],
  chain: [
    contract_agreements.f.agreementOf,
    contract_agreements.f.availableOf,
    contract_erc20.f.balanceOf,
    contract_roles.f.allowances,
    contract_agreements.f.collect,
  ],
  spans: [],
  budget: budget("chain-read"),
});

// ── reads ───────────────────────────────────────────────────────────────────────────────────

export const rpc_payroll_payees_list = defineRpc({
  id: "payroll.payees.list",
  title: "List the agreements that pay you, from every Organization",
  about:
    "The agreements that pay the caller's own Safe, or with `orgId` (the caller a member of that Organization, else " +
    "ROLE_PERMISSION_DENIED) its Safe, from every payer, newest first. `status` is one of the nine (INVALID_INPUT). Lapsed " +
    "and withdrawn offers show only when their status is asked for; prepared and abandoned ones never, as no holder signed " +
    "them. Each is read from Agreements as it stands now (`agreementOf`, `availableOf`, the chain's time): what the payee " +
    "earned, can collect and collected, and when the next release lands, with the next command to run (accept an open " +
    "offer, collect released pay). It reads only: a chain that does not answer is PROVIDER_ERROR, and no list is made up.",
  was: [`${OPS}/mine.ts:17`, `${OPS}/organization-received.ts:16`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in person or agent, for what pays its own Safe; with `--org`, a member of that Organization.",
  input: PayeeListInput,
  output: Schema.Struct({ items: Schema.Array(AgreementRow) }),
  errors: [...READ_ERRORS],
  reads: [table_agreements, table_org_members, table_organizations, table_parties],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_chain_rpc.c.getBlock],
  chain: [contract_agreements.f.agreementOf, contract_agreements.f.availableOf],
  spans: [],
  budget: budget("chain-read"),
});

export const rpc_payroll_payees_show = defineRpc({
  id: "payroll.payees.show",
  title: "Show one agreement or offer that pays you",
  about:
    "An id that is not `ag_` and a ULID, or names no agreement the payee may see (a prepared or abandoned offer included), " +
    "is INVALID_INPUT; one that pays another Safe is ROLE_PERMISSION_DENIED, the holder who offered it included. Who pays " +
    "(the Organization, its Safe and department), the kind, status, rate and release, the terms document and its hash (the " +
    "value an acceptance pins); for an accepted agreement, earned, collectable, collected and the next release, read from " +
    "Agreements now; and the next command. A lapsed or withdrawn offer is still read by its id. Nothing is stored.",
  was: [`${OPS}/show.ts:13`, `${OPS}/organization-show.ts:14`, `${AG}/guards.ts:204`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: "The payee, a signed-in person or agent; with `--org`, a member of the payee Organization.",
  input: PayeeRef,
  output: Schema.Struct({ agreement: Agreement, next: Schema.NullOr(Schema.Array(Schema.String)) }),
  errors: [...READ_ERRORS],
  reads: [table_agreements, table_org_members, table_organizations, table_parties],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract, integration_chain_rpc.c.getBlock],
  chain: [contract_agreements.f.agreementOf, contract_agreements.f.availableOf],
  spans: [],
  budget: budget("chain-read"),
});
