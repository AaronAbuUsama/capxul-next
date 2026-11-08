// The eleven frozen operations payroll owns (OPERATION_OWNERS: area payroll), each built from its
// frozen text, and then, at the end of the file, Frappe HR's 28 commands beyond the 215 (payroll.hr-surface). Acceptance lines keep their claim word for word (P1), except the lines opening "On
// v4", which lose the opening (P9), and one line that named the old read-time settling, rewritten as
// an outcome (payroll.acceptance). "Reports" in a claim is read as decision payroll.reports says.
//
// The writes are implemented by one Core SDK flow each (flows.ts); the reads by one rpc each.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CANCELLED,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PAYER_BALANCE_TOO_LOW,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_BUDGETED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_me_agreements_accept,
  flow_client_me_agreements_collect,
  flow_client_org_agreements_change,
  flow_client_org_agreements_end,
  flow_client_org_agreements_offer,
  flow_client_org_agreements_pause,
  flow_client_org_agreements_resume,
  flow_client_org_agreements_withdraw,
} from "./flows.ts";
import {
  flow_client_me_payslips_get,
  flow_client_me_payslips_list,
  flow_client_org_employees_add,
  flow_client_org_employees_change,
  flow_client_org_employees_deactivate,
  flow_client_org_employees_get,
  flow_client_org_employees_leave,
  flow_client_org_employees_list,
  flow_client_org_employees_reinstate,
  flow_client_org_employees_suspend,
  flow_client_org_payroll_components_add,
  flow_client_org_payroll_components_change,
  flow_client_org_payroll_components_disable,
  flow_client_org_payroll_components_enable,
  flow_client_org_payroll_components_list,
  flow_client_org_payroll_runs_cancel,
  flow_client_org_payroll_runs_create,
  flow_client_org_payroll_runs_get,
  flow_client_org_payroll_runs_list,
  flow_client_org_payroll_runs_submit,
  flow_client_org_payroll_structures_assign,
  flow_client_org_payroll_structures_cancel,
  flow_client_org_payroll_structures_create,
  flow_client_org_payroll_structures_list,
  flow_client_org_payroll_structures_unassign,
  flow_client_org_payslips_release,
  flow_client_org_payslips_withhold,
} from "./flows.ts";
import { flow_client_org_payroll_runs_pay } from "./staged.ts";
import { WHO_HR } from "./employees.ts";
import { rpc_payroll_holders_list } from "./holders.ts";
import { rpc_payroll_payees_list, rpc_payroll_payees_show } from "./payees.ts";
import { Agreement, AgreementRow, CollectionPayment, Department, HolderWriteReturns, Status } from "./shapes.ts";

type Claim = { claim: string; observes: string; was: string[] };
type FrozenLine = { readonly claim: string; readonly was: readonly string[] };

const frozenLine = (id: FrozenId, n: number): FrozenLine => {
  const line = (frozen[id].acceptance as readonly FrozenLine[])[n - 1];
  if (!line) throw new Error(`${id} has no acceptance line ${n}`);
  return line;
};

/** A frozen claim kept word for word, with its test citation. */
const kept = (id: FrozenId, n: number, observes: string): Claim => {
  const line = frozenLine(id, n);
  return { claim: line.claim, observes, was: [...line.was] };
};

/** P9: a line opening "On v4" loses the opening; the old line moves to `was`. */
const onV4 = (id: FrozenId, n: number, observes: string): Claim => {
  const line = frozenLine(id, n);
  const rest = line.claim.replace(/^On (?:Protocol v4|a v4|v4),? /, "");
  if (rest === line.claim) throw new Error(`${id} line ${n} does not open with "On v4"`);
  return { claim: rest.charAt(0).toUpperCase() + rest.slice(1), observes, was: [line.claim, ...line.was] };
};

/** P1: a claim that named an internal mechanism, rewritten as an outcome (payroll.acceptance). */
const rewritten = (id: FrozenId, n: number, claim: string, observes: string): Claim => {
  const line = frozenLine(id, n);
  return { claim, observes, was: [line.claim, ...line.was] };
};

/** The frozen refusal text for a code, so `when` is never retyped. */
const when = (id: FrozenId, code: string): string => {
  const r = (frozen[id].refusals as readonly { code: string; when: string }[]).find((x) => x.code === code);
  if (!r) throw new Error(`${id} has no frozen refusal ${code}`);
  return r.when;
};

const ON_CHAIN_AS_HOLDER = (fn: string) =>
  `chain: the landed operation's sender is the holder's own Safe and its one call is Agreements.${fn}; cli: as a member ` +
  "whose Safe Budgets does not authorise, it exits ROLE_PERMISSION_DENIED; world: no write and no approval for that attempt.";

// ── the payee ───────────────────────────────────────────────────────────────────────────────

export const operation_agreement_accept = defineOperation({
  ...frozenText("agreement.accept"),
  priority: "normal",
  implementedBy: flow_client_me_agreements_accept,
  acceptance: [
    kept(
      "agreement.accept",
      1,
      "cli with `--no-wait`: `awaiting_approval` and an approvalId; read: that approval holds one call, Agreements.accept from " +
        "the payee's Safe; chain: no transaction yet; trace: no agreement_write_transitioned to `landed` and no agreement_transitioned for it.",
    ),
    kept(
      "agreement.accept",
      2,
      "chain: AgreementAccepted for the agreement; read: `agreement show` reads `active`; trace: exactly one " +
        "agreement_write_transitioned to `landed` with change `accepted`, occurred_at the block's time, and one agreement_transitioned offered → active.",
    ),
    kept(
      "agreement.accept",
      3,
      "cli: `--terms-hash` in capital letters prepares the acceptance; any other hash exits INVALID_INPUT naming `termsHash`; " +
        "world: the refused attempt stores no write and opens no approval.",
    ),
    kept(
      "agreement.accept",
      4,
      "world org-with-agreements-off: the payee's acceptance of its open offer lands; chain: AgreementAccepted.",
    ),
    kept(
      "agreement.accept",
      5,
      "chain: OfferWithdrawn lands first and the acceptance's operation reverts, or is never sent; cli: TRANSACTION_FAILED, or " +
        "CANCELLED for one never sent; read: the offer reads `withdrawn`; trace: no agreement_write_transitioned to `landed` for the acceptance.",
    ),
  ],
  returns: Schema.Struct({
    status: Schema.Union([Schema.Literal("awaiting_approval"), Status]),
    approvalId: Schema.String,
    agreement: Agreement,
    next: Schema.NullOr(Schema.Array(Schema.String)),
  }),
  refusals: [
    { error: error_INVALID_INPUT, given: "org-with-agreements", when: when("agreement.accept", "INVALID_INPUT") },
    { error: error_WRONG_STATE, given: "org-with-agreements", when: when("agreement.accept", "WRONG_STATE") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-agreements", when: when("agreement.accept", "ROLE_PERMISSION_DENIED") },
  ],
  budget: budget("chain-submit"),
});

export const operation_agreement_collect = defineOperation({
  ...frozenText("agreement.collect"),
  priority: "normal",
  implementedBy: flow_client_me_agreements_collect,
  acceptance: [
    kept(
      "agreement.collect",
      1,
      "chain: one transaction with one Collected and one PaymentSent of kind 4, from the payer's Safe to the payee's, of what " +
        "availableOf answered before; read: payments' `payment get` finds that one Payment; cli: `settled` with `collected` and " +
        "`payment`; trace: exactly one agreement_write_transitioned to `landed` with change `collected`.",
    ),
    kept(
      "agreement.collect",
      2,
      "chain: a second collection's window starts at the first's end; cli: its `payment` period starts where the first's ended.",
    ),
    kept(
      "agreement.collect",
      3,
      "cli on an agreement with nothing released: `nothing_released`, `collected` 0.00 and `nextReleaseAt`; world: an empty " +
        "diff (no write, no approval); chain: no transaction.",
    ),
    kept(
      "agreement.collect",
      4,
      "world org-with-short-safe: cli exits PAYER_BALANCE_TOO_LOW with nothing signed and `agreement show` keeps the same " +
        "collectable; after the Safe is funded the collection lands (chain: Collected).",
    ),
    kept(
      "agreement.collect",
      5,
      "world org-with-frozen-ceiling: cli exits ROLE_PERMISSION_DENIED naming what the ceiling has left, nothing signed; after " +
        "`org department ceiling unfreeze` the collection lands (chain: Collected).",
    ),
    kept(
      "agreement.collect",
      6,
      "world org-with-writes-awaiting: a second collect exits WRONG_STATE naming the first's approval; world: no second write or approval.",
    ),
    onV4(
      "agreement.collect",
      7,
      "chain: the landed operation's one call is Agreements.collect from the payee's Safe; with a short Safe or ceiling the " +
        "cli refuses (PAYER_BALANCE_TOO_LOW, ROLE_PERMISSION_DENIED) and no approval or transaction exists.",
    ),
  ],
  returns: Schema.Struct({
    status: Schema.Literals(["settled", "submitted", "nothing_released", "awaiting_approval"]),
    collected: Schema.String,
    payment: Schema.NullOr(CollectionPayment),
    agreement: Agreement,
    nextReleaseAt: Schema.NullOr(Schema.String),
  }),
  refusals: [
    { error: error_PAYER_BALANCE_TOO_LOW, given: "org-with-short-safe", when: when("agreement.collect", "PAYER_BALANCE_TOO_LOW") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-frozen-ceiling", when: when("agreement.collect", "ROLE_PERMISSION_DENIED") },
    { error: error_WRONG_STATE, given: "org-with-writes-awaiting", when: when("agreement.collect", "WRONG_STATE") },
  ],
  budget: budget("chain-submit"),
});

export const operation_agreement_list = defineOperation({
  ...frozenText("agreement.list"),
  priority: "normal",
  implementedBy: rpc_payroll_payees_list,
  acceptance: [
    kept(
      "agreement.list",
      1,
      "cli: with agreements from two Organizations paying the person, both are listed newest first; chain: each earned and " +
        "collectable equals Agreements' agreementOf and availableOf for it.",
    ),
    kept(
      "agreement.list",
      2,
      "cli on org-with-agreements: the default list leaves out its lapsed and withdrawn offers; `--status lapsed` and " +
        "`--status withdrawn` each show theirs.",
    ),
    kept(
      "agreement.list",
      3,
      "cli: an offer whose holder has not signed its approval is not in the payee's list, with or without `--status prepared`.",
    ),
    rewritten(
      "agreement.list",
      4,
      "An acceptance or collection the payee sent reads settled once it is on chain, and reports once.",
      "chain: the acceptance or collection lands; read: once it is indexed the list shows the agreement accepted, or its " +
        "collected and collectable moved; trace: exactly one agreement_write_transitioned to `landed` for it.",
    ),
    onV4(
      "agreement.list",
      5,
      "chain: the backend reads agreementOf and availableOf on the deployment's Agreements; cli: the figures it prints are theirs.",
    ),
  ],
  returns: Schema.Struct({ items: Schema.Array(AgreementRow) }),
  refusals: [
    { error: error_INVALID_INPUT, given: "org-with-agreements", when: when("agreement.list", "INVALID_INPUT") },
    { error: error_NOT_AUTHENTICATED, given: "org-with-agreements", when: when("agreement.list", "NOT_AUTHENTICATED") },
    { error: error_PROVIDER_ERROR, given: "org-with-agreements", when: when("agreement.list", "PROVIDER_ERROR") },
  ],
  budget: budget("chain-read"),
});

export const operation_agreement_show = defineOperation({
  ...frozenText("agreement.show"),
  priority: "normal",
  implementedBy: rpc_payroll_payees_show,
  acceptance: [
    kept(
      "agreement.show",
      1,
      "cli on an open offer: payer, kind, rate, release and terms with its documentId and hash; world: an empty diff.",
    ),
    kept(
      "agreement.show",
      2,
      "cli: `agreement accept --terms-hash` with the shown hash prepares; chain: the landed acceptance carries that termsHash.",
    ),
    kept(
      "agreement.show",
      3,
      "cli on an active agreement: earned, collectable, collected and nextReleaseAt; chain: equal to agreementOf and availableOf.",
    ),
    kept("agreement.show", 4, "cli: show of the lapsed and of the withdrawn offer each exits 0 with its status."),
    kept("agreement.show", 5, "cli: the id of an offer whose holder has not signed its approval exits INVALID_INPUT for the payee."),
    onV4(
      "agreement.show",
      6,
      "chain: the backend reads agreementOf on the deployment's Agreements for both; cli: as the holder who made the offer, " +
        "it exits ROLE_PERMISSION_DENIED.",
    ),
  ],
  returns: Schema.Struct({
    payer: Schema.Struct({ ...Agreement.fields.payer.fields, department: Agreement.fields.department }),
    kind: Agreement.fields.kind,
    status: Status,
    rate: Agreement.fields.rate,
    release: Agreement.fields.release,
    terms: Agreement.fields.terms,
    earned: Agreement.fields.earned,
    collectable: Agreement.fields.collectable,
    collected: Agreement.fields.collected,
    nextReleaseAt: Agreement.fields.nextReleaseAt,
  }),
  refusals: [
    { error: error_INVALID_INPUT, given: "org-with-agreements", when: when("agreement.show", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-agreements", when: when("agreement.show", "ROLE_PERMISSION_DENIED") },
  ],
  budget: budget("chain-read"),
});

// ── the holder ──────────────────────────────────────────────────────────────────────────────

export const operation_org_agreement_offer = defineOperation({
  ...frozenText("org.agreement.offer"),
  priority: "normal",
  implementedBy: flow_client_org_agreements_offer,
  acceptance: [
    kept(
      "org.agreement.offer",
      1,
      "cli with `--no-wait`: `awaiting_approval` and an approvalId; read: that approval holds one Agreements.offer call from " +
        "the holder's Safe; chain: no transaction yet; trace: no agreement_write_transitioned to `landed`.",
    ),
    kept(
      "org.agreement.offer",
      2,
      "chain: AgreementOffered and Budgets' Committed for its reservation; read: `org agreement list` reads it `offered` and " +
        "the department's left drops by the reservation; trace: exactly one agreement_write_transitioned to `landed` with " +
        "change `offered`, prepared_by the holder and occurred_at the block's time.",
    ),
    kept(
      "org.agreement.offer",
      3,
      "chain: AgreementOffered's payee is Companies House's safeAddressFor of the email; cli: once that person signs in, " +
        "`agreement list` shows the offer.",
    ),
    kept(
      "org.agreement.offer",
      4,
      "chain: AgreementOffered's payee is the Organization's Safe; cli: `agreement list --org` as its member shows the offer.",
    ),
    kept(
      "org.agreement.offer",
      5,
      "chain: AgreementOffered's step is the calendar month for a salary, 1 s for a stream, the retainer's period for a " +
        "retainer, and 1 day with `--end`; read: the last reads kind `fixed_term`.",
    ),
    kept(
      "org.agreement.offer",
      6,
      "chain: offerExpiresAt is 14 days after the offer, or its start or end if sooner; after `dev time warp` past it the " +
        "offer reads `lapsed` and agreement_transitioned to `lapsed` is sent once.",
    ),
    kept(
      "org.agreement.offer",
      7,
      "world org-with-department: an offer whose reservation equals what leftOf says is left prepares; one cent more exits " +
        "PAYROLL_BUDGET_EXCEEDED with nothing signed, in the budget's own token.",
    ),
  ],
  returns: HolderWriteReturns,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_PAYROLL_BUDGET_EXCEEDED, given: "org-with-department", when: when("org.agreement.offer", "PAYROLL_BUDGET_EXCEEDED") },
    { error: error_TOKEN_NOT_BUDGETED, given: "org-with-department", when: when("org.agreement.offer", "TOKEN_NOT_BUDGETED") },
    { error: error_TOKEN_NOT_SUPPORTED, given: "org-with-department", when: when("org.agreement.offer", "TOKEN_NOT_SUPPORTED") },
    { error: error_INVALID_INPUT, given: "org-with-department", when: when("org.agreement.offer", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-department", when: when("org.agreement.offer", "ROLE_PERMISSION_DENIED") },
    { error: error_FEATURE_NOT_AVAILABLE, given: "org-with-agreements-off", when: when("org.agreement.offer", "FEATURE_NOT_AVAILABLE") },
    {
      error: error_WRONG_STATE,
      given: "org-with-closed-department",
      when: "The budget is closed, or it already has 64 open agreements, or it has no budget on chain yet. Nothing is signed.",
    },
  ],
  budget: budget("chain-submit"),
});

export const operation_org_agreement_change = defineOperation({
  ...frozenText("org.agreement.change"),
  priority: "normal",
  implementedBy: flow_client_org_agreements_change,
  acceptance: [
    kept(
      "org.agreement.change",
      1,
      "chain: RateChanged effective at the block's time; read: `org agreement list` shows the new rate; trace: exactly one " +
        "agreement_write_transitioned to `landed` with change `rate_changed`, prepared_by the holder.",
    ),
    kept(
      "org.agreement.change",
      2,
      "chain: RateChanged with effectiveAt 00:00 UTC tomorrow and Budgets' leftOf unchanged; after `dev time warp` past it, " +
        "agreementOf's rate is the lower one.",
    ),
    kept(
      "org.agreement.change",
      3,
      "cli on a yearly agreement: `--rate 15000/month` prepares 180000 a year; a weekly rate exits INVALID_INPUT and stores nothing.",
    ),
    kept(
      "org.agreement.change",
      4,
      "world org-with-agreements: a raise whose difference equals what leftOf says is left prepares; one cent more exits " +
        "PAYROLL_BUDGET_EXCEEDED with nothing signed.",
    ),
    kept(
      "org.agreement.change",
      5,
      "cli: a change of the ending agreement exits WRONG_STATE; once a lowering has landed, a second change exits WRONG_STATE naming it.",
    ),
    onV4("org.agreement.change", 6, ON_CHAIN_AS_HOLDER("changeRate")),
    onV4(
      "org.agreement.change",
      7,
      "world org-with-agreements, whose lapsed offer's reservation is not settled yet: a raise that fits only once it is " +
        "freed prepares and lands; chain: RateChanged.",
    ),
  ],
  returns: HolderWriteReturns,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_PAYROLL_BUDGET_EXCEEDED, given: "org-with-agreements", when: when("org.agreement.change", "PAYROLL_BUDGET_EXCEEDED") },
    { error: error_WRONG_STATE, given: "org-with-agreements", when: when("org.agreement.change", "WRONG_STATE") },
    { error: error_INVALID_INPUT, given: "org-with-agreements", when: when("org.agreement.change", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-agreements", when: when("org.agreement.change", "ROLE_PERMISSION_DENIED") },
    { error: error_FEATURE_NOT_AVAILABLE, given: "org-with-agreements-off", when: when("org.agreement.change", "FEATURE_NOT_AVAILABLE") },
  ],
  budget: budget("chain-submit"),
});

export const operation_org_agreement_end = defineOperation({
  ...frozenText("org.agreement.end"),
  priority: "normal",
  implementedBy: flow_client_org_agreements_end,
  acceptance: [
    kept(
      "org.agreement.end",
      1,
      "chain: AgreementEnded; read: the agreement reads `ending`; trace: exactly one agreement_write_transitioned to `landed` " +
        "with change `ended`, prepared_by the holder, and one agreement_transitioned active → ending.",
    ),
    kept(
      "org.agreement.end",
      2,
      "chain: an end on today sets endsAt to 00:00 UTC tomorrow; after `dev time warp` past it the agreement reads `ended` " +
        "and availableOf still holds what was earned, which a collect then lands.",
    ),
    kept(
      "org.agreement.end",
      3,
      "cli: a later last day on the ending agreement or on a fixed term exits WRONG_STATE; an earlier one lands (chain: AgreementEnded).",
    ),
    kept(
      "org.agreement.end",
      4,
      "chain: AgreementEnded on the paused agreement; read: it reads `paused` until its end, then `ended`.",
    ),
    kept("org.agreement.end", 5, "cli: yesterday exits INVALID_INPUT naming `on`; today prepares."),
    onV4("org.agreement.end", 6, ON_CHAIN_AS_HOLDER("end")),
  ],
  returns: HolderWriteReturns,
  refusals: [
    { error: error_WRONG_STATE, given: "org-with-agreements", when: when("org.agreement.end", "WRONG_STATE") },
    { error: error_INVALID_INPUT, given: "org-with-agreements", when: when("org.agreement.end", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-agreements", when: when("org.agreement.end", "ROLE_PERMISSION_DENIED") },
    { error: error_FEATURE_NOT_AVAILABLE, given: "org-with-agreements-off", when: when("org.agreement.end", "FEATURE_NOT_AVAILABLE") },
  ],
  budget: budget("chain-submit"),
});

export const operation_org_agreement_list = defineOperation({
  ...frozenText("org.agreement.list"),
  priority: "normal",
  implementedBy: rpc_payroll_holders_list,
  acceptance: [
    kept(
      "org.agreement.list",
      1,
      "cli: items grouped by department, oldest first; chain: each department's budget, committed and left equal Budgets' " +
        "budgetOf and leftOf in its token.",
    ),
    kept(
      "org.agreement.list",
      2,
      "cli on org-with-agreements: the default list shows the offered, active, paused, ending and ended agreements; " +
        "`--status` with each of lapsed, withdrawn, prepared and abandoned shows that one.",
    ),
    kept("org.agreement.list", 3, "cli: `--department platform` and `--department dep_…` list the same items."),
    kept(
      "org.agreement.list",
      4,
      "world: a list leaves an empty diff; with the chain node's fault switch on, cli exits PROVIDER_ERROR and the diff is still empty.",
    ),
    onV4(
      "org.agreement.list",
      5,
      "chain: the backend reads agreementOf on Agreements and budgetOf and leftOf on Budgets, and no call reaches a " +
        "PayrollDepartments address (none is deployed).",
    ),
  ],
  returns: Schema.Struct({ items: Schema.Array(AgreementRow), departments: Schema.Array(Department) }),
  refusals: [
    { error: error_INVALID_INPUT, given: "org-with-agreements", when: when("org.agreement.list", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-agreements", when: when("org.agreement.list", "ROLE_PERMISSION_DENIED") },
    { error: error_PROVIDER_ERROR, given: "org-with-agreements", when: when("org.agreement.list", "PROVIDER_ERROR") },
  ],
  budget: budget("chain-read"),
});

export const operation_org_agreement_pause = defineOperation({
  ...frozenText("org.agreement.pause"),
  priority: "normal",
  implementedBy: flow_client_org_agreements_pause,
  acceptance: [
    kept(
      "org.agreement.pause",
      1,
      "chain: AgreementPaused; read: the agreement reads `paused`; trace: exactly one agreement_write_transitioned to " +
        "`landed` with change `paused`, prepared_by the holder.",
    ),
    kept(
      "org.agreement.pause",
      2,
      "chain: availableOf keeps what was earned at the pause and grows no more, and Budgets' leftOf is unchanged; a collect lands.",
    ),
    kept(
      "org.agreement.pause",
      3,
      "chain: AgreementPaused on the ending agreement; read: it reads `paused` until its end, then `ended`.",
    ),
    kept(
      "org.agreement.pause",
      4,
      "two holders each sign a pause; chain: one AgreementPaused and the other's operation reverts; cli: the second exits " +
        "TRANSACTION_FAILED; trace: one write to `landed`, the other's to `failed`, and one agreement_transitioned to `paused`.",
    ),
    kept(
      "org.agreement.pause",
      5,
      "chain: the pause's operation reverted; read: the agreement reads `active`; trace: no agreement_transitioned to `paused`.",
    ),
    onV4("org.agreement.pause", 6, ON_CHAIN_AS_HOLDER("pause")),
  ],
  returns: HolderWriteReturns,
  refusals: [
    { error: error_WRONG_STATE, given: "org-with-agreements", when: when("org.agreement.pause", "WRONG_STATE") },
    { error: error_INVALID_INPUT, given: "org-with-agreements", when: when("org.agreement.pause", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-agreements", when: when("org.agreement.pause", "ROLE_PERMISSION_DENIED") },
    { error: error_FEATURE_NOT_AVAILABLE, given: "org-with-agreements-off", when: when("org.agreement.pause", "FEATURE_NOT_AVAILABLE") },
  ],
  budget: budget("chain-submit"),
});

export const operation_org_agreement_resume = defineOperation({
  ...frozenText("org.agreement.resume"),
  priority: "normal",
  implementedBy: flow_client_org_agreements_resume,
  acceptance: [
    kept(
      "org.agreement.resume",
      1,
      "chain: AgreementResumed; read: the agreement reads `active`; trace: exactly one agreement_write_transitioned to " +
        "`landed` with change `resumed`, prepared_by the holder.",
    ),
    kept(
      "org.agreement.resume",
      2,
      "world: after the resume lands the mail sink holds one email to the payee about it, and none while it is only prepared.",
    ),
    kept(
      "org.agreement.resume",
      3,
      "chain: the second holder's own Safe sends the resume; trace: the landed write's prepared_by is that holder.",
    ),
    kept(
      "org.agreement.resume",
      4,
      "read: the paused agreement whose end is ahead reads `ending` after the resume lands; trace: agreement_transitioned " +
        "with transition `resume_ending`.",
    ),
    kept(
      "org.agreement.resume",
      5,
      "chain: the resume's operation reverts; read: the agreement reads `paused`; trace: no write to `landed` and no agreement_transitioned.",
    ),
    onV4("org.agreement.resume", 6, ON_CHAIN_AS_HOLDER("resume")),
  ],
  returns: HolderWriteReturns,
  refusals: [
    { error: error_WRONG_STATE, given: "org-with-agreements", when: when("org.agreement.resume", "WRONG_STATE") },
    { error: error_INVALID_INPUT, given: "org-with-agreements", when: when("org.agreement.resume", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-agreements", when: when("org.agreement.resume", "ROLE_PERMISSION_DENIED") },
    { error: error_FEATURE_NOT_AVAILABLE, given: "org-with-agreements-off", when: when("org.agreement.resume", "FEATURE_NOT_AVAILABLE") },
  ],
  budget: budget("chain-submit"),
});

export const operation_org_agreement_withdraw = defineOperation({
  ...frozenText("org.agreement.withdraw"),
  priority: "normal",
  implementedBy: flow_client_org_agreements_withdraw,
  acceptance: [
    kept(
      "org.agreement.withdraw",
      1,
      "chain: OfferWithdrawn and Budgets' Released of the reservation; read: the offer reads `withdrawn` and the department's " +
        "left grows by it; trace: exactly one agreement_write_transitioned to `landed` with change `withdrawn`, prepared_by the holder.",
    ),
    kept("org.agreement.withdraw", 2, "world: after the withdrawal lands the mail sink holds no email to the payee."),
    kept(
      "org.agreement.withdraw",
      3,
      "chain: AgreementAccepted lands first and the withdrawal's operation reverts; read: the agreement reads `active`; " +
        "trace: no agreement_write_transitioned to `landed` for the withdrawal.",
    ),
    kept(
      "org.agreement.withdraw",
      4,
      "cli: withdraw of the active, the lapsed and the withdrawn offer of org-with-agreements each exits WRONG_STATE; world: " +
        "no write and no approval.",
    ),
    kept(
      "org.agreement.withdraw",
      5,
      "with the bundler fake refusing the first send: read: the write stays `awaiting` on the same approval, which approvals " +
        "sends again; world: no second write or approval; chain: one OfferWithdrawn once it lands.",
    ),
    onV4("org.agreement.withdraw", 6, ON_CHAIN_AS_HOLDER("withdrawOffer")),
  ],
  returns: HolderWriteReturns,
  refusals: [
    { error: error_WRONG_STATE, given: "org-with-agreements", when: when("org.agreement.withdraw", "WRONG_STATE") },
    { error: error_INVALID_INPUT, given: "org-with-agreements", when: when("org.agreement.withdraw", "INVALID_INPUT") },
    { error: error_ROLE_PERMISSION_DENIED, given: "org-with-agreements", when: when("org.agreement.withdraw", "ROLE_PERMISSION_DENIED") },
    { error: error_FEATURE_NOT_AVAILABLE, given: "org-with-agreements-off", when: when("org.agreement.withdraw", "FEATURE_NOT_AVAILABLE") },
  ],
  budget: budget("chain-submit"),
});

// ── Frappe HR's commands: 28 operations beyond the 215 (payroll.hr-surface) ─────────────────
//
// Booked under rules.new-operations (CONVENTIONS rule 4a) on the pack payroll.hr-surface, which serves
// aaron.frappe-shape, exactly as docs/design/new-commands.md section 5.3 lists them, in its one grammar:
// each acts for the Organization `--org` names (else `use org`'s), each id is its command's words joined by
// dots, area `payroll`, and each calls one SDK method (flows.ts, staged.ts). Who may run each is a hat or the
// caller's own Safe, never a named person (payroll.command-authority, docs/design/authority.md): the People hat
// changes and reads the HR records; whoever wears the run's department hat, or one above it, when it is paid
// pays it; a payee reads their own payslips. The commands an Organization's first payroll needs are critical
// (payroll.critical-commands). Every refusal starts from a catalogued world (payroll.command-worlds).

const HR_AREA = "payroll";
const hrClaim = (claim: string, observes: string) => ({ claim, observes });
const HR_NOTHING = "Nothing: it only reads.";

/** org-with-department plus Acme's Employees, components, structures and assignments (payroll.command-worlds). */
const W_HR = "org-with-employees";
/** org-with-employees plus three runs of `salaries`: the first paid (Noor's net escrowed), the second submitted with Noor's slip withheld, this month's a draft. */
const W_RUNS = "org-with-payroll-runs";
/** org-with-payroll-runs with `salaries` spent down to 1,350 USDC left this month. */
const W_BUDGET_USED = "org-with-payroll-budget-used";
/** org-with-payroll-runs with the company Safe holding 1,000 USDC. */
const W_SHORT_SAFE = "org-with-payroll-short-safe";

const WHO_BUDGET =
  "A signed-in member of the Organization, person or agent, whose own Safe `Budgets.authorised` admits on the run's " +
  "department budget when it pays: a wearer in good standing of that budget's hat or of the hat of any budget above it, " +
  "as the chain reads it then. Authority follows the hat, never the person who drafted the run or paid it before: " +
  "someone swapped out of the department can no longer pay its runs, and whoever wears its hat next can. An agent, the " +
  "FDE included, pays only through a hat the Board granted its Safe. Never the Board itself, which spends from no budget.";

const WHO_SELF =
  "A signed-in person or agent, for the payslips that pay its own Safe, from every Organization that pays it; an " +
  "Employee needs no Seat in the Organization that pays them.";

const hrSignedOut = { error: error_NOT_AUTHENTICATED, given: "signed-out", when: "No one is signed in on this machine: nothing is read or written." };
const hrOutsider = (given: string = W_HR) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given,
  when: "Olga, signed in and holding no Seat in Acme, names it with `--org`: refused as an Organization that does not exist is; nothing is read or written.",
});
/** A member who wears a department's hat but not the People hat runs a People command. */
const noPeopleHat = (what: string, given: string = W_HR) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given,
  when: `Lead, a member of Acme whose Safe wears \`salaries\`' office hat but not the People hat, ${what}: holding a department is not Frappe's HR Manager, and nothing is read or written.`,
});
const hrInvalid = (when: string, given: string = W_HR) => ({ error: error_INVALID_INPUT, given, when });
const hrWrong = (when: string, given: string = W_HR) => ({ error: error_WRONG_STATE, given, when });
const unknownId = (kind: string, prefix: string, given: string = W_HR) =>
  hrInvalid(`A well-formed \`${prefix}\` id that names none of Acme's ${kind}: there is no not-found code, and nothing is read or written.`, given);
/** The refusals every People command shares. */
const peopleOnly = (what: string, given: string = W_HR) => [hrSignedOut, hrOutsider(given), noPeopleHat(what, given)];

const HR_ERRORS_CLI = [error_CLI_USAGE];

// Employees

export const operation_org_employee_add = defineOperation({
  id: "org.employee.add",
  title: "Add a person as an Employee",
  about:
    "Adds a person as an active Employee of the Organization, in Frappe HR's Employee shape, paid from the department " +
    "named: one of its budgets, by key or id. The person is named by the mailbox they keep, an `@handle` or a Party id. " +
    "Someone with no Capxul account yet is employed and paid all the same: their pay waits in a claim escrow until they " +
    "claim it. Pay goes to the Safe of the mailbox they keep, never a work address. A person has at most one live " +
    "Employee in an Organization, and one who left and comes back is a new Employee. Being paid from a department gives " +
    "no authority over it: that belongs to whoever wears its hat.",
  area: HR_AREA,
  command: "org employee add",
  priority: "critical",
  implementedBy: flow_client_org_employees_add,
  who: WHO_HR,
  changes: "One Employee, active, and its line in payroll's change log, which a connected head's sync pushes.",
  acceptance: [
    hrClaim(
      "A person with no account is added as an active Employee, paid at the Safe their mailbox derives, and shown unclaimed.",
      "cli: from org-with-employees, Pat's `org employee add ivy@acme.test --first-name Ivy --last-name Lund --joined <today> " +
        "--department salaries --org acme --json` prints an `emp_` id, `status: active`, `unclaimed: true` and a `payeeSafe`; " +
        "read: `org employee get` of that id prints the same; world: one Employee and one provisional Party added.",
    ),
    hrClaim(
      "A live Employee is not added twice; a person who left is added again as a new Employee.",
      "cli: from org-with-employees, Pat's `org employee add sam@acme.test --first-name Sam --joined <today> --department " +
        "salaries` exits WRONG_STATE naming Sam's `emp_` id; the same for leo@acme.test prints a new `emp_` id, active, while " +
        "`org employee list --status left` still lists Leo's old one; world: one Employee added in all.",
    ),
    hrClaim(
      "Only a wearer of the People hat adds an Employee: holding the department's hat is not enough.",
      "cli: from org-with-employees, Lead's `org employee add ivy@acme.test --first-name Ivy --joined <today> --department " +
        "salaries --org acme` exits ROLE_PERMISSION_DENIED; world: no diff.",
    ),
  ],
  returns: flow_client_org_employees_add.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("adds ivy@acme.test as an Employee"),
    hrInvalid(
      "The person names nothing (`nobody`), or names an Organization (`@acme`), an agent or an outside address, since " +
        "Frappe's Employee is a person; or `--department` names none of Acme's budgets: the refusal names the field.",
    ),
    hrWrong("Sam is already a live Employee of Acme: the refusal names his `emp_` id, and nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_employee_change = defineOperation({
  id: "org.employee.change",
  title: "Change an Employee's department, designation or type",
  about:
    "Changes an Employee's department (the budget that pays their next run), designation or employment type, and keeps " +
    "the rest. It never moves their status, which only `org employee suspend`, `deactivate`, `reinstate` and `leave` " +
    "do, and never their Party, Safe or pay mailbox: pay follows the person, not the record. Moving an Employee to " +
    "another department changes who pays them, never who acts for the department.",
  area: HR_AREA,
  command: "org employee change",
  priority: "normal",
  implementedBy: flow_client_org_employees_change,
  who: WHO_HR,
  changes: "The Employee's fields given, and its line in payroll's change log.",
  acceptance: [
    hrClaim(
      "A change sets the fields given and keeps the rest; the status, Party and pay Safe never change.",
      "cli: from org-with-employees, Pat's `org employee change <Sam> --designation \"Senior Engineer\" --department " +
        "engineering --org acme --json` prints the new designation and department with `status: active` and the same " +
        "`partyId` and `payeeSafe` as before; read: `org employee get <Sam>` agrees.",
    ),
    hrClaim(
      "A status is never a change's: it is a lifecycle command.",
      "cli: from org-with-employees, `org employee change <Sam> --status left --org acme` exits CLI_USAGE; world: no diff.",
    ),
  ],
  returns: flow_client_org_employees_change.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("changes Sam's designation"),
    hrInvalid("The Employee is none of Acme's, or `--department` names none of its budgets: the refusal names the field, and nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_employee_get = defineOperation({
  id: "org.employee.get",
  title: "Read one Employee",
  about:
    "Reads one Employee: their status, joining and relieving days, department, designation and type, whether they have " +
    "claimed their account yet, and the structure assignment that pays them today. The HR record is the People hat's; " +
    "an Employee reads their own pay with `payslip list`.",
  area: HR_AREA,
  command: "org employee get",
  priority: "normal",
  implementedBy: flow_client_org_employees_get,
  who: WHO_HR,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "One Employee reads with their status and the assignment that pays them today.",
      "cli: from org-with-employees, Pat's `org employee get <Sam> --org acme --json` prints `status: active`, department " +
        "`salaries`, `unclaimed: false` and the Standard assignment on a 4000.00 base from his joining day; for Leo it " +
        "prints `status: left`, his relieving day and a null assignment.",
    ),
    hrClaim(
      "An Employee does not read their own HR record without the People hat.",
      "cli: from org-with-employees, Sam's `org employee get <Sam> --org acme` exits ROLE_PERMISSION_DENIED; world: no diff.",
    ),
  ],
  returns: flow_client_org_employees_get.output,
  errors: HR_ERRORS_CLI,
  refusals: [...peopleOnly("reads Sam's Employee"), unknownId("Employees", "emp_")],
  budget: budget("read"),
});

export const operation_org_employee_list = defineOperation({
  id: "org.employee.list",
  title: "List the Organization's Employees",
  about:
    "Lists the Organization's Employees by department and name, each with their status and whether they have claimed " +
    "their account yet. Those who left are listed only when asked for with `--status left`; `--department` keeps one " +
    "department's.",
  area: HR_AREA,
  command: "org employee list",
  priority: "critical",
  implementedBy: flow_client_org_employees_list,
  who: WHO_HR,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "The live Employees list by department and name; those who left only when asked for.",
      "cli: from org-with-employees, Pat's `org employee list --org acme --json` lists Ana (suspended), Noor (active, " +
        "`unclaimed: true`) and Sam (active, `unclaimed: false`), and not Leo; `--status left` lists Leo alone; " +
        "`--department engineering` lists none.",
    ),
  ],
  returns: flow_client_org_employees_list.output,
  errors: HR_ERRORS_CLI,
  refusals: [...peopleOnly("lists Acme's Employees"), hrInvalid("`--department` names none of Acme's budgets: nothing is listed.")],
  budget: budget("read"),
});

/** The refusals a status verb shares: an unknown Employee, and the state its transition does not leave from. */
const statusRefusals = (what: string, wrong: string) => [
  ...peopleOnly(what),
  unknownId("Employees", "emp_"),
  hrWrong(`${wrong} The refusal names the status, and nothing is written.`),
];

export const operation_org_employee_suspend = defineOperation({
  id: "org.employee.suspend",
  title: "Suspend an Employee",
  about: "Suspends an active Employee, as Frappe's Suspended status: they stay on the books, and no new run pays them until they are reinstated.",
  area: HR_AREA,
  command: "org employee suspend",
  priority: "normal",
  implementedBy: flow_client_org_employees_suspend,
  who: WHO_HR,
  changes: "The Employee's status, to suspended.",
  acceptance: [
    hrClaim(
      "An active Employee is suspended, and a new run leaves them out.",
      "cli: from org-with-employees, Pat's `org employee suspend <Sam> --org acme --json` prints `status: suspended`; " +
        "`org payroll run create salaries --start <this month's first day> --end <its last day>` then holds Noor's slip " +
        "only; trace: one employee_transitioned active → suspended, transition `suspend`.",
    ),
    hrClaim(
      "Only an active Employee is suspended.",
      "cli: from org-with-employees, `org employee suspend <Ana>` (suspended) and `<Leo>` (left) each exit WRONG_STATE naming the status; world: no diff.",
    ),
  ],
  returns: flow_client_org_employees_suspend.output,
  errors: HR_ERRORS_CLI,
  refusals: statusRefusals("suspends Sam", "Ana is already suspended, or Leo has left."),
  budget: budget("write"),
});

export const operation_org_employee_deactivate = defineOperation({
  id: "org.employee.deactivate",
  title: "Deactivate an Employee",
  about: "Makes an active or suspended Employee inactive, as Frappe's Inactive status: kept on the books, and paid by no run until reinstated.",
  area: HR_AREA,
  command: "org employee deactivate",
  priority: "normal",
  implementedBy: flow_client_org_employees_deactivate,
  who: WHO_HR,
  changes: "The Employee's status, to inactive.",
  acceptance: [
    hrClaim(
      "An active or suspended Employee becomes inactive, still listed, and paid by no run.",
      "cli: from org-with-employees, Pat's `org employee deactivate <Ana> --org acme --json` prints `status: inactive`; " +
        "`org employee list` still lists her; trace: one employee_transitioned suspended → inactive.",
    ),
    hrClaim(
      "An Employee who left is not deactivated.",
      "cli: from org-with-employees, `org employee deactivate <Leo>` exits WRONG_STATE naming `left`; world: no diff.",
    ),
  ],
  returns: flow_client_org_employees_deactivate.output,
  errors: HR_ERRORS_CLI,
  refusals: statusRefusals("deactivates Ana", "Leo has left."),
  budget: budget("write"),
});

export const operation_org_employee_reinstate = defineOperation({
  id: "org.employee.reinstate",
  title: "Reinstate an Employee",
  about:
    "Makes an inactive or suspended Employee active again, so the next run pays them. Someone who left is never " +
    "reinstated: they are added again as a new Employee.",
  area: HR_AREA,
  command: "org employee reinstate",
  priority: "normal",
  implementedBy: flow_client_org_employees_reinstate,
  who: WHO_HR,
  changes: "The Employee's status, to active.",
  acceptance: [
    hrClaim(
      "An inactive or suspended Employee is active again, and the next run pays them.",
      "cli: from org-with-employees, Pat's `org employee reinstate <Ana> --org acme --json` prints `status: active`; a run " +
        "of `salaries` for this month then holds slips for Ana, Noor and Sam, Ana's net 3325.00 (3500.00 less 175.00 " +
        "Pension); trace: one employee_transitioned suspended → active.",
    ),
    hrClaim(
      "An active Employee, or one who left, is not reinstated.",
      "cli: from org-with-employees, `org employee reinstate <Sam>` and `<Leo>` each exit WRONG_STATE naming the status; world: no diff.",
    ),
  ],
  returns: flow_client_org_employees_reinstate.output,
  errors: HR_ERRORS_CLI,
  refusals: statusRefusals("reinstates Ana", "Sam is active, or Leo has left."),
  budget: budget("write"),
});

export const operation_org_employee_leave = defineOperation({
  id: "org.employee.leave",
  title: "Let an Employee go on a day",
  about:
    "The Employee leaves on the day given, their last day worked, and this is final for the record: someone who comes " +
    "back is added as a new Employee. It first previews who leaves, from when, the assignment that stops and any " +
    "withheld slip that stays owed, and asks; `--confirm` answers yes in a script. Someone whose pay is on its way or " +
    "waiting in a claim escrow leaves once it lands. Their slips, and an agreement's earned pay, stay theirs.",
  area: HR_AREA,
  command: "org employee leave",
  priority: "normal",
  implementedBy: flow_client_org_employees_leave,
  who: WHO_HR,
  changes: "The Employee's status, to left, with their relieving day; no run pays them after it.",
  acceptance: [
    hrClaim(
      "The Employee leaves on the day given, and that is final.",
      "cli: from org-with-employees, Pat's `org employee leave <Ana> --on <yesterday> --confirm --org acme --json` prints " +
        "`status: left` with that relieving day; `org employee reinstate <Ana>` then exits WRONG_STATE; read: `org employee " +
        "list --status left` lists Ana and Leo; trace: one employee_transitioned suspended → left.",
    ),
    hrClaim(
      "Answering no at the preview writes nothing, and a script must say `--confirm`.",
      "cli: from org-with-employees, at a terminal Pat answers no to the preview, which names Ana, the day and her Standard " +
        "assignment: exit 130, CANCELLED; with no terminal and no `--confirm`: CLI_USAGE; world: no diff after either.",
    ),
    hrClaim(
      "Someone whose pay waits in a claim escrow does not leave until it lands.",
      "cli: from org-with-payroll-runs, `org employee leave <Noor> --on <today> --confirm --org acme` exits WRONG_STATE " +
        "naming her escrowed slip of the first run; world: no diff.",
    ),
  ],
  returns: flow_client_org_employees_leave.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("lets Ana go"),
    hrInvalid("The relieving day is before the Employee's joining day, or the Employee is none of Acme's: the refusal names the field, and nothing is written."),
    hrWrong("Leo has already left: the refusal names `left`, and nothing is written."),
    hrWrong("Noor's slip of the first run waits in a claim escrow: the refusal names it, and nothing is written.", W_RUNS),
    { error: error_CANCELLED, given: W_HR, when: "At a terminal, Pat answers no to the preview of Ana's leaving: nothing is written." },
  ],
  budget: budget("write"),
});

// Salary components

export const operation_org_payroll_component_add = defineOperation({
  id: "org.payroll.component.add",
  title: "Add a salary component",
  about:
    "Adds a salary component, as Frappe HR's: an earning, a deduction or an employer contribution, with a fixed amount " +
    "or a Frappe formula and an optional condition, and an abbreviation unique in the Organization that formulas name " +
    "it by. A formula Capxul works out exactly as Frappe does is marked portable; any other formula Frappe accepts is " +
    "kept for a connected head to compute. A deduction or employer contribution may name the Party it is owed to, " +
    "which is paid outside the run.",
  area: HR_AREA,
  command: "org payroll component add",
  priority: "critical",
  implementedBy: flow_client_org_payroll_components_add,
  who: WHO_HR,
  changes: "One salary component, and its line in payroll's change log.",
  acceptance: [
    hrClaim(
      "A component is added with its amount or formula, and one Capxul works out exactly is portable.",
      "cli: from org-with-employees, Pat's `org payroll component add Transport --abbr TR --type earning --amount 150 --org " +
        "acme --json` prints an `sc_` id, `portable: true` and `disabled: false`; `org payroll component list` lists it; " +
        "world: one component added.",
    ),
    hrClaim(
      "A formula beyond the portable subset is kept for a head; one that does not parse is refused.",
      "cli: from org-with-employees, `org payroll component add Holiday --abbr HOL --type earning --formula \"base * 0.1 if " +
        "getdate(end_date).month == 12 else 0\"` prints `portable: false`; `--formula \"base *\"` exits INVALID_INPUT " +
        "naming `formula`; world: one component added in all.",
    ),
    hrClaim(
      "An abbreviation names one component in the Organization.",
      "cli: from org-with-employees, `org payroll component add Basic2 --abbr B --type earning --amount 1` exits INVALID_INPUT naming Basic; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_components_add.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("adds a component"),
    hrInvalid(
      "Neither `--amount` nor `--formula`, an abbreviation another component has, a formula that does not parse, or an " +
        "`--account` not under the heading its type needs: the refusal names the field, and nothing is written.",
    ),
  ],
  budget: budget("write"),
});

export const operation_org_payroll_component_change = defineOperation({
  id: "org.payroll.component.change",
  title: "Change a salary component",
  about:
    "Changes the fields given of a salary component, named by its id or abbreviation, and keeps the rest. Structures " +
    "already made keep their own rows, as Frappe's do, so no slip of theirs changes: a new structure takes the change.",
  area: HR_AREA,
  command: "org payroll component change",
  priority: "normal",
  implementedBy: flow_client_org_payroll_components_change,
  who: WHO_HR,
  changes: "The component's fields given, and its line in payroll's change log; no structure changes.",
  acceptance: [
    hrClaim(
      "A change sets the fields given, and structures made before it keep their own rows.",
      "cli: from org-with-employees, Pat's `org payroll component change PEN --formula \"base * 0.06\" --org acme --json` " +
        "prints the new formula; `org payroll structure list` still shows Standard's PEN row at `base * 0.05`, and a run of " +
        "`salaries` for this month still deducts 200.00 from Sam.",
    ),
  ],
  returns: flow_client_org_payroll_components_change.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("changes Pension"),
    hrInvalid("The component is none of Acme's, the abbreviation is another's, or the formula does not parse: the refusal names the field, and nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_payroll_component_list = defineOperation({
  id: "org.payroll.component.list",
  title: "List the salary components",
  about: "Lists the Organization's salary components, enabled first, each with its type, how it is worked out, and whether Capxul can work it out itself.",
  area: HR_AREA,
  command: "org payroll component list",
  priority: "normal",
  implementedBy: flow_client_org_payroll_components_list,
  who: WHO_HR,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "The components list enabled first, each with how it is worked out.",
      "cli: from org-with-employees, Pat's `org payroll component list --org acme --json` lists Basic (B, earning, formula " +
        "`base`, `portable: true`) and Pension (PEN, deduction, formula `base * 0.05`), then Bonus (BON, earning, 250.00, " +
        "`disabled: true`).",
    ),
  ],
  returns: flow_client_org_payroll_components_list.output,
  errors: HR_ERRORS_CLI,
  refusals: peopleOnly("lists the components"),
  budget: budget("read"),
});

export const operation_org_payroll_component_disable = defineOperation({
  id: "org.payroll.component.disable",
  title: "Disable a salary component",
  about: "Disables a salary component, so no new structure takes it. Structures that already have it keep it, and so do their slips.",
  area: HR_AREA,
  command: "org payroll component disable",
  priority: "normal",
  implementedBy: flow_client_org_payroll_components_disable,
  who: WHO_HR,
  changes: "The component's `disabled`, set; no structure changes.",
  acceptance: [
    hrClaim(
      "A disabled component is taken by no new structure; structures that have it keep it.",
      "cli: from org-with-employees, Pat's `org payroll component disable PEN --org acme --json` prints `disabled: true`; " +
        "`org payroll structure create Lean --frequency monthly --token USDC --earning B --deduction PEN` then exits " +
        "INVALID_INPUT naming PEN; `org payroll structure list` still shows Standard's PEN row.",
    ),
  ],
  returns: flow_client_org_payroll_components_disable.output,
  errors: HR_ERRORS_CLI,
  refusals: [...peopleOnly("disables Pension"), unknownId("salary components", "sc_")],
  budget: budget("write"),
});

export const operation_org_payroll_component_enable = defineOperation({
  id: "org.payroll.component.enable",
  title: "Enable a salary component",
  about: "Enables a disabled salary component, so new structures may take it again.",
  area: HR_AREA,
  command: "org payroll component enable",
  priority: "normal",
  implementedBy: flow_client_org_payroll_components_enable,
  who: WHO_HR,
  changes: "The component's `disabled`, cleared.",
  acceptance: [
    hrClaim(
      "An enabled component may be taken by new structures again.",
      "cli: from org-with-employees, Pat's `org payroll component enable BON --org acme --json` prints `disabled: false`; " +
        "`org payroll structure create Plus --frequency monthly --token USDC --earning B --earning BON` then prints a " +
        "submitted structure with both rows.",
    ),
  ],
  returns: flow_client_org_payroll_components_enable.output,
  errors: HR_ERRORS_CLI,
  refusals: [...peopleOnly("enables Bonus"), unknownId("salary components", "sc_")],
  budget: budget("write"),
});

// Salary structures and assignments

export const operation_org_payroll_structure_create = defineOperation({
  id: "org.payroll.structure.create",
  title: "Create a salary structure",
  about:
    "Creates a salary structure, submitted at once as Frappe's is: how often it pays, the token it pays in, and its " +
    "earnings, deductions and employer contributions in order, each a component by abbreviation with its own amount or " +
    "formula where it differs. A row's formula names only the rows above it. A structure is never edited: a change is a " +
    "new structure that amends the old one, which is cancelled once nothing is assigned to it.",
  area: HR_AREA,
  command: "org payroll structure create",
  priority: "critical",
  implementedBy: flow_client_org_payroll_structures_create,
  who: WHO_HR,
  changes: "One submitted structure (and the one it amends, cancelled), and their lines in payroll's change log.",
  acceptance: [
    hrClaim(
      "A structure is created submitted, its rows in order from the components named.",
      "cli: from org-with-employees, Pat's `org payroll structure create Senior --frequency monthly --token USDC --earning B " +
        "--deduction PEN=\"base * 0.04\" --org acme --json` prints `docstatus: submitted`, earnings B (`base`) and deductions " +
        "PEN (`base * 0.04`); trace: one salary_structure_transitioned with transition `submit`.",
    ),
    hrClaim(
      "An amendment replaces the structure it amends, once nothing is assigned to it.",
      "cli: from org-with-employees, `org payroll structure create Contractors-2 --frequency monthly --token USDC --earning B " +
        "--amends <Contractors>` prints it submitted, and `org payroll structure list` shows Contractors cancelled; with " +
        "`--amends <Standard>`, which three assignments name, it exits INVALID_INPUT; world: one structure added and one cancelled.",
    ),
    hrClaim(
      "A structure pays in a token one of the Organization's budgets pays in.",
      "cli: from org-with-employees, `org payroll structure create Euro --frequency monthly --token EURC --earning B` exits TOKEN_NOT_BUDGETED; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_structures_create.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("creates a structure"),
    hrInvalid(
      "A row names an unknown or disabled component (`--earning BON` while Bonus is disabled), a deduction as an earning, " +
        "or a formula names a row below it: the refusal names the row, and nothing is written.",
    ),
    { error: error_TOKEN_NOT_BUDGETED, given: W_HR, when: "`--token EURC`: Acme admits EURC, but none of its budgets pays in it, and nothing is written." },
  ],
  budget: budget("write"),
});

export const operation_org_payroll_structure_cancel = defineOperation({
  id: "org.payroll.structure.cancel",
  title: "Cancel a salary structure",
  about:
    "Cancels a salary structure no submitted assignment names. Slips already made with it keep what they were made " +
    "with. An assignment is cancelled with `org payroll structure unassign`.",
  area: HR_AREA,
  command: "org payroll structure cancel",
  priority: "normal",
  implementedBy: flow_client_org_payroll_structures_cancel,
  who: WHO_HR,
  changes: "The structure, cancelled.",
  acceptance: [
    hrClaim(
      "A structure no assignment names is cancelled.",
      "cli: from org-with-employees, Pat's `org payroll structure cancel <Contractors> --org acme --json` prints `docstatus: " +
        "cancelled`; trace: one salary_structure_transitioned submitted → cancelled.",
    ),
    hrClaim(
      "A structure an assignment still names is not cancelled.",
      "cli: from org-with-employees, `org payroll structure cancel <Standard>` exits WRONG_STATE naming its three assignments; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_structures_cancel.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("cancels Contractors"),
    unknownId("structures", "sst_"),
    hrWrong("Standard is named by three submitted assignments: the refusal names them, and nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_payroll_structure_assign = defineOperation({
  id: "org.payroll.structure.assign",
  title: "Assign a salary structure to an Employee",
  about:
    "Assigns a submitted structure to an Employee from a day, on a base (and a variable amount, if any) in its token, " +
    "paid from their department or the budget named. From that day it pays them in place of any earlier assignment. " +
    "An agreement's own structure is assigned only by the agreement.",
  area: HR_AREA,
  command: "org payroll structure assign",
  priority: "critical",
  implementedBy: flow_client_org_payroll_structures_assign,
  who: WHO_HR,
  changes: "One submitted assignment, and its line in payroll's change log.",
  acceptance: [
    hrClaim(
      "A structure is assigned to an Employee from a day on a base, and the next run pays by it.",
      "cli: from org-with-employees, Pat's `org payroll structure assign <Contractors> <Sam> --start <this month's first " +
        "day> --base 5000 --org acme --json` prints a submitted assignment, base 5000.00, department `salaries`; `org " +
        "employee get <Sam>` shows it; a run of `salaries` for this month gives Sam 5000.00 gross, no Pension, net 5000.00.",
    ),
    hrClaim(
      "An Employee who left is not assigned, and no assignment starts before they joined.",
      "cli: from org-with-employees, `org payroll structure assign <Standard> <Leo> --start <today> --base 3000` exits " +
        "WRONG_STATE; `… <Standard> <Noor> --start <a day before she joined> --base 3000` exits INVALID_INPUT naming " +
        "`--start`; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_structures_assign.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("assigns Contractors to Sam"),
    hrInvalid("The Employee or structure is none of Acme's, `--start` is before the Employee joined, or `--department` names none of its budgets: the refusal names the field."),
    hrWrong("Leo has left: the refusal names `left`, and nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_payroll_structure_unassign = defineOperation({
  id: "org.payroll.structure.unassign",
  title: "Cancel a salary structure assignment",
  about:
    "Cancels a structure assignment that no live slip names and no agreement mirrors. One that a slip names stays, so " +
    "the slip keeps what it was made with: a later assignment, from a later day, takes over from it instead.",
  area: HR_AREA,
  command: "org payroll structure unassign",
  priority: "normal",
  implementedBy: flow_client_org_payroll_structures_unassign,
  who: WHO_HR,
  changes: "The assignment, cancelled.",
  acceptance: [
    hrClaim(
      "An assignment no live slip names is cancelled.",
      "cli: from org-with-employees, Pat's `org payroll structure unassign <Ana's assignment> --org acme --json` prints " +
        "`docstatus: cancelled`; `org employee get <Ana>` shows a null assignment; trace: one " +
        "salary_structure_assignment_transitioned submitted → cancelled.",
    ),
    hrClaim(
      "An assignment a submitted slip names stays.",
      "cli: from org-with-payroll-runs, `org payroll structure unassign <Sam's assignment>` exits WRONG_STATE naming the runs whose slips name it; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_structures_unassign.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("cancels Ana's assignment"),
    unknownId("assignments", "ssa_"),
    hrWrong("Sam's assignment is named by his slips of all three runs: the refusal names the runs, and nothing is written.", W_RUNS),
  ],
  budget: budget("write"),
});

export const operation_org_payroll_structure_list = defineOperation({
  id: "org.payroll.structure.list",
  title: "List salary structures and assignments",
  about: "Lists the Organization's submitted salary structures with their rows, and their assignments; `--employee` keeps one Employee's.",
  area: HR_AREA,
  command: "org payroll structure list",
  priority: "normal",
  implementedBy: flow_client_org_payroll_structures_list,
  who: WHO_HR,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "The structures list with their assignments, and one Employee's alone with `--employee`.",
      "cli: from org-with-employees, Pat's `org payroll structure list --org acme --json` lists Contractors and Standard, " +
        "submitted, and Standard's assignments to Ana (3500.00), Noor (3000.00) and Sam (4000.00); `--employee <Sam>` lists Sam's alone.",
    ),
  ],
  returns: flow_client_org_payroll_structures_list.output,
  errors: HR_ERRORS_CLI,
  refusals: [...peopleOnly("lists the structures"), hrInvalid("`--employee` names none of Acme's Employees: nothing is listed.")],
  budget: budget("read"),
});

// Payroll runs

export const operation_org_payroll_run_create = defineOperation({
  id: "org.payroll.run.create",
  title: "Draft a department's payroll run for a period",
  about:
    "Drafts a department's payroll run for a period, as Frappe HR's Payroll Entry: one slip for each of its active " +
    "Employees with a structure assignment, or for those named, each worked out from that assignment (gross, " +
    "deductions, net), prorated by the days employed and any leave without pay. Nothing is owed until it is " +
    "submitted. An Employee's period is in at most one live run. A structure whose formulas Capxul cannot work out " +
    "is run by a connected head instead.",
  area: HR_AREA,
  command: "org payroll run create",
  priority: "critical",
  implementedBy: flow_client_org_payroll_runs_create,
  who: WHO_HR,
  changes: "One draft run and its draft slips; nothing owed, no accrual posted.",
  acceptance: [
    hrClaim(
      "A department's run is drafted for a period, each slip worked out from its Employee's assignment.",
      "cli: from org-with-employees, Pat's `org payroll run create salaries --start <this month's first day> --end <its last " +
        "day> --org acme --json` prints a `pe_` run, `status: draft`, with Noor's slip (gross 3000.00, PEN 150.00, net " +
        "2850.00) and Sam's (4000.00, 200.00, 3800.00), and suspended Ana left out; trace: one payroll_entry_transitioned to " +
        "draft and one salary_slip_transitioned to draft per slip.",
    ),
    hrClaim(
      "Leave without pay prorates a slip by its payment days.",
      "cli: from org-with-employees, the same command with `--unpaid <Sam>=3` gives Sam's slip three fewer payment days " +
        "than the month has, B at 4000.00 times its payment days over its days, rounded half to even, PEN 200.00, and the net the difference.",
    ),
    hrClaim(
      "An Employee's period is in at most one live run.",
      "cli: from org-with-payroll-runs, `org payroll run create salaries` for this month exits WRONG_STATE naming this month's draft run; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_runs_create.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("drafts a run of `salaries`"),
    hrInvalid(
      "The department is none of Acme's budgets, the end is before the start, or a named Employee (`--employee <Leo>`) is " +
        "not one the department can pay this period: the refusal names the field.",
    ),
    hrWrong("This month's run of `salaries` already holds Sam's and Noor's period: the refusal names it, and nothing is written.", W_RUNS),
  ],
  budget: budget("write"),
});

export const operation_org_payroll_run_submit = defineOperation({
  id: "org.payroll.run.submit",
  title: "Submit a drafted payroll run",
  about:
    "Submits a drafted run: its slips are worked out once more, so any change since the draft is in them, then fixed " +
    "and owed, each payslip stored as a document its payment will carry the hash of, and the run's accrual posted to " +
    "the books. Only a draft is submitted.",
  area: HR_AREA,
  command: "org payroll run submit",
  priority: "critical",
  implementedBy: flow_client_org_payroll_runs_submit,
  who: WHO_HR,
  changes: "The run and its slips, submitted; each payslip stored; the run's accrual posted through books.",
  acceptance: [
    hrClaim(
      "A drafted run is submitted: its slips are fixed and owed, and each payslip is stored.",
      "cli: from org-with-payroll-runs, Pat's `org payroll run submit <this month's run> --org acme --json` prints `status: " +
        "submitted` and each slip `submitted` with a `document` id and hash; read: `document render` of Sam's payslip names " +
        "Sam and Acme; trace: one payroll_entry_transitioned draft → submitted.",
    ),
    hrClaim(
      "Submitting works the slips out again, so a change since the draft is in them.",
      "cli: from org-with-payroll-runs, after `org payroll structure assign <Contractors> <Sam> --start <this month's first " +
        "day> --base 5000`, `org payroll run submit <this month's run>` prints Sam's slip at 5000.00 net and names it in `recomputed`.",
    ),
    hrClaim(
      "Only a draft is submitted.",
      "cli: from org-with-payroll-runs, `org payroll run submit <last month's run>` exits WRONG_STATE naming `submitted`; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_runs_submit.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("submits this month's run", W_RUNS),
    unknownId("runs", "pe_", W_RUNS),
    hrWrong("Last month's run is already submitted: the refusal names `submitted`, and nothing is written.", W_RUNS),
  ],
  budget: budget("write"),
});

export const operation_org_payroll_run_pay = defineOperation({
  id: "org.payroll.run.pay",
  title: "Pay a submitted payroll run",
  about:
    "Pays a submitted run: every unpaid submitted slip's net, as one payment command from the run's department budget " +
    "with one approval, which the caller signs from their own Safe. An Employee with no account yet is paid into a " +
    "claim escrow from the budget, collected when they claim it. A withheld slip stays out; once released it is paid " +
    "by naming it (`--slip`). A lapsed approval resumes the same command, so a run is never paid twice. Paying is the " +
    "department's: whoever wears its hat, or the hat of a budget above it, when the payment is made.",
  area: HR_AREA,
  command: "org payroll run pay",
  priority: "critical",
  implementedBy: flow_client_org_payroll_runs_pay,
  who: WHO_BUDGET,
  changes:
    "One payment command from the department's budget and its one approval; the run and its slips paying; once settled, " +
    "each slip paid (or escrowed) with the settled facts.",
  acceptance: [
    hrClaim(
      "One approval pays every unpaid submitted slip of the run, each to its Employee's Safe.",
      "cli: from org-with-payroll-runs, Lead's `org payroll run pay <last month's run> --org acme --json` signs one approval " +
        "and prints the run `paid`, Sam's slip `paid` with a payment id and transaction, Noor's still `withheld`; chain: one " +
        "UserOperation from Lead's Safe whose Budgets.spend from `salaries` pays 3800 USDC to Sam's Safe; trace: one " +
        "payroll_entry_transitioned submitted → paying and one paying → paid.",
    ),
    hrClaim(
      "An Employee with no account is paid into a claim escrow from the budget.",
      "read: from org-with-payroll-runs, `org payroll run get <the first run>` shows Noor's slip `escrowed` and Sam's `paid`; " +
        "chain: a claim escrow holds 2850 USDC for the Safe noor@acme.test's account will have.",
    ),
    hrClaim(
      "Whoever wears the department's hat when it pays may pay, never the one who drafted it or the one swapped out.",
      "cli: from org-with-payroll-runs, Pat's `org payroll run pay <last month's run>` exits ROLE_PERMISSION_DENIED; after " +
        "the Board moves `salaries`' office from Lead to Plat (`org department holder remove salaries lead@acme.test`, then " +
        "`holder add salaries plat@acme.test`, both Directors approving), Lead's exits ROLE_PERMISSION_DENIED and Plat's " +
        "pays it; world: one payment command for the run, prepared by Plat.",
    ),
    hrClaim(
      "A released slip is paid under the run's next attempt by naming it, and asking twice pays once.",
      "cli: from org-with-payroll-runs, after Lead pays last month's run and Pat runs `org payslip release <Noor's slip>`, " +
        "Lead's `org payroll run pay <it> --slip <Noor's slip> --request-key k1` escrows her net; the same command with " +
        "`--request-key k1` again prints the same approvalId; world: one more payment command, not two.",
    ),
    hrClaim(
      "A lapsed approval resumes the same command, never a second.",
      "cli: from org-with-payroll-runs, Lead's `org payroll run pay <last month's run> --no-wait` prints an approval and " +
        "`next`; after it lapses unsigned (`capxul dev time warp 2h`) the run reads `submitted`, and Lead's next `org payroll " +
        "run pay <it>` opens a new approval on the same payment command with the same payment ids; world: one payment command for the run.",
    ),
  ],
  returns: flow_client_org_payroll_runs_pay.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    hrSignedOut,
    hrOutsider(W_RUNS),
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W_RUNS,
      when:
        "Pat, who wears the People hat and drafted the run, but whose Safe wears neither `salaries`' office hat nor one " +
        "above it, pays it: Budgets does not authorise her, and nothing is prepared or signed.",
    },
    hrInvalid("The run is none of Acme's, or a `--slip` is not one of its slips: nothing is prepared.", W_RUNS),
    hrWrong("This month's run is a draft, or a named slip is withheld, paying or paid: the refusal names its status, and nothing is prepared.", W_RUNS),
    {
      error: error_PAYROLL_BUDGET_EXCEEDED,
      given: W_BUDGET_USED,
      when: "`salaries` has 1,350 USDC left this month, less than the 3,800 last month's run pays: nothing is prepared or signed.",
    },
    {
      error: error_INSUFFICIENT_BALANCE,
      given: W_SHORT_SAFE,
      when: "The company Safe holds 1,000 USDC, less than the 3,800 last month's run pays, though `salaries` has room: nothing is prepared or signed.",
    },
    { error: error_CANCELLED, given: W_RUNS, when: "Lead declines the run's approval on the approval page: the run stays submitted, and nothing is sent." },
  ],
  budget: budget("chain-submit"),
});

export const operation_org_payroll_run_cancel = defineOperation({
  id: "org.payroll.run.cancel",
  title: "Cancel a payroll run nothing of which was paid",
  about:
    "Cancels a draft or submitted run, with its slips, while nothing of it is paid, on its way or waiting in a claim " +
    "escrow. A submitted run's accrual is cancelled with it, and its payslips stay stored, as every document does. A " +
    "run a connected head computed is cancelled on the head.",
  area: HR_AREA,
  command: "org payroll run cancel",
  priority: "normal",
  implementedBy: flow_client_org_payroll_runs_cancel,
  who: WHO_HR,
  changes: "The run and its slips, cancelled; a submitted run's accrual cancelled through books.",
  acceptance: [
    hrClaim(
      "A run nothing of which was paid is cancelled, with its slips, and the period can be run again.",
      "cli: from org-with-payroll-runs, Pat's `org payroll run cancel <this month's run> --org acme --json` prints `status: " +
        "cancelled` with each slip cancelled; `org payroll run create salaries` for this month then drafts again; trace: " +
        "one payroll_entry_transitioned draft → cancelled.",
    ),
    hrClaim(
      "A submitted run with nothing paid is cancelled; one with a slip paid or escrowed is not.",
      "cli: from org-with-payroll-runs, `org payroll run cancel <last month's run>` prints `cancelled` and its payslips stay " +
        "readable; `org payroll run cancel <the first run>` exits WRONG_STATE naming Sam's paid and Noor's escrowed slips.",
    ),
  ],
  returns: flow_client_org_payroll_runs_cancel.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("cancels this month's run", W_RUNS),
    unknownId("runs", "pe_", W_RUNS),
    hrWrong("The first run has Sam's slip paid and Noor's escrowed: the refusal names them, and nothing is written.", W_RUNS),
  ],
  budget: budget("write"),
});

export const operation_org_payroll_run_list = defineOperation({
  id: "org.payroll.run.list",
  title: "List the Organization's payroll runs",
  about: "Lists the Organization's runs, newest first, each with its department, period, status, head count, net total and the next command to run.",
  area: HR_AREA,
  command: "org payroll run list",
  priority: "normal",
  implementedBy: flow_client_org_payroll_runs_list,
  who: WHO_HR,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "The runs list newest first, with their status, head count, net total and next step.",
      "cli: from org-with-payroll-runs, Pat's `org payroll run list --org acme --json` lists this month's run (draft, 2, " +
        "6650.00, next `org payroll run submit`), last month's (submitted, next `org payroll run pay`) and the first " +
        "(paying); `--status draft` lists this month's alone.",
    ),
  ],
  returns: flow_client_org_payroll_runs_list.output,
  errors: HR_ERRORS_CLI,
  refusals: [...peopleOnly("lists the runs", W_RUNS), hrInvalid("`--department` names none of Acme's budgets: nothing is listed.", W_RUNS)],
  budget: budget("read"),
});

export const operation_org_payroll_run_get = defineOperation({
  id: "org.payroll.run.get",
  title: "Read one payroll run with its slips",
  about: "Reads one run: its totals and each slip with its rows and status, and, once paid, the settled facts that came back from the chain.",
  area: HR_AREA,
  command: "org payroll run get",
  priority: "critical",
  implementedBy: flow_client_org_payroll_runs_get,
  who: WHO_HR,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "One run reads with each slip's rows and, once paid, the settled facts.",
      "cli: from org-with-payroll-runs, Pat's `org payroll run get <the first run> --org acme --json` shows Sam's slip `paid` " +
        "with its payment id, transaction, block and paid-at time, and Noor's `escrowed`, each with B and PEN rows; chain: " +
        "that transaction holds the PaymentSent of 3800 USDC to Sam's Safe.",
    ),
  ],
  returns: flow_client_org_payroll_runs_get.output,
  errors: HR_ERRORS_CLI,
  refusals: [...peopleOnly("reads the first run", W_RUNS), unknownId("runs", "pe_", W_RUNS)],
  budget: budget("read"),
});

// Payslips: the Organization's hold on one

export const operation_org_payslip_withhold = defineOperation({
  id: "org.payslip.withhold",
  title: "Withhold a payslip from its run's payment",
  about:
    "Holds one submitted slip out of its run's payment, with the reason, as Frappe HR's Salary Withholding: the run's " +
    "payment pays the others, and the slip stays owed until it is released. A slip whose approval lapsed is retried, " +
    "not withheld. A run a connected head computed is withheld on the head.",
  area: HR_AREA,
  command: "org payslip withhold",
  priority: "normal",
  implementedBy: flow_client_org_payslips_withhold,
  who: WHO_HR,
  changes: "The slip, withheld, with its reason.",
  acceptance: [
    hrClaim(
      "A submitted slip is held out of its run's payment, with its reason.",
      "cli: from org-with-payroll-runs, Pat's `org payslip withhold <Sam's slip of last month's run> --reason \"Hours under " +
        "review\" --org acme --json` prints the run with Sam's slip `withheld`, `withholdingReason` that text; trace: one " +
        "salary_slip_transitioned submitted → withheld.",
    ),
    hrClaim(
      "A paid slip is not withheld.",
      "cli: from org-with-payroll-runs, `org payslip withhold <Sam's slip of the first run> --reason x` exits WRONG_STATE naming `paid`; world: no diff.",
    ),
  ],
  returns: flow_client_org_payslips_withhold.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("withholds Sam's slip", W_RUNS),
    unknownId("slips", "slip_", W_RUNS),
    hrWrong("Sam's slip of the first run is paid: the refusal names `paid`, and nothing is written.", W_RUNS),
  ],
  budget: budget("write"),
});

export const operation_org_payslip_release = defineOperation({
  id: "org.payslip.release",
  title: "Release a withheld payslip",
  about: "Releases a withheld slip: it is owed again, and paid with its run's payment, or, once the run has been paid, by `org payroll run pay --slip`.",
  area: HR_AREA,
  command: "org payslip release",
  priority: "normal",
  implementedBy: flow_client_org_payslips_release,
  who: WHO_HR,
  changes: "The slip, submitted again: owed.",
  acceptance: [
    hrClaim(
      "A released slip is owed again, and the run's payment pays it.",
      "cli: from org-with-payroll-runs, Pat's `org payslip release <Noor's slip of last month's run> --org acme --json` " +
        "prints her slip `submitted`; Lead's `org payroll run pay <last month's run>` then pays Sam's slip and escrows " +
        "Noor's under one approval; trace: one salary_slip_transitioned withheld → submitted.",
    ),
    hrClaim(
      "Only a withheld slip is released.",
      "cli: from org-with-payroll-runs, `org payslip release <Sam's slip of last month's run>` exits WRONG_STATE naming `submitted`; world: no diff.",
    ),
  ],
  returns: flow_client_org_payslips_release.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("releases Noor's slip", W_RUNS),
    unknownId("slips", "slip_", W_RUNS),
    hrWrong("Sam's slip of last month's run is not withheld: the refusal names `submitted`, and nothing is written.", W_RUNS),
  ],
  budget: budget("write"),
});

// Payslips: the payee's own

export const operation_payslip_list = defineOperation({
  id: "payslip.list",
  title: "List your payslips",
  about:
    "Lists the payslips that pay your own Safe, from every Organization that pays you, newest first: run slips and " +
    "agreement collections alike, each with its payer, totals, status and, once paid, its payment. Drafts and " +
    "cancelled slips are never shown: nothing was owed. `--employer` keeps one payer's.",
  area: HR_AREA,
  command: "payslip list",
  priority: "critical",
  implementedBy: flow_client_me_payslips_list,
  who: WHO_SELF,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "You see the payslips that pay your own Safe, newest first, and never a draft or another's.",
      "cli: from org-with-payroll-runs, Sam's `payslip list --json` lists his slip of last month's run (submitted) and of " +
        "the first run (paid, net 3800.00, payer Acme), and not this month's draft nor any of Noor's.",
    ),
    hrClaim(
      "`--employer` keeps one payer's payslips, and a page holds at most `--limit`.",
      "cli: from org-with-payroll-runs, Sam's `payslip list --employer acme` lists the same two; `--limit 1` lists last " +
        "month's slip and a `nextCursor`, and `--after <it>` the first run's with `nextCursor` null.",
    ),
  ],
  returns: flow_client_me_payslips_list.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    hrSignedOut,
    hrInvalid("`--employer` names no Organization (`nowhere`), or `--after` is a cursor this list did not give: nothing is listed.", W_RUNS),
  ],
  budget: budget("read"),
});

export const operation_payslip_get = defineOperation({
  id: "payslip.get",
  title: "Read one of your payslips",
  about:
    "Reads one payslip that pays your own Safe: its payer, period, rows, totals, status and, once paid, its payment and " +
    "its stored document, which `document render` shows. Another person's payslip is theirs alone.",
  area: HR_AREA,
  command: "payslip get",
  priority: "normal",
  implementedBy: flow_client_me_payslips_get,
  who: WHO_SELF,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "One of your payslips reads with its rows, totals, payer and payment.",
      "cli: from org-with-payroll-runs, Sam's `payslip get <his slip of the first run> --json` prints payer Acme, B " +
        "4000.00, PEN 200.00, net 3800.00, `status: paid`, its payment id and transaction; read: `document render` of its " +
        "document names Sam.",
    ),
    hrClaim(
      "Another person's payslip is refused, even to the People hat of the Organization that pays it.",
      "cli: from org-with-payroll-runs, Sam's `payslip get <Noor's slip of the first run>` and Pat's each exit ROLE_PERMISSION_DENIED; world: no diff.",
    ),
  ],
  returns: flow_client_me_payslips_get.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    hrSignedOut,
    hrInvalid("The id names no slip the caller may see: Sam's own draft slip of this month's run, or a well-formed `slip_` id that names nothing.", W_RUNS),
    { error: error_ROLE_PERMISSION_DENIED, given: W_RUNS, when: "Sam asks for Noor's slip of the first run, which pays her Safe: nothing is read." },
  ],
  budget: budget("read"),
});

/** The 28 commands of payroll.hr-surface, in its order. */
export const NEW_OPERATIONS = [
  operation_org_employee_add,
  operation_org_employee_change,
  operation_org_employee_get,
  operation_org_employee_list,
  operation_org_employee_suspend,
  operation_org_employee_deactivate,
  operation_org_employee_reinstate,
  operation_org_employee_leave,
  operation_org_payroll_component_add,
  operation_org_payroll_component_change,
  operation_org_payroll_component_list,
  operation_org_payroll_component_disable,
  operation_org_payroll_component_enable,
  operation_org_payroll_structure_create,
  operation_org_payroll_structure_cancel,
  operation_org_payroll_structure_assign,
  operation_org_payroll_structure_unassign,
  operation_org_payroll_structure_list,
  operation_org_payroll_run_create,
  operation_org_payroll_run_submit,
  operation_org_payroll_run_pay,
  operation_org_payroll_run_cancel,
  operation_org_payroll_run_list,
  operation_org_payroll_run_get,
  operation_org_payslip_withhold,
  operation_org_payslip_release,
  operation_payslip_list,
  operation_payslip_get,
] as const;

/** The commands an Organization's first payroll needs (payroll.critical-commands). */
export const CRITICAL_OPERATIONS = NEW_OPERATIONS.filter((o) => o.priority === "critical");
