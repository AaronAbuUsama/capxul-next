// The holders area: what a department's office holder, or anyone above it, does with the agreements
// its budget pays: offer one, withdraw an offer, change the rate (or cancel a lowering), pause,
// resume and end one, and list them.
//
// Each write is one rpc and one transaction: it checks what Capxul knows and what the chain answers
// now (Budgets' authority and room, the agreement as Agreements has it), then opens the write and the
// approval of the one Agreements call from the holder's own personal Safe (`approvals.open`, the
// intent and the call that carries it are one money fact). It is never a Director proposal. Nothing
// is on chain when it returns; the agreement's process follows the write from there (processes.ts),
// and the SDK flow follows the write to its end (flows.ts).

import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import {
  contract_agreements,
  contract_budgets,
  contract_companies_house_claimer,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_BUDGETED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_org_deployments, table_org_members, table_organizations } from "../organizations/data.ts";
import { table_budgets } from "../budgets/data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { procedure_documents_store } from "./links.ts";
import { machine_agreement, machine_agreement_write, table_agreement_writes, table_agreements } from "./data.ts";
import { AgreementRef, AgreementRow, ChangeInput, Department, EndInput, OfferInput, OrgListInput, Prepared } from "./shapes.ts";
import { Schema } from "effect";

const OPS = "packages/backend/src/payroll/agreements/operations";
const AG = "packages/backend/src/payroll/agreements";

const WHO_HOLDER =
  "A signed-in member of the Organization, person or agent, whose own Safe Budgets authorises on the agreement's budget: " +
  "its office holder or anyone above it. Authority is read from the chain (`Budgets.authorised`), never from a Capxul row.";

/** The errors every holder write can raise: the guard, the gate, the agreement, its state, the chain's answer. */
const HOLDER_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_WRONG_STATE,
  error_ROLE_PERMISSION_DENIED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
] as const;

const HOLDER_WRITE_ABOUT =
  "The caller must hold a Seat in the Organization (ROLE_PERMISSION_DENIED). The `payment-agreements` gate must be on for the Organization (FEATURE_NOT_AVAILABLE). The agreement must be the " +
  "Organization's (INVALID_INPUT), and the caller must have no write of their own still awaiting on it (WRONG_STATE, " +
  "naming its approval). Budgets must authorise the caller's own Safe on the agreement's budget (ROLE_PERMISSION_DENIED " +
  "for any other member, a holder the Directors removed, or the payee). Agreements' `agreementOf` answers the agreement " +
  "as it stands now.";

const OPEN_ABOUT =
  "Then, in one transaction: the write is born `awaiting` (agreement-write.open) and `approvals.open` opens the approval " +
  "of the one Agreements call from the caller's own Safe, with its summary for the approval page; the agreement's " +
  "process is signalled to follow it. Nothing is signed or sent.";

/** A holder write reads and writes the same rows. */
const HOLDER_TOUCHES = {
  reads: [table_org_members, table_feature_flags, table_agreements, table_agreement_writes, table_budgets],
  writes: [table_agreement_writes],
  drives: [machine_agreement_write.t.open],
  invokes: [procedure_approvals_open],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  spans: [],
} as const;

// ── offer ───────────────────────────────────────────────────────────────────────────────────

export const rpc_payroll_holders_offer = defineRpc({
  id: "payroll.holders.offer",
  title: "Prepare an offer from a department's budget",
  about:
    "The caller must hold a Seat in the Organization and its `payment-agreements` gate must be on (ROLE_PERMISSION_DENIED, " +
    "FEATURE_NOT_AVAILABLE). The department is the Organization's budget named " +
    "by key or `dep_…` id (INVALID_INPUT unknown; WRONG_STATE while it has no budget on chain yet). A budget pays in one " +
    "token: a `--token` that is not one of the deployment's admitted tokens (the v4 address book) is TOKEN_NOT_SUPPORTED, " +
    "an admitted one the budget does not pay in TOKEN_NOT_BUDGETED. " +
    "The payee is a person's email (their Party's Safe, or for a mailbox with no account the Safe Companies House's " +
    "`safeAddressFor` gives it) or an Organization's `@handle` (its Party's Safe; never an agent, the payer itself or the " +
    "caller's own Safe), else INVALID_INPUT. The terms: one kind; the release defaults by kind (a salary monthly, a stream " +
    "each second, a retainer by its period, a fixed term daily); days are 00:00 UTC; `--end` is the last day paid and makes " +
    "a fixed term; the offer lapses after 14 days, or at its start or end if sooner. On chain now: Budgets must authorise " +
    "the caller's own Safe (ROLE_PERMISSION_DENIED), the budget must be open with fewer than 64 open agreements " +
    "(WRONG_STATE), and the offer's reservation (the Calendar's figure in the budget's period, or a fixed term's exact pay " +
    "if less) must fit what `leftOf` says is left, to the cent (PAYROLL_BUDGET_EXCEEDED). Then, in one transaction: " +
    "`documents.store` stores the terms document (the paying Organization, the payee and the holder may read it) and " +
    "gives its hash; the agreement is born `prepared` (agreement.prepare), keeping the company Safe and its Roles modifier " +
    "from the deployment, with its offer write (agreement-write.open); and " +
    "`approvals.open` opens the approval of one `Agreements.offer` call from the caller's own Safe. Its birth starts the " +
    "agreement's process.",
  was: [`${OPS}/offer.ts:61`, `${AG}/external/v4-offers.ts:41`, `${AG}/rules/offers.ts:26`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: OfferInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS, error_PAYROLL_BUDGET_EXCEEDED, error_TOKEN_NOT_BUDGETED, error_TOKEN_NOT_SUPPORTED],
  reads: [table_org_members, table_feature_flags, table_organizations, table_org_deployments, table_budgets, table_parties, table_agreements],
  writes: [table_agreements, table_agreement_writes],
  drives: [machine_agreement.t.prepare, machine_agreement_write.t.open],
  invokes: [procedure_documents_store, procedure_approvals_open],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [
    contract_budgets.f.authorised,
    contract_budgets.f.budgetOf,
    contract_budgets.f.leftOf,
    contract_companies_house_claimer.f.safeAddressFor,
    contract_agreements.f.offer,
  ],
  spans: [],
  budget: budget("chain-read"),
});

// ── withdraw, change, pause, resume, end ────────────────────────────────────────────────────

export const rpc_payroll_holders_withdraw = defineRpc({
  id: "payroll.holders.withdraw",
  title: "Prepare the withdrawal of an offer not yet accepted",
  about:
    HOLDER_WRITE_ABOUT +
    " The agreement must be `offered`: accepted, lapsed, withdrawn or not on chain yet is WRONG_STATE, and nothing is " +
    "prepared. " +
    OPEN_ABOUT +
    " Once it lands the reservation frees at once.",
  was: [`${OPS}/withdraw.ts:15`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: AgreementRef,
  output: Prepared,
  errors: [...HOLDER_ERRORS],
  ...HOLDER_TOUCHES,
  chain: [contract_agreements.f.agreementOf, contract_budgets.f.authorised, contract_agreements.f.withdrawOffer],
  budget: budget("chain-read"),
});

export const rpc_payroll_holders_change = defineRpc({
  id: "payroll.holders.change",
  title: "Prepare a rate change, or cancel a waiting lowering",
  about:
    HOLDER_WRITE_ABOUT +
    " The agreement must be accepted, and one with an end date keeps its rate (WRONG_STATE). The rate is given in the " +
    "period it was offered with; another period converts only when exact (a year is 12 months, a week converts to " +
    "neither), the same rate, a `--from` on a raise or in the past is INVALID_INPUT. A raise takes effect now and only " +
    "its difference counts: the difference of the two period figures in the budget's period must fit `leftOf`, which " +
    "counts the room settling the budget frees, as `changeRate` settles first (PAYROLL_BUDGET_EXCEEDED, to the cent). A " +
    "lowering takes effect from `--from`, else 00:00 UTC tomorrow, keeps the budget until then, and is refused while " +
    "another lowering waits (WRONG_STATE, naming it). `cancel` builds `cancelChange` for the waiting lowering " +
    "(WRONG_STATE when none waits). " +
    OPEN_ABOUT,
  was: [`${OPS}/change.ts:24`, `${OPS}/cancel-change.ts:20`, `${AG}/rules.ts:211`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: ChangeInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS, error_PAYROLL_BUDGET_EXCEEDED],
  ...HOLDER_TOUCHES,
  chain: [
    contract_agreements.f.agreementOf,
    contract_budgets.f.authorised,
    contract_budgets.f.budgetOf,
    contract_budgets.f.leftOf,
    contract_agreements.f.changeRate,
    contract_agreements.f.cancelChange,
  ],
  budget: budget("chain-read"),
});

export const rpc_payroll_holders_pause = defineRpc({
  id: "payroll.holders.pause",
  title: "Prepare a pause of a running agreement",
  about:
    HOLDER_WRITE_ABOUT +
    " The agreement must be `active` or `ending`: already paused, not accepted, ended or not on chain yet is WRONG_STATE. " +
    OPEN_ABOUT +
    " Once it lands no pay builds up; earned pay stays collectable and the budget does not change.",
  was: [`${OPS}/pause.ts:15`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: AgreementRef,
  output: Prepared,
  errors: [...HOLDER_ERRORS],
  ...HOLDER_TOUCHES,
  chain: [contract_agreements.f.agreementOf, contract_budgets.f.authorised, contract_agreements.f.pause],
  budget: budget("chain-read"),
});

export const rpc_payroll_holders_resume = defineRpc({
  id: "payroll.holders.resume",
  title: "Prepare the resumption of a paused agreement",
  about:
    HOLDER_WRITE_ABOUT +
    " The agreement must be `paused`: running, ended or not accepted is WRONG_STATE. " +
    OPEN_ABOUT +
    " Once it lands pay builds up again from the block's time, and nothing is paid for the days it was paused.",
  was: [`${OPS}/resume.ts:10`, `${OPS}/pause.ts:15`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: AgreementRef,
  output: Prepared,
  errors: [...HOLDER_ERRORS],
  ...HOLDER_TOUCHES,
  chain: [contract_agreements.f.agreementOf, contract_budgets.f.authorised, contract_agreements.f.resume],
  budget: budget("chain-read"),
});

export const rpc_payroll_holders_end = defineRpc({
  id: "payroll.holders.end",
  title: "Prepare the last day an accepted agreement pays",
  about:
    HOLDER_WRITE_ABOUT +
    " The agreement must be accepted and not ended (WRONG_STATE; an open offer is withdrawn instead). `on` is the last " +
    "day paid, inclusive: pay stops at 00:00 UTC the day after. A day before today, or not a calendar day, is " +
    "INVALID_INPUT; today is not. An end already set, by an earlier end or a fixed term, only moves earlier (WRONG_STATE " +
    "otherwise). " +
    OPEN_ABOUT +
    " Once it lands earned pay stays collectable, and the reservation frees when the end comes.",
  was: [`${OPS}/end.ts:21`, `${AG}/errors.ts:152`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: EndInput,
  output: Prepared,
  errors: [...HOLDER_ERRORS],
  ...HOLDER_TOUCHES,
  chain: [contract_agreements.f.agreementOf, contract_budgets.f.authorised, contract_agreements.f.end],
  budget: budget("chain-read"),
});

// ── the Organization's list ─────────────────────────────────────────────────────────────────

export const rpc_payroll_holders_list = defineRpc({
  id: "payroll.holders.list",
  title: "List an Organization's agreements by department",
  about:
    "The caller must be a member of the Organization (ROLE_PERMISSION_DENIED). `department` is a key or a `dep_…` id " +
    "(INVALID_INPUT when it names none); `status` is one of the nine (INVALID_INPUT). Agreements are grouped by department, " +
    "oldest first. Paused and ended ones show with no status asked for; prepared, abandoned, lapsed and withdrawn ones only " +
    "when their status is asked for. Each agreement's current rate comes from Agreements (`agreementOf`) and each " +
    "department's budget per token from Budgets (`budgetOf`, `leftOf`) as the chain answers now. It reads only: a chain " +
    "that does not answer is PROVIDER_ERROR and no list is made up.",
  was: [`${OPS}/list.ts:20`, `${AG}/rules.ts:88`, "books/as-is/payroll/agreements.ts"],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in member of the Organization, human or agent.",
  input: OrgListInput,
  output: Schema.Struct({ items: Schema.Array(AgreementRow), departments: Schema.Array(Department) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [table_org_members, table_budgets, table_agreements, table_parties],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_agreements.f.agreementOf, contract_budgets.f.budgetOf, contract_budgets.f.leftOf],
  spans: [],
  budget: budget("chain-read"),
});
