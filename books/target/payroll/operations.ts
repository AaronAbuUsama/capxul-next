// The eleven frozen operations payroll owns (OPERATION_OWNERS: area payroll), each built from its
// frozen text, and then, at the end of the file, Frappe HR's 28 commands beyond the 215 (payroll.hr-surface) and
// the 45 HR commands after them (payroll.hr-commands; rules.new-operations books them here). Acceptance lines keep
// their claim word for word (P1), except the lines opening "On
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
  flow_client_me_payroll_agreements_accept,
  flow_client_me_payroll_agreements_collect,
  flow_client_org_payroll_agreements_change,
  flow_client_org_payroll_agreements_end,
  flow_client_org_payroll_agreements_offer,
  flow_client_org_payroll_agreements_pause,
  flow_client_org_payroll_agreements_resume,
  flow_client_org_payroll_agreements_withdraw,
} from "./flows.ts";
import {
  flow_client_me_payroll_payslips_get,
  flow_client_me_payroll_payslips_list,
  flow_client_org_hr_employees_add,
  flow_client_org_hr_employees_change,
  flow_client_org_hr_employees_deactivate,
  flow_client_org_hr_employees_get,
  flow_client_org_hr_employees_leave,
  flow_client_org_hr_employees_list,
  flow_client_org_hr_employees_reinstate,
  flow_client_org_hr_employees_suspend,
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
  flow_client_org_payroll_payslips_release,
  flow_client_org_payroll_payslips_withhold,
} from "./flows.ts";
import { flow_client_org_payroll_runs_pay } from "./staged.ts";
import { WHO_HR } from "./employees.ts";
import { rpc_payroll_holders_list } from "./holders.ts";
import { rpc_payroll_payees_list, rpc_payroll_payees_show } from "./payees.ts";
import { Agreement, AgreementRow, CollectionPayment, Department, HolderWriteReturns, Status } from "./shapes.ts";
import {
  WHO_LEAVE_APPROVER,
  WHO_LEAVE_READER,
  WHO_MEMBER,
  WHO_SELF_HR,
  rpc_payroll_holidays_add,
  rpc_payroll_holidays_list,
  rpc_payroll_holidays_remove,
  rpc_payroll_leave_allocate,
  rpc_payroll_leave_apply,
  rpc_payroll_leave_approve,
  rpc_payroll_leave_balance,
  rpc_payroll_leave_cancel,
  rpc_payroll_leave_list,
  rpc_payroll_leave_mine,
  rpc_payroll_leave_my_balance,
  rpc_payroll_leave_reject,
  rpc_payroll_leave_types_add,
  rpc_payroll_leave_types_change,
  rpc_payroll_leave_types_list,
  rpc_payroll_leave_unallocate,
} from "./leave.ts";
import {
  rpc_payroll_attendance_cancel,
  rpc_payroll_attendance_checkin,
  rpc_payroll_attendance_list,
  rpc_payroll_attendance_mark,
  rpc_payroll_attendance_mine,
  rpc_payroll_shift_types_add,
  rpc_payroll_shift_types_assign,
  rpc_payroll_shift_types_list,
  rpc_payroll_shift_types_unassign,
} from "./attendance.ts";
import {
  WHO_DEPARTMENT,
  WHO_EXPENSE_READER,
  flow_client_org_hr_advances_pay,
  flow_client_org_hr_advances_settle,
  flow_client_org_hr_expense_claims_pay,
  rpc_payroll_advances_get,
  rpc_payroll_advances_list,
  rpc_payroll_advances_mine,
  rpc_payroll_advances_reject,
  rpc_payroll_advances_request,
  rpc_payroll_advances_withdraw,
  rpc_payroll_expense_claims_approve,
  rpc_payroll_expense_claims_cancel,
  rpc_payroll_expense_claims_create,
  rpc_payroll_expense_claims_get,
  rpc_payroll_expense_claims_list,
  rpc_payroll_expense_claims_mine,
  rpc_payroll_expense_claims_mine_get,
  rpc_payroll_expense_claims_reject,
  rpc_payroll_expense_claims_withdraw,
  rpc_payroll_expense_types_add,
  rpc_payroll_expense_types_list,
} from "./expenses.ts";

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

/**
 * The command tree puts every agreement command in the payroll group (surface.payroll-group, payroll.surface-moves):
 * `agreement accept` is `payroll agreement accept`, `org agreement offer` is `org payroll agreement offer`. The frozen
 * text is copied, and where it quotes an agreement command it quotes it as the tree spells it; the id, title, claims
 * and refusals are kept.
 */
const AGREEMENT_COMMAND = /(?<=`|capxul )(org )?agreement (?=(?:accept|collect|list|show|offer|change|pause|resume|end|withdraw)\b)/g;
const inTree = (text: string) => text.replace(AGREEMENT_COMMAND, (_m, org: string | undefined) => `${org ?? ""}payroll agreement `);
const agreementText = (id: FrozenId) => {
  const t = frozenText(id);
  return {
    ...t,
    command: t.command.startsWith("org ") ? `org payroll ${t.command.slice(4)}` : `payroll ${t.command}`,
    about: inTree(t.about),
    who: inTree(t.who),
    ...(t.changes ? { changes: inTree(t.changes) } : {}),
    ...(t.notes ? { notes: t.notes.map(inTree) } : {}),
    ...(t.mistakes ? { mistakes: t.mistakes.map((m) => ({ what: inTree(m.what), fix: inTree(m.fix) })) } : {}),
  };
};

const ON_CHAIN_AS_HOLDER = (fn: string) =>
  `chain: the landed operation's sender is the holder's own Safe and its one call is Agreements.${fn}; cli: as a member ` +
  "whose Safe Budgets does not authorise, it exits ROLE_PERMISSION_DENIED; world: no write and no approval for that attempt.";

// ── the payee ───────────────────────────────────────────────────────────────────────────────

export const operation_agreement_accept = defineOperation({
  ...agreementText("agreement.accept"),
  priority: "normal",
  implementedBy: flow_client_me_payroll_agreements_accept,
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
      "chain: AgreementAccepted for the agreement; read: `payroll agreement show` reads `active`; trace: exactly one " +
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
  ...agreementText("agreement.collect"),
  priority: "normal",
  implementedBy: flow_client_me_payroll_agreements_collect,
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
      "world org-with-short-safe: cli exits PAYER_BALANCE_TOO_LOW with nothing signed and `payroll agreement show` keeps the same " +
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
  ...agreementText("agreement.list"),
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
  ...agreementText("agreement.show"),
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
      "cli: `payroll agreement accept --terms-hash` with the shown hash prepares; chain: the landed acceptance carries that termsHash.",
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
  ...agreementText("org.agreement.offer"),
  priority: "normal",
  implementedBy: flow_client_org_payroll_agreements_offer,
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
      "chain: AgreementOffered and Budgets' Committed for its reservation; read: `org payroll agreement list` reads it `offered` and " +
        "the department's left drops by the reservation; trace: exactly one agreement_write_transitioned to `landed` with " +
        "change `offered`, prepared_by the holder and occurred_at the block's time.",
    ),
    kept(
      "org.agreement.offer",
      3,
      "chain: AgreementOffered's payee is Companies House's safeAddressFor of the email; cli: once that person signs in, " +
        "`payroll agreement list` shows the offer.",
    ),
    kept(
      "org.agreement.offer",
      4,
      "chain: AgreementOffered's payee is the Organization's Safe; cli: `payroll agreement list --org` as its member shows the offer.",
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
  ...agreementText("org.agreement.change"),
  priority: "normal",
  implementedBy: flow_client_org_payroll_agreements_change,
  acceptance: [
    kept(
      "org.agreement.change",
      1,
      "chain: RateChanged effective at the block's time; read: `org payroll agreement list` shows the new rate; trace: exactly one " +
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
  ...agreementText("org.agreement.end"),
  priority: "normal",
  implementedBy: flow_client_org_payroll_agreements_end,
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
  ...agreementText("org.agreement.list"),
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
  ...agreementText("org.agreement.pause"),
  priority: "normal",
  implementedBy: flow_client_org_payroll_agreements_pause,
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
  ...agreementText("org.agreement.resume"),
  priority: "normal",
  implementedBy: flow_client_org_payroll_agreements_resume,
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
  ...agreementText("org.agreement.withdraw"),
  priority: "normal",
  implementedBy: flow_client_org_payroll_agreements_withdraw,
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
/** org-with-payroll-runs with the backend's chain node failing every read. */
const W_CHAIN_DOWN = "org-with-payroll-runs-chain-unreachable";

const WHO_BUDGET =
  "A signed-in member of the Organization, person or agent, whose own Safe `Budgets.authorised` admits on the run's " +
  "department budget when it pays: a wearer in good standing of that budget's hat or of the hat of any budget above it, " +
  "as the chain reads it then. Authority follows the hat, never the person who drafted the run or paid it before: " +
  "someone swapped out of the department can no longer pay its runs, and whoever wears its hat next can. A self-run " +
  "own agent pays only through a hat its Safe was granted, by the Board or by an office above; the hosted FDE only as " +
  "the member who asked it, handing the approval to their Safe to sign (rules.fde-acts-for-asker). Never the Board " +
  "itself, which spends from no budget.";

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

export const operation_org_hr_employee_add = defineOperation({
  id: "org.hr.employee.add",
  title: "Add a person as an Employee",
  about:
    "Adds a person as an active Employee of the Organization, in Frappe HR's Employee shape, paid from the department " +
    "named: one of its budgets, by key or id. The person is a Party, as G5 names one: the mailbox they keep, an " +
    "`@handle`, their Safe's 0x address or a Party id. " +
    "Someone with no Capxul account yet is employed and paid all the same: their pay waits in a claim escrow until they " +
    "claim it. Pay goes to the Safe of the mailbox they keep, never a work address. A person has at most one live " +
    "Employee in an Organization, and one who left and comes back is a new Employee. Being paid from a department gives " +
    "no authority over it: that belongs to whoever wears its hat.",
  area: HR_AREA,
  command: "org hr employee add",
  priority: "critical",
  implementedBy: flow_client_org_hr_employees_add,
  who: WHO_HR,
  changes: "One Employee, active, and its line in payroll's change log, which a connected head's sync pushes.",
  acceptance: [
    hrClaim(
      "A person with no account is added as an active Employee, paid at the Safe their mailbox derives, and shown unclaimed.",
      "cli: from org-with-employees, Pat's `org hr employee add ivy@acme.test --first-name Ivy --last-name Lund --joined <today> " +
        "--department salaries --org acme --json` prints an `emp_` id, `status: active`, `unclaimed: true`, a `payeeSafe` " +
        "and `assignment: null`; read: `org hr employee get` of that id prints the same; world: one Employee and one provisional Party added.",
    ),
    hrClaim(
      "A live Employee is not added twice; a person who left is added again as a new Employee.",
      "cli: from org-with-employees, Pat's `org hr employee add sam@acme.test --first-name Sam --joined <today> --department " +
        "salaries` exits WRONG_STATE naming Sam's `emp_` id; the same for leo@acme.test prints a new `emp_` id, active, while " +
        "`org hr employee list --status left` still lists Leo's old one; world: one Employee added in all.",
    ),
    hrClaim(
      "Only a wearer of the People hat adds an Employee: holding the department's hat is not enough.",
      "cli: from org-with-employees, Lead's `org hr employee add ivy@acme.test --first-name Ivy --joined <today> --department " +
        "salaries --org acme` exits ROLE_PERMISSION_DENIED; world: no diff.",
    ),
  ],
  returns: flow_client_org_hr_employees_add.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("adds ivy@acme.test as an Employee"),
    hrInvalid(
      "The person names nothing (`nobody`), or names an Organization (`@acme`), an agent or an outside address, since " +
        "Frappe's Employee is a person; or is a mailbox with no account whose Safe could never be claimed (not ASCII), " +
        "so no claim escrow could wait for their pay; or `--department` names none of Acme's budgets: the refusal names the field.",
    ),
    hrWrong("Sam is already a live Employee of Acme: the refusal names his `emp_` id, and nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_hr_employee_change = defineOperation({
  id: "org.hr.employee.change",
  title: "Change an Employee's department, designation or type",
  about:
    "Changes an Employee's department (the budget that pays their next run), designation or employment type, and keeps " +
    "the rest. It never moves their status, which only `org hr employee suspend`, `deactivate`, `reinstate` and `leave` " +
    "do, and never their Party, Safe or pay mailbox: pay follows the person, not the record. Moving an Employee to " +
    "another department changes who pays them, never who acts for the department.",
  area: HR_AREA,
  command: "org hr employee change",
  priority: "normal",
  implementedBy: flow_client_org_hr_employees_change,
  who: WHO_HR,
  changes: "The Employee's fields given, and its line in payroll's change log.",
  acceptance: [
    hrClaim(
      "A change sets the fields given and keeps the rest; the status, Party and pay Safe never change.",
      "cli: from org-with-employees, Pat's `org hr employee change <Sam> --designation \"Senior Engineer\" --department " +
        "engineering --org acme --json` prints the new designation and department with `status: active` and the same " +
        "`partyId` and `payeeSafe` as before; read: `org hr employee get <Sam>` agrees.",
    ),
    hrClaim(
      "A status is never a change's: it is a lifecycle command.",
      "cli: from org-with-employees, `org hr employee change <Sam> --status left --org acme` exits CLI_USAGE; world: no diff.",
    ),
  ],
  returns: flow_client_org_hr_employees_change.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("changes Sam's designation"),
    hrInvalid("The Employee is none of Acme's, or `--department` names none of its budgets: the refusal names the field, and nothing is written."),
  ],
  budget: budget("write"),
});

export const operation_org_hr_employee_get = defineOperation({
  id: "org.hr.employee.get",
  title: "Read one Employee",
  about:
    "Reads one Employee: their status, joining and relieving days, department, designation and type, whether they have " +
    "claimed their account yet, and the structure assignment that pays them today. The HR record is the People hat's; " +
    "an Employee reads their own pay with `payroll payslip list`.",
  area: HR_AREA,
  command: "org hr employee get",
  priority: "normal",
  implementedBy: flow_client_org_hr_employees_get,
  who: WHO_HR,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "One Employee reads with their status and the assignment that pays them today.",
      "cli: from org-with-employees, Pat's `org hr employee get <Sam> --org acme --json` prints `status: active`, department " +
        "`salaries`, `unclaimed: false` and the Standard assignment on a 4000.00 base from his joining day; for Leo it " +
        "prints `status: left`, his relieving day and a null assignment.",
    ),
    hrClaim(
      "An Employee does not read their own HR record without the People hat.",
      "cli: from org-with-employees, Sam's `org hr employee get <Sam> --org acme` exits ROLE_PERMISSION_DENIED; world: no diff.",
    ),
  ],
  returns: flow_client_org_hr_employees_get.output,
  errors: HR_ERRORS_CLI,
  refusals: [...peopleOnly("reads Sam's Employee"), unknownId("Employees", "emp_")],
  budget: budget("read"),
});

export const operation_org_hr_employee_list = defineOperation({
  id: "org.hr.employee.list",
  title: "List the Organization's Employees",
  about:
    "Lists the Organization's Employees by department and name, each with their status and whether they have claimed " +
    "their account yet. Those who left are listed only when asked for with `--status left`; `--department` keeps one " +
    "department's.",
  area: HR_AREA,
  command: "org hr employee list",
  priority: "critical",
  implementedBy: flow_client_org_hr_employees_list,
  who: WHO_HR,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "The live Employees list by department and name; those who left only when asked for.",
      "cli: from org-with-employees, Pat's `org hr employee list --org acme --json` lists Ana (suspended), Noor (active, " +
        "`unclaimed: true`) and Sam (active, `unclaimed: false`), and not Leo, with `nextCursor: null`; `--status left` " +
        "lists Leo alone; `--department engineering` lists none.",
    ),
    hrClaim(
      "The list pages as every list does.",
      "cli: from org-with-employees, Pat's `org hr employee list --limit 2 --org acme --json` lists Ana and Noor and a " +
        "`nextCursor`; `--after <it>` lists Sam with `nextCursor: null`.",
    ),
  ],
  returns: flow_client_org_hr_employees_list.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("lists Acme's Employees"),
    hrInvalid("`--department` names none of Acme's budgets, or `--after` is a cursor this list did not give: nothing is listed."),
  ],
  budget: budget("read"),
});

/** The refusals a status verb shares: an unknown Employee, and the state its transition does not leave from. */
const statusRefusals = (what: string, wrong: string) => [
  ...peopleOnly(what),
  unknownId("Employees", "emp_"),
  hrWrong(`${wrong} The refusal names the status, and nothing is written.`),
];

export const operation_org_hr_employee_suspend = defineOperation({
  id: "org.hr.employee.suspend",
  title: "Suspend an Employee",
  about:
    "Suspends an active Employee (Frappe's Suspended status): they stay on the books, and Capxul's runs leave them out " +
    "until they are reinstated, which is stricter than Frappe's Payroll Entry (payroll.run-employees).",
  area: HR_AREA,
  command: "org hr employee suspend",
  priority: "normal",
  implementedBy: flow_client_org_hr_employees_suspend,
  who: WHO_HR,
  changes: "The Employee's status, to suspended.",
  acceptance: [
    hrClaim(
      "An active Employee is suspended, and a new run leaves them out.",
      "cli: from org-with-employees, Pat's `org hr employee suspend <Sam> --org acme --json` prints `status: suspended`; " +
        "`org payroll run create salaries --start <this month's first day> --end <its last day>` then holds Noor's slip " +
        "only; trace: one employee_transitioned active → suspended, transition `suspend`.",
    ),
    hrClaim(
      "Only an active Employee is suspended.",
      "cli: from org-with-employees, `org hr employee suspend <Ana>` (suspended) and `<Leo>` (left) each exit WRONG_STATE naming the status; world: no diff.",
    ),
  ],
  returns: flow_client_org_hr_employees_suspend.output,
  errors: HR_ERRORS_CLI,
  refusals: statusRefusals("suspends Sam", "Ana is already suspended, or Leo has left."),
  budget: budget("write"),
});

export const operation_org_hr_employee_deactivate = defineOperation({
  id: "org.hr.employee.deactivate",
  title: "Deactivate an Employee",
  about: "Makes an active or suspended Employee inactive, as Frappe's Inactive status: kept on the books, and paid by no run until reinstated.",
  area: HR_AREA,
  command: "org hr employee deactivate",
  priority: "normal",
  implementedBy: flow_client_org_hr_employees_deactivate,
  who: WHO_HR,
  changes: "The Employee's status, to inactive.",
  acceptance: [
    hrClaim(
      "An active or suspended Employee becomes inactive, still listed, and paid by no run.",
      "cli: from org-with-employees, Pat's `org hr employee deactivate <Ana> --org acme --json` prints `status: inactive`; " +
        "`org hr employee list` still lists her; trace: one employee_transitioned suspended → inactive.",
    ),
    hrClaim(
      "An Employee who left is not deactivated.",
      "cli: from org-with-employees, `org hr employee deactivate <Leo>` exits WRONG_STATE naming `left`; world: no diff.",
    ),
  ],
  returns: flow_client_org_hr_employees_deactivate.output,
  errors: HR_ERRORS_CLI,
  refusals: statusRefusals("deactivates Ana", "Leo has left."),
  budget: budget("write"),
});

export const operation_org_hr_employee_reinstate = defineOperation({
  id: "org.hr.employee.reinstate",
  title: "Reinstate an Employee",
  about:
    "Makes an inactive or suspended Employee active again, so the next run pays them. Someone who left is never " +
    "reinstated: they are added again as a new Employee.",
  area: HR_AREA,
  command: "org hr employee reinstate",
  priority: "normal",
  implementedBy: flow_client_org_hr_employees_reinstate,
  who: WHO_HR,
  changes: "The Employee's status, to active.",
  acceptance: [
    hrClaim(
      "An inactive or suspended Employee is active again, and the next run pays them.",
      "cli: from org-with-employees, Pat's `org hr employee reinstate <Ana> --org acme --json` prints `status: active`; a run " +
        "of `salaries` for this month then holds slips for Ana, Noor and Sam, Ana's net 3325.00 (3500.00 less 175.00 " +
        "Pension); trace: one employee_transitioned suspended → active.",
    ),
    hrClaim(
      "An active Employee, or one who left, is not reinstated.",
      "cli: from org-with-employees, `org hr employee reinstate <Sam>` and `<Leo>` each exit WRONG_STATE naming the status; world: no diff.",
    ),
  ],
  returns: flow_client_org_hr_employees_reinstate.output,
  errors: HR_ERRORS_CLI,
  refusals: statusRefusals("reinstates Ana", "Sam is active, or Leo has left."),
  budget: budget("write"),
});

export const operation_org_hr_employee_leave = defineOperation({
  id: "org.hr.employee.leave",
  title: "Let an Employee go on a day",
  about:
    "The Employee leaves on the day given, their last day worked, and this is final for the record: someone who comes " +
    "back is added as a new Employee. It first previews who leaves, from when, the assignment that stops and any " +
    "withheld slip that stays owed, and asks; `--confirm` answers yes in a script. A run of a period they worked in " +
    "still pays them to that day, and no run pays them after it (payroll.run-employees). It is refused while pay of " +
    "theirs is on its way or waiting in a claim escrow, until it lands or is taken back. Their slips, and an " +
    "agreement's earned pay, stay theirs.",
  area: HR_AREA,
  command: "org hr employee leave",
  priority: "normal",
  implementedBy: flow_client_org_hr_employees_leave,
  who: `${WHO_HR} Never the hosted FDE for its asker: the preview is the member's own.`,
  changes: "The Employee's status, to left, with their relieving day; no run pays them after it.",
  acceptance: [
    hrClaim(
      "The Employee leaves on the day given, and that is final.",
      "cli: from org-with-employees, Pat's `org hr employee leave <Ana> --on <yesterday> --confirm --org acme --json` prints " +
        "`status: left` with that relieving day; `org hr employee reinstate <Ana>` then exits WRONG_STATE; read: `org hr employee " +
        "list --status left` lists Ana and Leo; trace: one employee_transitioned suspended → left.",
    ),
    hrClaim(
      "Answering no at the preview writes nothing, and a script must say `--confirm`.",
      "cli: from org-with-employees, at a terminal Pat answers no to the preview, which names Ana, the day and her Standard " +
        "assignment: exit 130, CANCELLED; with no terminal and no `--confirm`: CLI_USAGE; world: no diff after either.",
    ),
    hrClaim(
      "Someone whose pay waits in a claim escrow does not leave until it lands.",
      "cli: from org-with-payroll-runs, `org hr employee leave <Noor> --on <today> --confirm --org acme` exits WRONG_STATE " +
        "naming her escrowed slip of the first run; world: no diff.",
    ),
  ],
  returns: flow_client_org_hr_employees_leave.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("lets Ana go"),
    hrInvalid("The relieving day is before the Employee's joining day, or the Employee is none of Acme's: the refusal names the field, and nothing is written."),
    hrWrong("Leo has already left: the refusal names `left`, and nothing is written."),
    hrWrong("Noor's slip of the first run waits in a claim escrow: the refusal names it, and nothing is written.", W_RUNS),
    { error: error_CANCELLED, given: W_HR, when: "At a terminal, Pat answers no to the preview of Ana's leaving: nothing is written." },
    { error: error_CLI_USAGE, given: W_HR, when: "A script with no terminal and no `--confirm` lets Ana go: refused before any call, and nothing is written." },
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
    hrClaim(
      "Only the fields given change; the component keeps its abbreviation, type and the rest.",
      "cli: from org-with-employees, Pat's `org payroll component change PEN --formula \"base * 0.06\" --org acme " +
        "--json` prints Pension with abbreviation PEN, type deduction and `disabled: false`, as before; read: `org " +
        "payroll component list` agrees.",
    ),
    hrClaim(
      "A structure created after the change takes the new formula.",
      "cli: from org-with-employees, after that change, Pat's `org payroll structure create Senior --frequency " +
        "monthly --token USDC --earning B --deduction PEN --org acme --json` prints its PEN row at `base * 0.06`.",
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
        "`disabled: true`), with `nextCursor: null`; `--limit 2` lists Basic and Pension and a `nextCursor`, and `--after " +
        "<it>` Bonus alone.",
    ),
    hrClaim(
      "A component disabled since moves after the enabled ones, the disabled ordered by type and then name; reading writes nothing.",
      "cli: from org-with-employees, after Pat's `org payroll component disable PEN`, `org payroll component list " +
        "--org acme --json` lists Basic first and, after it, Bonus and Pension, each `disabled: true`, by type and then " +
        "name as the enabled ones are; world: the list's diff is empty.",
    ),
  ],
  returns: flow_client_org_payroll_components_list.output,
  errors: HR_ERRORS_CLI,
  refusals: [...peopleOnly("lists the components"), hrInvalid("`--after` is a cursor this list did not give: nothing is listed.")],
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
    hrClaim(
      "A component already disabled is not disabled again.",
      "cli: from org-with-employees, `org payroll component disable BON --org acme` exits WRONG_STATE naming `disabled`; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_components_disable.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("disables Pension"),
    unknownId("salary components", "sc_"),
    hrWrong("Bonus is already disabled: the refusal names `disabled`, as a second `org projects activity-type disable` is, and nothing is written."),
  ],
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
    hrClaim(
      "A component already enabled is not enabled again.",
      "cli: from org-with-employees, `org payroll component enable B --org acme` exits WRONG_STATE naming `enabled`; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_components_enable.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("enables Bonus"),
    unknownId("salary components", "sc_"),
    hrWrong("Basic is already enabled: the refusal names `enabled`, and nothing is written."),
  ],
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
        "--amends <Contractors>` prints it submitted, and `org payroll structure list`, which lists submitted structures, " +
        "shows Contractors-2 and Standard and no longer Contractors; trace: Contractors' salary_structure_transitioned " +
        "submitted → cancelled, transition `cancel`; with " +
        "`--amends <Standard>`, which three assignments name, it exits WRONG_STATE naming them, as `org payroll structure " +
        "cancel <Standard>` does; world: one structure added and one cancelled.",
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
        "or a formula names a row below it, or `--amends` names none of Acme's structures: the refusal names the row or " +
        "the field, and nothing is written.",
    ),
    hrWrong(
      "`--amends <Standard>`, which three submitted assignments still name: the refusal names them, as cancelling " +
        "Standard is refused, and nothing is written.",
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
    "paid from their department, which the assignment records as Frappe's does: a run of that department pays them " +
    "(payroll.run-employees). From that day it pays them in place of any earlier assignment. " +
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
        "hr employee get <Sam>` shows it; a run of `salaries` for this month gives Sam 5000.00 gross, no Pension, net 5000.00.",
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
    hrInvalid(
      "The Employee or structure is none of Acme's, `--start` is before the Employee joined, or `--department` names a " +
        "budget that is not the Employee's department: the refusal names the field.",
    ),
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
        "`docstatus: cancelled`; `org hr employee get <Ana>` shows a null assignment; trace: one " +
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
      "cli: from org-with-employees, Pat's `org payroll structure list --org acme --json` lists Contractors, submitted, " +
        "with no assignment, then Standard with its assignments to Ana (3500.00), Noor (3000.00) and Sam (4000.00), and " +
        "`nextCursor: null`; `--employee <Sam>` lists Standard with Sam's assignment alone; `--limit 1` lists Contractors " +
        "and a `nextCursor`.",
    ),
    hrClaim(
      "A cancelled structure leaves the list; reading writes nothing.",
      "cli: from org-with-employees, after Pat's `org payroll structure cancel <Contractors>`, `org payroll structure " +
        "list --org acme --json` lists Standard alone, with its three assignments; world: the list's diff is empty.",
    ),
  ],
  returns: flow_client_org_payroll_structures_list.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("lists the structures"),
    hrInvalid("`--employee` names none of Acme's Employees, or `--after` is a cursor this list did not give: nothing is listed."),
  ],
  budget: budget("read"),
});

// Payroll runs

export const operation_org_payroll_run_create = defineOperation({
  id: "org.payroll.run.create",
  title: "Draft a department's payroll run for a period",
  about:
    "Drafts a department's payroll run for a period, as Frappe HR's Payroll Entry: one slip for each of its Employees " +
    "with a structure assignment who is active, or who left on or after the period's first day, or for those named, " +
    "each worked out from that assignment (gross, deductions, net), prorated by the days employed and by the period's " +
    "attendance: approved unpaid leave and days marked absent, unmarked days counting present (payroll.attendance-based). " +
    "An advance being recovered is deducted. An inactive or suspended Employee is left out (payroll.run-employees). Nothing is owed until it is " +
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
      "Approved unpaid leave and days marked absent prorate a slip by its payment days.",
      "cli: from org-with-leave (Sam's approved Unpaid Leave day this month, Noor marked absent one day), Pat's `org " +
        "payroll run create salaries --start <this month's first day> --end <its last day> --org acme --json` gives Sam's " +
        "slip one payment day fewer than the month has with `leaveWithoutPay: 1`, and Noor's one fewer with `absentDays: " +
        "1`; each B at its base times its payment days over the month's days, rounded half to even, PEN unprorated, and the net the difference.",
    ),
    hrClaim(
      "A leaver's last period is paid to their relieving day, and no later period is.",
      "cli: from org-with-employees, after Pat's `org hr employee leave <Sam> --on <this month's 10th> --confirm`, `org " +
        "payroll run create salaries` for this month holds Noor's slip and Sam's with 10 payment days, B at 4000.00 " +
        "times 10 over the month's days and PEN 200.00; for next month it holds Noor's alone.",
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
        "and prints `status: paid` and the run, Sam's slip `paid` with a payment id and transaction, Noor's still `withheld`; chain: one " +
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
      "cli: from org-with-payroll-runs, after Lead pays last month's run and Pat runs `org payroll payslip release <Noor's slip>`, " +
        "Lead's `org payroll run pay <it> --slip <Noor's slip> --request-key k1` escrows her net; the same command with " +
        "`--request-key k1` again prints the same approvalId; world: one more payment command, not two.",
    ),
    hrClaim(
      "A lapsed approval resumes the same command, never a second.",
      "cli: from org-with-payroll-runs, Lead's `org payroll run pay <last month's run> --no-wait --json` prints `status: " +
        "awaiting_approval`, an `approvalId`, its `approvalUrl` and `expiresAt`, and `next`; after it lapses unsigned (`capxul dev time warp 2h`) the run reads `submitted`, and Lead's next `org payroll " +
        "run pay <it>` opens a new approval on the same payment command with the same payment ids; world: one payment command for the run.",
    ),
    hrClaim(
      "A declined approval sends nothing and leaves the run owed again, for a new command.",
      "cli: from org-with-payroll-runs, Lead declines the approval of `org payroll run pay <last month's run>` on the " +
        "approval page: exit 130, CANCELLED; read: Pat's `org payroll run get <it>` then shows the run and Sam's slip " +
        "`submitted` with no payment; Lead's next `org payroll run pay <it>` opens a new command under the next " +
        "attempt and pays Sam; chain: one Budgets.spend of 3800 USDC to Sam's Safe in all.",
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
    {
      error: error_PROVIDER_ERROR,
      given: W_CHAIN_DOWN,
      when:
        "The chain cannot be read, so whether Budgets authorises the payer, what `salaries` has left and what the company " +
        "Safe holds are unknown: nothing is prepared or signed, as the department commands refuse a chain they cannot read.",
    },
    {
      error: error_CANCELLED,
      given: W_RUNS,
      when:
        "Lead declines the run's approval on the approval page: nothing is sent, its Payments are cancelled, and the run " +
        "and its slips are back to submitted, owed, for the next `org payroll run pay` (payroll.declined-run-approval).",
    },
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
        "(paying), with `nextCursor: null`; `--status draft` lists this month's alone; `--limit 1` lists this month's and " +
        "a `nextCursor`.",
    ),
    hrClaim(
      "`--department` and `--status` filter; reading writes nothing.",
      "cli: from org-with-payroll-runs, Pat's `org payroll run list --department salaries --org acme --json` lists " +
        "all three runs, and `--status submitted` last month's alone; world: the diff is empty.",
    ),
  ],
  returns: flow_client_org_payroll_runs_list.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("lists the runs", W_RUNS),
    hrInvalid("`--department` names none of Acme's budgets, or `--after` is a cursor this list did not give: nothing is listed.", W_RUNS),
  ],
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
    hrClaim(
      "A draft run reads with its slips worked out and nothing paid.",
      "cli: from org-with-payroll-runs, Pat's `org payroll run get <this month's run> --org acme --json` shows " +
        "`status: draft`, Sam's and Noor's slips with their B and PEN rows, a net total of 6650.00, and no payment on " +
        "either slip.",
    ),
    hrClaim(
      "A withheld slip reads withheld with its reason; reading writes nothing.",
      "cli: from org-with-payroll-runs, Pat's `org payroll run get <last month's run> --org acme --json` shows Noor's " +
        "slip `withheld` with its `withholdingReason` and Sam's `submitted`; world: the diff is empty.",
    ),
  ],
  returns: flow_client_org_payroll_runs_get.output,
  errors: HR_ERRORS_CLI,
  refusals: [...peopleOnly("reads the first run", W_RUNS), unknownId("runs", "pe_", W_RUNS)],
  budget: budget("read"),
});

// Payslips: the Organization's hold on one

export const operation_org_payroll_payslip_withhold = defineOperation({
  id: "org.payroll.payslip.withhold",
  title: "Withhold a payslip from its run's payment",
  about:
    "Holds one submitted slip out of its run's payment, with the reason, as Frappe HR's Salary Withholding: the run's " +
    "payment pays the others, and the slip stays owed until it is released. A slip whose approval lapsed is retried, " +
    "not withheld. A run a connected head computed is withheld on the head.",
  area: HR_AREA,
  command: "org payroll payslip withhold",
  priority: "normal",
  implementedBy: flow_client_org_payroll_payslips_withhold,
  who: WHO_HR,
  changes: "The slip, withheld, with its reason.",
  acceptance: [
    hrClaim(
      "A submitted slip is held out of its run's payment, with its reason.",
      "cli: from org-with-payroll-runs, Pat's `org payroll payslip withhold <Sam's slip of last month's run> --reason \"Hours under " +
        "review\" --org acme --json` prints the run with Sam's slip `withheld`, `withholdingReason` that text; trace: one " +
        "salary_slip_transitioned submitted → withheld.",
    ),
    hrClaim(
      "A paid slip is not withheld.",
      "cli: from org-with-payroll-runs, `org payroll payslip withhold <Sam's slip of the first run> --reason x` exits WRONG_STATE naming `paid`; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_payslips_withhold.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("withholds Sam's slip", W_RUNS),
    unknownId("slips", "slip_", W_RUNS),
    hrWrong("Sam's slip of the first run is paid: the refusal names `paid`, and nothing is written.", W_RUNS),
  ],
  budget: budget("write"),
});

export const operation_org_payroll_payslip_release = defineOperation({
  id: "org.payroll.payslip.release",
  title: "Release a withheld payslip",
  about: "Releases a withheld slip: it is owed again, and paid with its run's payment, or, once the run has been paid, by `org payroll run pay --slip`.",
  area: HR_AREA,
  command: "org payroll payslip release",
  priority: "normal",
  implementedBy: flow_client_org_payroll_payslips_release,
  who: WHO_HR,
  changes: "The slip, submitted again: owed.",
  acceptance: [
    hrClaim(
      "A released slip is owed again, and the run's payment pays it.",
      "cli: from org-with-payroll-runs, Pat's `org payroll payslip release <Noor's slip of last month's run> --org acme --json` " +
        "prints her slip `submitted`; Lead's `org payroll run pay <last month's run>` then pays Sam's slip and escrows " +
        "Noor's under one approval; trace: one salary_slip_transitioned withheld → submitted.",
    ),
    hrClaim(
      "Only a withheld slip is released.",
      "cli: from org-with-payroll-runs, `org payroll payslip release <Sam's slip of last month's run>` exits WRONG_STATE naming `submitted`; world: no diff.",
    ),
  ],
  returns: flow_client_org_payroll_payslips_release.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    ...peopleOnly("releases Noor's slip", W_RUNS),
    unknownId("slips", "slip_", W_RUNS),
    hrWrong("Sam's slip of last month's run is not withheld: the refusal names `submitted`, and nothing is written.", W_RUNS),
  ],
  budget: budget("write"),
});

// Payslips: the payee's own

export const operation_payroll_payslip_list = defineOperation({
  id: "payroll.payslip.list",
  title: "List your payslips",
  about:
    "Lists the payslips that pay your own Safe, from every Organization that pays you, newest first: run slips and " +
    "agreement collections alike, each with its payer, totals, status and, once paid, its payment. Drafts and " +
    "cancelled slips are never shown: nothing was owed. `--employer` keeps one payer's.",
  area: HR_AREA,
  command: "payroll payslip list",
  priority: "critical",
  implementedBy: flow_client_me_payroll_payslips_list,
  who: WHO_SELF,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "You see the payslips that pay your own Safe, newest first, and never a draft or another's.",
      "cli: from org-with-payroll-runs, Sam's `payroll payslip list --json` lists his slip of last month's run (submitted) and of " +
        "the first run (paid, net 3800.00, payer Acme Ltd), and not this month's draft nor any of Noor's.",
    ),
    hrClaim(
      "`--employer` keeps one payer's payslips, and a page holds at most `--limit`.",
      "cli: from org-with-payroll-runs, Sam's `payroll payslip list --employer acme` lists the same two; `--limit 1` lists last " +
        "month's slip and a `nextCursor`, and `--after <it>` the first run's with `nextCursor` null.",
    ),
  ],
  returns: flow_client_me_payroll_payslips_list.output,
  errors: HR_ERRORS_CLI,
  refusals: [
    hrSignedOut,
    hrInvalid("`--employer` names no Organization (`nowhere`), or `--after` is a cursor this list did not give: nothing is listed.", W_RUNS),
  ],
  budget: budget("read"),
});

export const operation_payroll_payslip_get = defineOperation({
  id: "payroll.payslip.get",
  title: "Read one of your payslips",
  about:
    "Reads one payslip that pays your own Safe: its payer, period, rows, totals, status and, once paid, its payment and " +
    "its stored document, which `document render` shows. It never reads another person's payslip, even for the People " +
    "hat, which reads a run's slips with `org payroll run get`.",
  area: HR_AREA,
  command: "payroll payslip get",
  priority: "normal",
  implementedBy: flow_client_me_payroll_payslips_get,
  who: WHO_SELF,
  changes: HR_NOTHING,
  acceptance: [
    hrClaim(
      "One of your payslips reads with its rows, totals, payer and payment.",
      "cli: from org-with-payroll-runs, Sam's `payroll payslip get <his slip of the first run> --json` prints payer Acme Ltd, B " +
        "4000.00, PEN 200.00, net 3800.00, `status: paid`, its payment id and transaction; read: `document render` of its " +
        "document names Sam.",
    ),
    hrClaim(
      "Another person's payslip is refused, even to the People hat of the Organization that pays it.",
      "cli: from org-with-payroll-runs, Sam's `payroll payslip get <Noor's slip of the first run>` and Pat's each exit ROLE_PERMISSION_DENIED; world: no diff.",
    ),
  ],
  returns: flow_client_me_payroll_payslips_get.output,
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
  operation_org_hr_employee_add,
  operation_org_hr_employee_change,
  operation_org_hr_employee_get,
  operation_org_hr_employee_list,
  operation_org_hr_employee_suspend,
  operation_org_hr_employee_deactivate,
  operation_org_hr_employee_reinstate,
  operation_org_hr_employee_leave,
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
  operation_org_payroll_payslip_withhold,
  operation_org_payroll_payslip_release,
  operation_payroll_payslip_list,
  operation_payroll_payslip_get,
] as const;

/** The commands an Organization's first payroll needs (payroll.critical-commands). */
export const CRITICAL_OPERATIONS = NEW_OPERATIONS.filter((o) => o.priority === "critical");

// ── Frappe HR's HR commands beyond the 215 (rules.new-operations, CONVENTIONS rule 4a), on the pack decision ─────
// payroll.hr-commands: holidays, leave, shifts and attendance, expense claims and advances (hr-data.ts). Each id is its
// command's words joined by dots, area `payroll`, and each calls one SDK method (payroll.hr-rpc-methods): the rpc
// itself, or for the two that sign and wait and the one that previews, a flow (expenses.ts). Who runs each is a hat or
// the caller's own Party, never a named person (payroll.hr-approvers): the People hat keeps the HR records; the
// Employee applies, checks in, claims and asks for an advance, member or not (payroll.hr-self); a department's hat, or
// one above it, decides and pays its Employees' claims and advances (aaron.departments) and, with the People hat,
// decides their leave. Every refusal starts from a catalogued world (payroll.hr-worlds). The helpers W_HR,
// noPeopleHat, unknownId and peopleOnly above serve these too.

const AREA = "payroll";
const claim = (c: string, observes: string) => ({ claim: c, observes });
const NOTHING = "Nothing: it only reads.";
const CLI = [error_CLI_USAGE];

// ── the worlds (payroll.hr-worlds), each built with booked commands on org-with-employees ───────

/**
 * org-with-employees plus holidays, leave types, allocations, Sam's open and approved leave, Lead's own open leave, Noor's
 * absence; built in a month from January to November, so next month and this year's allocations share the year.
 */
const W_LEAVE = "org-with-leave";
/** org-with-leave plus the Day shift assigned to Sam from the next working day, his check-ins on two working days, and the marks they made. */
const W_ATTEND = "org-with-attendance";
/** org-with-employees plus expense types, Sam's claims (open, approved, paid) and advances (paid and claimed, paid, requested), and Lead's own open claim. */
const W_EXP = "org-with-expenses";
/** org-with-expenses with `salaries` spent to 30 USDC left this month. */
const W_EXP_BUDGET = "org-with-expenses-budget-used";
/** org-with-expenses with the company Safe holding 40 USDC. */
const W_EXP_SHORT = "org-with-expenses-short-safe";
/** org-with-expenses with the backend's chain node failing every read. */
const W_EXP_CHAIN = "org-with-expenses-chain-unreachable";

// ── refusals every family shares ────────────────────────────────────────────────────────────

const signedOut = { error: error_NOT_AUTHENTICATED, given: "signed-out", when: "No one is signed in on this machine: nothing is read or written." };
const outsider = (given: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given,
  when: "Olga, signed in and holding no Seat in Acme, names it with `--org`: refused as an Organization that does not exist is; nothing is read or written.",
});
const invalid = (when: string, given: string) => ({ error: error_INVALID_INPUT, given, when });
const wrong = (when: string, given: string) => ({ error: error_WRONG_STATE, given, when });
const memberOnly = (given: string) => [signedOut, outsider(given)];
/** A self command named for an Organization that does not employ the caller. */
const notEmployee = (given: string, more = "") =>
  invalid(
    `Mia, a member of Acme but none of its Employees, or Olga, outside it, runs it with \`--employer acme\`: the handle names no Organization employing them${more}, and nothing is read or written.`,
    given,
  );
const suspended = (what: string, given: string) =>
  wrong(`After Pat's \`org hr employee suspend <Sam>\`, Sam ${what}: the refusal names his status, suspended, and nothing is written.`, given);
const selfOnly = (given: string, more = "") => [signedOut, notEmployee(given, more)];
/** The department's refusals: the People hat and another department's hat are not this one's. */
const notDepartment = (what: string, given: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given,
  when:
    `Pat, who wears the People hat, or Plat, who wears \`platform\`'s office hat, ${what}: Budgets authorises neither on ` +
    "`salaries`, which pays Sam, so nothing is read on chain past that check or written.",
});
const chainDown = (what: string) => ({
  error: error_PROVIDER_ERROR,
  given: W_EXP_CHAIN,
  when: `The chain cannot be read, so whether Budgets authorises Lead on \`salaries\` is unknown: ${what}, as the department commands refuse a chain they cannot read.`,
});
const departmentOnly = (what: string, given: string) => [signedOut, outsider(given), notDepartment(what, given)];

// ── holidays ────────────────────────────────────────────────────────────────────────────────

export const operation_org_hr_holiday_add = defineOperation({
  id: "org.hr.holiday.add",
  title: "Add a holiday, or a year's weekly offs",
  about:
    "Adds a holiday to the Organization's Holiday List for its year, or every Saturday or Sunday (any weekday) of a " +
    "year as weekly offs, as Frappe's Holiday List does. A day off counts no leave, and is never marked absent. " +
    "Payroll counts holidays as working days, so a holiday never lowers pay by itself.",
  area: AREA,
  command: "org hr holiday add",
  priority: "normal",
  implementedBy: rpc_payroll_holidays_add,
  who: WHO_HR,
  changes: "The year's Holiday List, born with its first holiday, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A holiday is added to its year's list, which is born with it.",
      "cli: from org-with-employees, Pat's `org hr holiday add <a weekday this year> --description \"Founders' Day\" --org acme " +
        "--json` prints the list `Acme Ltd <year>` holding that day with `weeklyOff: false` and `totalHolidays: 1`; world: one Holiday List added.",
    ),
    claim(
      "A weekday is added as a weekly off on every day of the year it falls on, once.",
      "cli: from org-with-employees, Pat's `org hr holiday add --weekly sunday --year <this year> --org acme --json` prints " +
        "every Sunday of the year `weeklyOff: true`; run again, it adds none and prints the same list; world: one Holiday List added.",
    ),
    claim(
      "A day already a holiday is not added again.",
      "cli: from org-with-leave, Pat's `org hr holiday add <Founders' Day> --description Again --org acme` exits WRONG_STATE naming the day; world: no diff.",
    ),
  ],
  returns: rpc_payroll_holidays_add.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("adds a holiday", W_HR),
    invalid("Neither a day nor `--weekly` is given, or both are, or a day comes with no `--description`: the refusal names the flag, and nothing is written.", W_HR),
    wrong("Founders' Day is already a holiday of this year's list: the refusal names it, and nothing is written.", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_org_hr_holiday_remove = defineOperation({
  id: "org.hr.holiday.remove",
  title: "Remove a holiday",
  about: "Removes one day from its year's Holiday List, so it is a working day from then on. Leave already decided keeps the days it counted.",
  area: AREA,
  command: "org hr holiday remove",
  priority: "normal",
  implementedBy: rpc_payroll_holidays_remove,
  who: WHO_HR,
  changes: "The year's Holiday List, less the day, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A holiday is removed, and leave over it then counts the day.",
      "cli: from org-with-leave, Pat's `org hr holiday remove <Founders' Day> --org acme --json` prints the list without it and " +
        "`totalHolidays` one fewer; Sam's `hr leave apply --type \"Annual Leave\" --start <Founders' Day> --end <Founders' Day> " +
        "--json` then prints `days: 1`.",
    ),
    claim(
      "The day leaves its year's list, and removing it again is refused and changes nothing.",
      "cli: from org-with-leave, after Pat's `org hr holiday remove <Founders' Day> --org acme`, Sam's `org hr " +
        "holiday list --org acme` no longer lists it; the same remove again exits INVALID_INPUT naming the day; world: " +
        "that refusal's diff is empty.",
    ),
    claim(
      "A weekly off removed is a working day from then on.",
      "cli: from org-with-leave, after Pat's `org hr holiday remove <next week's Saturday> --org acme`, Sam's `hr " +
        "leave apply --type \"Annual Leave\" --start <that Saturday> --end <that Saturday> --json` prints `days: 1`.",
    ),
  ],
  returns: rpc_payroll_holidays_remove.output,
  errors: CLI,
  refusals: [...peopleOnly("removes a holiday", W_LEAVE), invalid("The day is no holiday of its year's list: the refusal names the day, and nothing is written.", W_LEAVE)],
  budget: budget("write"),
});

export const operation_org_hr_holiday_list = defineOperation({
  id: "org.hr.holiday.list",
  title: "List the Organization's holidays",
  about: "Lists one year's holidays (this year's unless `--year` names another), weekly offs marked, for any member.",
  area: AREA,
  command: "org hr holiday list",
  priority: "normal",
  implementedBy: rpc_payroll_holidays_list,
  who: WHO_MEMBER,
  changes: NOTHING,
  acceptance: [
    claim(
      "Any member reads the year's holidays, weekly offs marked.",
      "cli: from org-with-leave, Sam's `org hr holiday list --org acme --json` prints this year's list: every Saturday and " +
        "Sunday `weeklyOff: true` and Founders' Day `weeklyOff: false`; `--year <next year>` prints no holidays and " +
        "`holidayListId: null`.",
    ),
    claim(
      "A holiday added shows in its year's list at once, in date order; reading writes nothing.",
      "cli: from org-with-leave, after Pat's `org hr holiday add <a weekday next month other than Founders' Day> " +
        "--description Retreat --org acme`, Sam's `org hr holiday list --org acme --json` lists Retreat between the " +
        "days before and after it; world: the list's diff is empty.",
    ),
  ],
  returns: rpc_payroll_holidays_list.output,
  errors: CLI,
  refusals: memberOnly(W_LEAVE),
  budget: budget("read"),
});

// ── leave types ─────────────────────────────────────────────────────────────────────────────

export const operation_org_hr_leave_type_add = defineOperation({
  id: "org.hr.leave-type.add",
  title: "Add a leave type",
  about:
    "Adds a kind of leave with its rules, as Frappe's Leave Type: the most days one allocation gives, how long after " +
    "joining it may be taken, the longest stretch, whether unused days carry forward and how many, whether it is " +
    "unpaid or partly paid (its days then dock pay), whether holidays inside it count, and whether it may go below " +
    "zero. Earned, compensatory, optional and encashable leave stay on a connected head.",
  area: AREA,
  command: "org hr leave-type add",
  priority: "critical",
  implementedBy: rpc_payroll_leave_types_add,
  who: WHO_HR,
  changes: "One Leave Type, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A leave type is added with the rules given, every other off.",
      "cli: from org-with-employees, Pat's `org hr leave-type add \"Annual Leave\" --max-days 25 --carry-forward --max-carry 5 " +
        "--org acme --json` prints an `lvt_` type with `maxDays: 25`, `carryForward: true`, `maxCarry: 5`, `withoutPay: " +
        "false`, `includeHolidays: false` and `allowNegative: false`.",
    ),
    claim(
      "An unpaid type is never also partly paid or carried forward.",
      "cli: from org-with-employees, Pat's `org hr leave-type add Unpaid --without-pay --carry-forward --org acme` exits " +
        "INVALID_INPUT naming `--carry-forward`; world: no diff.",
    ),
  ],
  returns: rpc_payroll_leave_types_add.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("adds a leave type", W_HR),
    invalid("`--partly-paid 1.5`, `--max-days 0`, or an unpaid type that is also partly paid or carried forward: the refusal names the flag, and nothing is written.", W_HR),
    wrong("Acme already has a leave type named Annual Leave: the refusal names it, and nothing is written.", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_org_hr_leave_type_change = defineOperation({
  id: "org.hr.leave-type.change",
  title: "Change a leave type's rules",
  about:
    "Changes a leave type's rules and keeps the rest; `--clear` empties a limit or turns a flag off. Applications " +
    "already decided keep their days, and a type with approved leave is never turned paid or unpaid.",
  area: AREA,
  command: "org hr leave-type change",
  priority: "normal",
  implementedBy: rpc_payroll_leave_types_change,
  who: WHO_HR,
  changes: "The type's rules given, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A change sets the rules given and keeps the rest.",
      "cli: from org-with-leave, Pat's `org hr leave-type change \"Annual Leave\" --max-days 30 --org acme --json` prints " +
        "`maxDays: 30` with `carryForward: true` and `maxCarry: 5` as before.",
    ),
    claim(
      "A type with approved leave is not turned paid.",
      "cli: from org-with-leave, Pat's `org hr leave-type change \"Unpaid Leave\" --clear without-pay --org acme` exits " +
        "WRONG_STATE naming Sam's approved unpaid day; world: no diff.",
    ),
  ],
  returns: rpc_payroll_leave_types_change.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("changes Annual Leave", W_LEAVE),
    invalid("The type is none of Acme's (`Holiday Leave`), or nothing is given to change: nothing is written.", W_LEAVE),
    wrong("Unpaid Leave has approved leave (Sam's unpaid day), so it cannot be turned paid: the refusal names it, and nothing is written.", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_org_hr_leave_type_list = defineOperation({
  id: "org.hr.leave-type.list",
  title: "List the Organization's leave types",
  about: "Lists the leave types and their rules, for any member.",
  area: AREA,
  command: "org hr leave-type list",
  priority: "normal",
  implementedBy: rpc_payroll_leave_types_list,
  who: WHO_MEMBER,
  changes: NOTHING,
  acceptance: [
    claim(
      "Any member reads the leave types and their rules.",
      "cli: from org-with-leave, Sam's `org hr leave-type list --org acme --json` lists Annual Leave (25 days, carried up to " +
        "5), Sick Leave (10 days) and Unpaid Leave (`withoutPay: true`), with `nextCursor: null`.",
    ),
    claim(
      "A page holds at most `--limit` types, by name; reading writes nothing.",
      "cli: from org-with-leave, Sam's `org hr leave-type list --limit 1 --org acme --json` lists Annual Leave and a " +
        "`nextCursor`; `--after <it>` lists Sick Leave and Unpaid Leave with `nextCursor: null`; world: the diff is " +
        "empty.",
    ),
  ],
  returns: rpc_payroll_leave_types_list.output,
  errors: CLI,
  refusals: [...memberOnly(W_LEAVE), invalid("`--after` is a cursor this list did not give: nothing is listed.", W_LEAVE)],
  budget: budget("read"),
});

// ── allocations and balances ────────────────────────────────────────────────────────────────

export const operation_org_hr_leave_allocate = defineOperation({
  id: "org.hr.leave.allocate",
  title: "Allocate leave to an Employee for a period",
  about:
    "Gives an Employee days of a paid leave type for a period, as Frappe's Leave Allocation; with `--carry-forward`, " +
    "the days left of their previous allocation of a carry-forward type come too, up to its maximum. Two allocations of " +
    "one type never overlap, and unpaid leave needs none.",
  area: AREA,
  command: "org hr leave allocate",
  priority: "critical",
  implementedBy: rpc_payroll_leave_allocate,
  who: WHO_HR,
  changes: "One Leave Allocation, and its line in payroll's change log.",
  acceptance: [
    claim(
      "Days of a leave type are allocated for a period, and show in the balance.",
      "cli: from org-with-leave, Pat's `org hr leave allocate <Noor> --type \"Sick Leave\" --days 10 --start <this year's " +
        "first day> --end <its last day> --org acme --json` prints an `lal_` allocation with `totalDays: 10`; read: `org " +
        "hr leave balance <Noor>` then shows Sick Leave with 10 left; trace: one leave_allocation_transitioned to submitted.",
    ),
    claim(
      "Unused days are carried forward, up to the type's maximum.",
      "cli: from org-with-leave, Pat's `org hr leave allocate <Sam> --type \"Annual Leave\" --days 20 --start <next year's " +
        "first day> --end <its last day> --carry-forward --org acme --json` prints `carriedDays: 5` and `totalDays: 25`.",
    ),
    claim(
      "Two allocations of one type never overlap.",
      "cli: from org-with-leave, Pat's `org hr leave allocate <Sam> --type \"Annual Leave\" --days 5 --start <today> --end " +
        "<today> --org acme` exits WRONG_STATE naming his allocation for this year; world: no diff.",
    ),
  ],
  returns: rpc_payroll_leave_allocate.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("allocates Annual Leave to Noor", W_LEAVE),
    invalid(
      "The type is Unpaid Leave, which needs no allocation, or 11 days of Sick Leave (most 10), or the end is before the " +
        "start, or the Employee or type is none of Acme's: the refusal names the field, and nothing is written.",
      W_LEAVE,
    ),
    wrong("Sam already has Annual Leave for this year, or Leo has left: the refusal names the allocation or the status, and nothing is written.", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_org_hr_leave_unallocate = defineOperation({
  id: "org.hr.leave.unallocate",
  title: "Cancel a leave allocation",
  about: "Cancels a mistaken allocation, while no approved leave draws on it: approved days never lose the allocation behind them (stricter than Frappe, which refuses only lowering it below the leave taken).",
  area: AREA,
  command: "org hr leave unallocate",
  priority: "normal",
  implementedBy: rpc_payroll_leave_unallocate,
  who: WHO_HR,
  changes: "The allocation, cancelled, and its line in payroll's change log.",
  acceptance: [
    claim(
      "An allocation no approved leave draws on is cancelled, and leaves the balance.",
      "cli: from org-with-leave, Pat's `org hr leave unallocate <Noor's Annual Leave allocation> --org acme --json` prints " +
        "`status: cancelled`; read: `org hr leave balance <Noor>` no longer lists Annual Leave.",
    ),
    claim(
      "An allocation approved leave draws on stays.",
      "cli: from org-with-leave, after Lead's `org hr leave approve <Sam's open leave>`, Pat's `org hr leave unallocate <Sam's " +
        "Annual Leave allocation> --org acme` exits WRONG_STATE naming that application; world: no diff after the approval.",
    ),
  ],
  returns: rpc_payroll_leave_unallocate.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("cancels Noor's allocation", W_LEAVE),
    unknownId("leave allocations", "lal_", W_LEAVE),
    wrong("The allocation is already cancelled, or approved leave draws on it: the refusal names the status or the application, and nothing is written.", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_org_hr_leave_balance = defineOperation({
  id: "org.hr.leave.balance",
  title: "Read an Employee's leave balances",
  about: "Reads an Employee's balance of each leave type on a day (today unless `--on`): what was allocated, taken and asked for, and what is left.",
  area: AREA,
  command: "org hr leave balance",
  priority: "normal",
  implementedBy: rpc_payroll_leave_balance,
  who: WHO_HR,
  changes: NOTHING,
  acceptance: [
    claim(
      "Each type's balance reads as allocated less taken, with open applications pending.",
      "cli: from org-with-leave, Pat's `org hr leave balance <Sam> --org acme --json` prints Annual Leave allocated 20, " +
        "taken 0, pending 2, balance 20; Sick Leave 10, 0, 0, 10; and Unpaid Leave taken 1 with `withoutPay: true`.",
    ),
    claim(
      "An approved application moves its days from pending to taken.",
      "cli: from org-with-leave, after Lead's `org hr leave approve <Sam's open leave>`, Pat's `org hr leave balance " +
        "<Sam> --org acme --json` prints Annual Leave allocated 20, taken 2, pending 0, balance 18.",
    ),
    claim(
      "`--on` reads another day: with no allocation covering it, only the unpaid types show; reading writes nothing.",
      "cli: from org-with-leave, Pat's `org hr leave balance <Sam> --on <a day next year> --org acme --json` lists " +
        "Unpaid Leave alone; world: the diff is empty.",
    ),
  ],
  returns: rpc_payroll_leave_balance.output,
  errors: CLI,
  refusals: [...peopleOnly("reads Sam's balances", W_LEAVE), unknownId("Employees", "emp_", W_LEAVE)],
  budget: budget("read"),
});

// ── the Employee's leave ────────────────────────────────────────────────────────────────────

export const operation_hr_leave_apply = defineOperation({
  id: "hr.leave.apply",
  title: "Apply for leave",
  about:
    "Applies for leave of a type for a range of days, or half a day, with the employer `--employer` names (the only " +
    "one, when there is one). Holidays inside it are not counted unless the type counts them. A paid type needs an " +
    "allocation whose balance covers it; an unpaid type needs none, and its days dock pay once approved. The " +
    "Employee's department's hat, or the People hat, decides it. An Employee needs no Seat in the Organization.",
  area: AREA,
  command: "hr leave apply",
  priority: "critical",
  implementedBy: rpc_payroll_leave_apply,
  who: WHO_SELF_HR,
  changes: "One open Leave Application, and its line in payroll's change log.",
  acceptance: [
    claim(
      "An Employee applies for leave, its days counted without the weekly offs inside it.",
      "cli: from org-with-leave, Sam's `hr leave apply --type \"Annual Leave\" --start <the Friday three weeks from now> --end <the Monday after> " +
        "--reason Wedding --json` prints an `lap_` application, `employer: acme`, `status: open`, `days: 2` and " +
        "`balanceAfter: 16`; trace: one leave_application_transitioned to open.",
    ),
    claim(
      "Paid leave beyond the balance is refused; unpaid leave is not.",
      "cli: from org-with-leave, Sam's `hr leave apply --type \"Sick Leave\" --start <the second Monday of next month> --end " +
        "<the Friday two weeks later>` (15 working days of this year, after Founders' Day and his open leave, no holiday " +
        "among them) exits INVALID_INPUT naming his balance of 10; the same days of Unpaid Leave print `status: open`, " +
        "`days: 15`.",
    ),
    claim(
      "Leave never overlaps the Employee's other open or approved leave.",
      "cli: from org-with-leave, Sam's `hr leave apply --type \"Sick Leave\" --start <next Monday> --end <next Monday>` exits " +
        "WRONG_STATE naming his open Annual Leave; world: no diff.",
    ),
  ],
  returns: rpc_payroll_leave_apply.output,
  errors: CLI,
  refusals: [
    ...selfOnly(W_LEAVE, ", or the type, the range or the balance is refused, naming the field"),
    wrong("Sam's open Annual Leave already covers next Monday: the refusal names it, and nothing is written.", W_LEAVE),
    suspended("applies for leave", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_hr_leave_list = defineOperation({
  id: "hr.leave.list",
  title: "List your own leave applications",
  about: "Lists your leave applications, from every employer unless `--employer` keeps one, newest first, each with its employer, type, days, status, who decided it, and the balance after it.",
  area: AREA,
  command: "hr leave list",
  priority: "normal",
  implementedBy: rpc_payroll_leave_mine,
  who: WHO_SELF_HR,
  changes: NOTHING,
  acceptance: [
    claim(
      "An Employee lists their own applications from every employer, `--status` and `--employer` filtering.",
      "cli: from org-with-leave, Sam's `hr leave list --json` lists his open Annual Leave and his approved Unpaid Leave with " +
        "`decidedBy: lead@acme.test`, each `employer: acme`, and not Lead's; `--status open` lists the first alone, and " +
        "`--employer acme` keeps both, as a filter.",
    ),
    claim(
      "A decided application stays listed, with who decided it.",
      "cli: from org-with-leave, after Lead's `org hr leave reject <Sam's open leave> --reason \"Release week\"`, Sam's " +
        "`hr leave list --status rejected --json` lists it with `decidedBy: lead@acme.test`.",
    ),
    claim(
      "A page holds at most `--limit` applications; reading writes nothing.",
      "cli: from org-with-leave, Sam's `hr leave list --limit 1 --json` lists one application and a `nextCursor`, and " +
        "`--after <it>` the other with `nextCursor: null`; world: the diff is empty.",
    ),
  ],
  returns: rpc_payroll_leave_mine.output,
  errors: CLI,
  refusals: selfOnly(W_LEAVE, ", or `--after` is a cursor this list did not give"),
  budget: budget("read"),
});

export const operation_hr_leave_cancel = defineOperation({
  id: "hr.leave.cancel",
  title: "Cancel your own leave",
  about:
    "Cancels your open or approved leave application. An approved leave's marked days are unmarked again and its days " +
    "return to the balance. Unpaid leave a submitted payslip already counted is not cancelled: that pay is fixed.",
  area: AREA,
  command: "hr leave cancel",
  priority: "normal",
  implementedBy: rpc_payroll_leave_cancel,
  who: WHO_SELF_HR,
  changes: "The application, cancelled; an approved one's attendance marks cancelled; its lines in payroll's change log.",
  acceptance: [
    claim(
      "An Employee cancels their own open leave, and its days are back in the balance.",
      "cli: from org-with-leave, Sam's `hr leave cancel <Sam's open leave> --json` prints `status: cancelled`; read: `hr leave balance` shows Annual Leave pending 0.",
    ),
    claim(
      "Cancelling approved leave unmarks its days, but never under a submitted payslip.",
      "cli: from org-with-leave, Sam's `hr leave cancel <Sam's unpaid day> --json` prints `status: cancelled` and `hr attendance " +
        "list` shows that day's mark cancelled; from org-with-leave again, after Pat's `org payroll run create salaries " +
        "--start <this month's first day> --end <its last day>` and `org payroll run submit <it>`, it exits WRONG_STATE naming Sam's slip.",
    ),
  ],
  returns: rpc_payroll_leave_cancel.output,
  errors: CLI,
  refusals: [
    ...selfOnly(W_LEAVE, ", or Sam names Lead's application, which is not his"),
    wrong("Sam's leave is already cancelled, or a submitted payslip counts his unpaid day: the refusal names the status or the slip, and nothing is written.", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_hr_leave_balance = defineOperation({
  id: "hr.leave.balance",
  title: "Read your own leave balances",
  about: "Reads your balance of each leave type with an employer on a day (today unless `--on`): allocated, taken, pending and left.",
  area: AREA,
  command: "hr leave balance",
  priority: "normal",
  implementedBy: rpc_payroll_leave_my_balance,
  who: WHO_SELF_HR,
  changes: NOTHING,
  acceptance: [
    claim(
      "An Employee reads their own balances with no hat, as the People hat reads them.",
      "cli: from org-with-leave, Sam's `hr leave balance --employer acme --json` prints Annual Leave 20 left with 2 pending, " +
        "Sick Leave 10 left and Unpaid Leave taken 1, as Pat's `org hr leave balance <Sam>` does.",
    ),
    claim(
      "With one employer `--employer` may be left out, and an approval shows in the balance at once.",
      "cli: from org-with-leave, Sam's `hr leave balance --json` prints the same as with `--employer acme`; after " +
        "Lead's `org hr leave approve <Sam's open leave>`, it prints Annual Leave taken 2, pending 0, balance 18.",
    ),
    claim(
      "`--on` a day no allocation covers shows only the unpaid types; reading writes nothing.",
      "cli: from org-with-leave, Sam's `hr leave balance --on <a day next year> --json` lists Unpaid Leave alone; " +
        "world: the diff is empty.",
    ),
  ],
  returns: rpc_payroll_leave_my_balance.output,
  errors: CLI,
  refusals: selfOnly(W_LEAVE),
  budget: budget("read"),
});

// ── deciding leave ──────────────────────────────────────────────────────────────────────────

const notApprover = (what: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given: W_LEAVE,
  when:
    `Plat, whose Safe wears \`platform\`'s office hat and not \`salaries\`' or one above it nor the People hat, ${what}; ` +
    "or Lead decides his own application: self-approval is refused, and nothing is written.",
});

export const operation_org_hr_leave_approve = defineOperation({
  id: "org.hr.leave.approve",
  title: "Approve a leave application",
  about:
    "Approves an open leave application, its checks run again on what stands now, and marks each of its leave days in " +
    "attendance, so an unpaid type's days dock the payslip that covers them. Whoever wears the Employee's department's " +
    "hat or one above it, or the People hat, approves; nobody approves their own.",
  area: AREA,
  command: "org hr leave approve",
  priority: "critical",
  implementedBy: rpc_payroll_leave_approve,
  who: WHO_LEAVE_APPROVER,
  changes: "The application, approved; one attendance mark per leave day; their lines in payroll's change log.",
  acceptance: [
    claim(
      "The department's hat approves a leave, and each of its days is marked on leave.",
      "cli: from org-with-leave, Lead's `org hr leave approve <Sam's open leave> --org acme --json` prints `status: approved`, " +
        "`decidedBy: lead@acme.test` and `balanceAfter: 18`; read: Pat's `org hr attendance list --employee <Sam> --start <next " +
        "Monday> --end <next Tuesday>` lists two `on_leave` days of Annual Leave, source `leave`; trace: one " +
        "leave_application_transitioned open → approved and two attendance_transitioned to submitted.",
    ),
    claim(
      "The People hat approves too; nobody approves their own leave, and another department's hat does not.",
      "cli: from org-with-leave, Lead's `org hr leave approve <Lead's leave>` and Plat's `org hr leave approve <Sam's open " +
        "leave>` each exit ROLE_PERMISSION_DENIED, and Pat's `org hr leave approve <Lead's leave> --json` prints `status: approved`.",
    ),
  ],
  returns: rpc_payroll_leave_approve.output,
  errors: CLI,
  refusals: [
    signedOut,
    outsider(W_LEAVE),
    notApprover("approves Sam's open leave"),
    unknownId("leave applications", "lap_", W_LEAVE),
    wrong("Sam's unpaid day is already approved: the refusal names `approved`, and nothing is written.", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_org_hr_leave_reject = defineOperation({
  id: "org.hr.leave.reject",
  title: "Reject a leave application",
  about: "Rejects an open leave application, with a reason if given; nothing is taken from the balance and no day is marked. The same hats as approving decide.",
  area: AREA,
  command: "org hr leave reject",
  priority: "normal",
  implementedBy: rpc_payroll_leave_reject,
  who: WHO_LEAVE_APPROVER,
  changes: "The application, rejected, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A rejected application takes nothing and marks nothing.",
      "cli: from org-with-leave, Lead's `org hr leave reject <Sam's open leave> --reason \"Release week\" --org acme --json` " +
        "prints `status: rejected` with the reason; read: Sam's `hr leave balance` shows Annual Leave pending 0 and balance 20, " +
        "and `hr attendance list` no mark next week.",
    ),
    claim(
      "The People hat rejects too, and the rejection is recorded once.",
      "cli: from org-with-leave, Pat's `org hr leave reject <Lead's leave> --reason \"Cover needed\" --org acme --json` " +
        "prints `status: rejected` with Pat as `decidedBy`; trace: one leave_application_transitioned open → rejected.",
    ),
    claim(
      "Rejecting a decided application again is refused and changes nothing.",
      "cli: from org-with-leave, after Lead's `org hr leave reject <Sam's open leave>`, the same command again exits " +
        "WRONG_STATE naming `rejected`; world: that refusal's diff is empty.",
    ),
  ],
  returns: rpc_payroll_leave_reject.output,
  errors: CLI,
  refusals: [
    signedOut,
    outsider(W_LEAVE),
    notApprover("rejects Sam's open leave"),
    unknownId("leave applications", "lap_", W_LEAVE),
    wrong("Sam's unpaid day is already approved: the refusal names `approved`, and nothing is written.", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_org_hr_leave_list = defineOperation({
  id: "org.hr.leave.list",
  title: "List the Organization's leave applications",
  about:
    "Lists leave applications, newest first: every Employee's for the People hat, a department's and those below it " +
    "for its hat. `--status`, `--employee`, `--department` and a day range filter.",
  area: AREA,
  command: "org hr leave list",
  priority: "normal",
  implementedBy: rpc_payroll_leave_list,
  who: WHO_LEAVE_READER,
  changes: NOTHING,
  acceptance: [
    claim(
      "Each hat lists its department's applications, the wearer's own among them, as the People hat does.",
      "cli: from org-with-leave, Lead's `org hr leave list --status open --org acme --json` lists Sam's open leave and Lead's " +
        "own, as Pat's does; Plat's lists none, `platform` employing nobody.",
    ),
    claim(
      "A member with neither hat lists nothing.",
      "cli: from org-with-leave, Sam's `org hr leave list --org acme` exits ROLE_PERMISSION_DENIED; world: no diff.",
    ),
  ],
  returns: rpc_payroll_leave_list.output,
  errors: CLI,
  refusals: [
    signedOut,
    outsider(W_LEAVE),
    { error: error_ROLE_PERMISSION_DENIED, given: W_LEAVE, when: "Sam, a member wearing neither the People hat nor any department's, lists leave: nothing is read." },
    invalid("`--department` names none of Acme's budgets, or `--after` is a cursor this list did not give: nothing is listed.", W_LEAVE),
  ],
  budget: budget("read"),
});

// ── shifts ──────────────────────────────────────────────────────────────────────────────────

export const operation_org_hr_shift_type_add = defineOperation({
  id: "org.hr.shift-type.add",
  title: "Add a shift type",
  about:
    "Adds working hours attendance is marked by, as Frappe's Shift Type: its start and end, and with " +
    "`--auto-attendance` the hours below which a day is a half day or absent and the minutes of grace before an entry " +
    "is late or an exit early. Different hours later are a new type.",
  area: AREA,
  command: "org hr shift-type add",
  priority: "normal",
  implementedBy: rpc_payroll_shift_types_add,
  who: WHO_HR,
  changes: "One Shift Type, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A shift type is added with its hours and thresholds.",
      "cli: from org-with-leave, Pat's `org hr shift-type add Day --start 09:00 --end 17:00 --auto-attendance --half-day-below " +
        "6 --absent-below 4 --late-grace 15 --org acme --json` prints an `sht_` type with those values and `assigned: []`.",
    ),
    claim(
      "Hours that do not make a shift are refused.",
      "cli: from org-with-leave, Pat's `org hr shift-type add Night --start 22:00 --end 06:00` and `org hr shift-type add Odd " +
        "--start 09:00 --end 17:00 --auto-attendance --half-day-below 3 --absent-below 4` each exit INVALID_INPUT naming the flag; world: no diff.",
    ),
  ],
  returns: rpc_payroll_shift_types_add.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("adds a shift type", W_LEAVE),
    invalid("The end is not after the start, or the absent threshold is above the half-day one: the refusal names the flag, and nothing is written.", W_LEAVE),
    wrong("Acme already has a shift type named Day: the refusal names it, and nothing is written.", W_ATTEND),
  ],
  budget: budget("write"),
});

export const operation_org_hr_shift_type_list = defineOperation({
  id: "org.hr.shift-type.list",
  title: "List the Organization's shift types",
  about: "Lists the shift types with their hours and thresholds, and who works each now, for any member.",
  area: AREA,
  command: "org hr shift-type list",
  priority: "normal",
  implementedBy: rpc_payroll_shift_types_list,
  who: WHO_MEMBER,
  changes: NOTHING,
  acceptance: [
    claim(
      "Any member reads the shift types and who works them.",
      "cli: from org-with-attendance, Sam's `org hr shift-type list --org acme --json` lists Day, 09:00 to 17:00, auto " +
        "attendance on, with Sam's active assignment.",
    ),
    claim(
      "An ended assignment is no longer shown; reading writes nothing.",
      "cli: from org-with-attendance, after Pat's `org hr shift-type unassign <Sam's assignment>`, Sam's `org hr " +
        "shift-type list --org acme --json` lists Day with no active assignment and `nextCursor: null`; world: the " +
        "list's diff is empty.",
    ),
  ],
  returns: rpc_payroll_shift_types_list.output,
  errors: CLI,
  refusals: memberOnly(W_ATTEND),
  budget: budget("read"),
});

export const operation_org_hr_shift_type_assign = defineOperation({
  id: "org.hr.shift-type.assign",
  title: "Assign a shift type to an Employee",
  about:
    "Assigns a shift type to an Employee from a day, until an end day if given, as Frappe's Shift Assignment. From " +
    "then on, each day the shift ends, Capxul marks their attendance from their check-ins. One shift a day.",
  area: AREA,
  command: "org hr shift-type assign",
  priority: "normal",
  implementedBy: rpc_payroll_shift_types_assign,
  who: WHO_HR,
  changes: "One active Shift Assignment, which starts its marking process, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A shift is assigned from a day, and its days are marked from check-ins.",
      "cli: from org-with-leave, after Pat adds Day as above, `org hr shift-type assign Day <Noor> --start <the next working " +
        "day> --org acme --json` prints an active `sha_` assignment; trace: one shift_assignment_transitioned to active; " +
        "read: after the clock passes that day's 18:00 with no check-in of Noor's, `org hr attendance list --employee <Noor>` " +
        "lists that day absent, source `checkins`.",
    ),
    claim(
      "An Employee works one shift a day.",
      "cli: from org-with-attendance, Pat's `org hr shift-type assign Day <Sam> --start <tomorrow>` exits WRONG_STATE naming his active assignment; world: no diff.",
    ),
  ],
  returns: rpc_payroll_shift_types_assign.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("assigns Day to Sam", W_ATTEND),
    invalid("The shift type or Employee is none of Acme's, or the end is before the start: nothing is written.", W_ATTEND),
    wrong("Sam already works Day on those days, or Leo has left: the refusal names the assignment or the status, and nothing is written.", W_ATTEND),
  ],
  budget: budget("write"),
});

export const operation_org_hr_shift_type_unassign = defineOperation({
  id: "org.hr.shift-type.unassign",
  title: "End a shift assignment",
  about: "Ends an active shift assignment: no later day is marked by it, and days already marked keep their attendance.",
  area: AREA,
  command: "org hr shift-type unassign",
  priority: "normal",
  implementedBy: rpc_payroll_shift_types_unassign,
  who: WHO_HR,
  changes: "The assignment, inactive, which ends its process, and its line in payroll's change log.",
  acceptance: [
    claim(
      "An unassigned shift marks no later day.",
      "cli: from org-with-attendance, Pat's `org hr shift-type unassign <Sam's assignment> --org acme --json` prints `status: " +
        "inactive`; read: after the clock passes the next working day's 18:00, `org hr attendance list --employee <Sam>` lists no mark for that day.",
    ),
    claim(
      "Days already marked keep their attendance, and ending it again is refused.",
      "cli: from org-with-attendance, after Pat's `org hr shift-type unassign <Sam's assignment>`, `org hr attendance " +
        "list --employee <Sam> --start <the first shift day> --end <the second> --org acme` still lists both days his " +
        "check-ins marked; the same unassign again exits WRONG_STATE naming `inactive`; trace: one " +
        "shift_assignment_transitioned active → inactive.",
    ),
    claim(
      "Once it ends, the Employee can be given a shift again.",
      "cli: from org-with-attendance, after that unassign, Pat's `org hr shift-type assign Day <Sam> --start " +
        "<tomorrow> --org acme --json` prints an active assignment.",
    ),
  ],
  returns: rpc_payroll_shift_types_unassign.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("ends Sam's assignment", W_ATTEND),
    unknownId("shift assignments", "sha_", W_ATTEND),
    wrong("The assignment is already inactive: the refusal names its status, and nothing is written.", W_ATTEND),
  ],
  budget: budget("write"),
});

// ── check-ins and attendance ────────────────────────────────────────────────────────────────

export const operation_hr_attendance_checkin = defineOperation({
  id: "hr.attendance.checkin",
  title: "Check in or out",
  about:
    "Checks you in or out with your employer at the world's clock, never a time you give or your device's: a devnet's " +
    "or a shared world's own clock where it runs. When your shift for the day ends, Capxul marks the day from your " +
    "check-ins: present, half day or absent by the hours worked between your first check-in and last check-out.",
  area: AREA,
  command: "hr attendance checkin",
  priority: "normal",
  implementedBy: rpc_payroll_attendance_checkin,
  who: WHO_SELF_HR,
  changes: "One Employee Checkin, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A check-in is stamped with the world's clock.",
      "cli: from org-with-attendance, Sam's `hr attendance checkin --log in --json` prints a `chk_` check-in whose `time` is " +
        "`dev time`'s now and `shiftType: Day`; after `capxul dev time warp 1h`, `hr attendance checkin --log out` prints a time an hour later.",
    ),
    claim(
      "When the shift is over, the day is marked by the hours between the first check-in and the last check-out.",
      "cli: from org-with-attendance, Sam checks in at 09:05 and out at 13:30 (`dev time warp` between); read: after the " +
        "clock passes 18:00, Sam's `hr attendance list --json` lists the day `half_day` with `workingHours: 4.42`, source " +
        "`checkins`, and both check-ins naming its attendance; trace: one attendance_transitioned to submitted.",
    ),
  ],
  returns: rpc_payroll_attendance_checkin.output,
  errors: CLI,
  refusals: [...selfOnly(W_ATTEND), suspended("checks in", W_ATTEND)],
  budget: budget("write"),
});

export const operation_hr_attendance_list = defineOperation({
  id: "hr.attendance.list",
  title: "List your own attendance and check-ins",
  about: "Lists your attendance in a day range (this month unless given), from every employer unless `--employer` keeps one, newest first, and your check-ins on those days.",
  area: AREA,
  command: "hr attendance list",
  priority: "normal",
  implementedBy: rpc_payroll_attendance_mine,
  who: WHO_SELF_HR,
  changes: NOTHING,
  acceptance: [
    claim(
      "An Employee reads their own days as marked, and the check-ins that marked them.",
      "cli: from org-with-attendance, Sam's `hr attendance list --start <his unpaid day> --end <today> --json` (the range " +
        "named, as the shift days may fall in the next month) lists exactly three marks: <the second shift day> `absent` " +
        "with late entry and 2.33 working hours, <the first shift day> `present` with 8.08, and his unpaid day `on_leave` " +
        "of Unpaid Leave; and his four check-ins, each naming the attendance it marked.",
    ),
    claim(
      "`--employer` keeps one employer's days, and a page holds at most `--limit` days; reading writes nothing.",
      "cli: from org-with-attendance, Sam's `hr attendance list --start <his unpaid day> --end <today> --employer " +
        "acme --limit 2 --json` lists the two shift days and a `nextCursor`, and `--after <it>` his unpaid day with " +
        "`nextCursor: null`; world: the diff is empty.",
    ),
  ],
  returns: rpc_payroll_attendance_mine.output,
  errors: CLI,
  refusals: selfOnly(W_ATTEND, ", or `--after` is a cursor this list did not give"),
  budget: budget("read"),
});

export const operation_org_hr_attendance_mark = defineOperation({
  id: "org.hr.attendance.mark",
  title: "Mark an Employee's attendance for a day",
  about:
    "Marks an Employee present, absent, on leave of a type, half day or working from home on a day, as Frappe's " +
    "Attendance. Payroll is based on attendance with unmarked days counted present, so an absent day, or an unpaid " +
    "leave's, docks the payslip that covers it. A day is marked once: cancel a mark to mark it again.",
  area: AREA,
  command: "org hr attendance mark",
  priority: "normal",
  implementedBy: rpc_payroll_attendance_mark,
  who: WHO_HR,
  changes: "One Attendance, and its line in payroll's change log.",
  acceptance: [
    claim(
      "An absent day marked docks the payslip that covers it.",
      "cli: from org-with-leave, Pat's `org hr attendance mark <Sam> --on <a working day this month, not his unpaid day> --status absent --org " +
        "acme --json` prints a submitted `att_` attendance, `absent`, source `mark`; Pat's `org payroll run create salaries " +
        "--start <this month's first day> --end <its last day> --json` then gives Sam's slip two fewer payment days than " +
        "the month (`leaveWithoutPay: 1`, `absentDays: 1`).",
    ),
    claim(
      "A day is marked once.",
      "cli: from org-with-leave, Pat's `org hr attendance mark <Noor> --on <Noor's absent day> --status present` exits WRONG_STATE naming her absence; world: no diff.",
    ),
  ],
  returns: rpc_payroll_attendance_mark.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("marks Sam absent", W_LEAVE),
    invalid("`--status on_leave` with no `--leave-type`, a day before the Employee joined, or an Employee none of Acme's: the refusal names the field, and nothing is written.", W_LEAVE),
    wrong("Noor's absent day is already marked: the refusal names its attendance, and nothing is written.", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_org_hr_attendance_cancel = defineOperation({
  id: "org.hr.attendance.cancel",
  title: "Cancel a day's attendance",
  about: "Cancels a wrong mark, so the day is unmarked (counted present) and may be marked again. A day an approved leave marked is unmarked by cancelling that leave.",
  area: AREA,
  command: "org hr attendance cancel",
  priority: "normal",
  implementedBy: rpc_payroll_attendance_cancel,
  who: WHO_HR,
  changes: "The attendance, cancelled, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A cancelled mark no longer docks pay.",
      "cli: from org-with-leave, Pat's `org hr attendance cancel <Noor's absence> --org acme --json` prints `docstatus: " +
        "cancelled`; this month's `org payroll run create salaries` then pays Noor every day of the month.",
    ),
    claim(
      "A leave's mark is cancelled only with its leave.",
      "cli: from org-with-leave, Pat's `org hr attendance cancel <Sam's unpaid day's mark>` exits WRONG_STATE naming his leave; world: no diff.",
    ),
  ],
  returns: rpc_payroll_attendance_cancel.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("cancels Noor's absence", W_LEAVE),
    unknownId("attendance", "att_", W_LEAVE),
    wrong("The mark is already cancelled, or an approved leave made it: the refusal names the status or the leave, and nothing is written.", W_LEAVE),
  ],
  budget: budget("write"),
});

export const operation_org_hr_attendance_list = defineOperation({
  id: "org.hr.attendance.list",
  title: "List the Organization's attendance",
  about: "Lists the marked days, newest first; `--employee`, `--department`, `--status` and a day range filter. Unmarked days count present and are not listed.",
  area: AREA,
  command: "org hr attendance list",
  priority: "normal",
  implementedBy: rpc_payroll_attendance_list,
  who: WHO_HR,
  changes: NOTHING,
  acceptance: [
    claim(
      "The People hat lists the marked days, by whom or what each was marked.",
      "cli: from org-with-leave, Pat's `org hr attendance list --start <this month's first day> --end <today> --org acme " +
        "--json` lists Sam's unpaid day `on_leave` (source `leave`) and Noor's absent day (source `mark`); `--status absent` lists Noor's alone.",
    ),
    claim(
      "A day nobody marked is not listed, though it counts present; `--employee` keeps one Employee's days.",
      "cli: from org-with-leave, Pat's `org hr attendance list --start <this month's first day> --end <today> " +
        "--status present --org acme --json` lists nothing; `--employee <Noor>` lists her absent day alone.",
    ),
    claim(
      "A cancelled mark leaves the list; reading writes nothing.",
      "cli: from org-with-leave, after Pat's `org hr attendance cancel <Noor's absence>`, the same list no longer " +
        "shows Noor's day; world: the list's diff is empty.",
    ),
  ],
  returns: rpc_payroll_attendance_list.output,
  errors: CLI,
  refusals: [...peopleOnly("lists Acme's attendance", W_LEAVE), invalid("`--employee` names none of Acme's Employees, or `--after` is a cursor this list did not give: nothing is listed.", W_LEAVE)],
  budget: budget("read"),
});

// ── expense claim types ─────────────────────────────────────────────────────────────────────

export const operation_org_hr_expense_type_add = defineOperation({
  id: "org.hr.expense-type.add",
  title: "Add an expense claim type",
  about: "Adds a kind of expense an Employee may claim, as Frappe's Expense Claim Type, with the books expense account its claims post to, or books' default.",
  area: AREA,
  command: "org hr expense-type add",
  priority: "normal",
  implementedBy: rpc_payroll_expense_types_add,
  who: WHO_HR,
  changes: "One Expense Claim Type, and its line in payroll's change log.",
  acceptance: [
    claim(
      "An expense claim type is added, with books' default account unless one is named.",
      "cli: from org-with-employees, Pat's `org hr expense-type add Travel --description \"Trains, taxis and flights\" --org " +
        "acme --json` prints an `ect_` type with `account: null`; `org hr expense-type add Hotel --account 9999` exits " +
        "INVALID_INPUT naming the account; world: one type added.",
    ),
    claim(
      "A name already used is refused, so adding the same type again changes nothing.",
      "cli: from org-with-employees, after Pat's `org hr expense-type add Travel --org acme`, the same command again " +
        "exits WRONG_STATE naming Travel; world: that refusal's diff is empty.",
    ),
  ],
  returns: rpc_payroll_expense_types_add.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("adds an expense claim type", W_HR),
    invalid("`--account` names no ledger expense account of Acme's books: the refusal names it, and nothing is written.", W_HR),
    wrong("Acme already has an expense claim type named Travel: the refusal names it, and nothing is written.", W_EXP),
  ],
  budget: budget("write"),
});

export const operation_org_hr_expense_type_list = defineOperation({
  id: "org.hr.expense-type.list",
  title: "List the Organization's expense claim types",
  about: "Lists the expense claim types and their accounts, for any member.",
  area: AREA,
  command: "org hr expense-type list",
  priority: "normal",
  implementedBy: rpc_payroll_expense_types_list,
  who: WHO_MEMBER,
  changes: NOTHING,
  acceptance: [
    claim("Any member reads the expense claim types.", "cli: from org-with-expenses, Sam's `org hr expense-type list --org acme --json` lists Meals and Travel, each `account: null`."),
    claim(
      "Types list by name, one added since among them, a page at a time; reading writes nothing.",
      "cli: from org-with-expenses, after Pat's `org hr expense-type add Hotel`, Sam's `org hr expense-type list " +
        "--org acme --json` lists Hotel, Meals and Travel in that order with `nextCursor: null`, and `--limit 1` lists " +
        "Hotel and a `nextCursor`; world: the list's diff is empty.",
    ),
  ],
  returns: rpc_payroll_expense_types_list.output,
  errors: CLI,
  refusals: memberOnly(W_EXP),
  budget: budget("read"),
});

// ── the claimant's expense claims ───────────────────────────────────────────────────────────

export const operation_hr_expense_claim_create = defineOperation({
  id: "hr.expense-claim.create",
  title: "Claim back an expense",
  about:
    "Claims back what you spent for your employer: one line by flags, or many from `--file`, each a type, an amount " +
    "in your department budget's token, a day and a description, with receipts attached and any paid advance of yours " +
    "to settle against it. It opens for whoever wears your department's hat to decide; you may cancel it until then. " +
    "An Employee needs no Seat in the Organization.",
  area: AREA,
  command: "hr expense-claim create",
  priority: "critical",
  implementedBy: rpc_payroll_expense_claims_create,
  who: WHO_SELF_HR,
  changes: "One open Expense Claim, each receipt stored as a document, and its line in payroll's change log.",
  acceptance: [
    claim(
      "An Employee claims an expense with its receipt, open for their department to decide.",
      "cli: from org-with-expenses, Sam's `hr expense-claim create --type Travel --amount 64.50 --on <yesterday> --description " +
        "\"Airport taxi\" --receipt taxi.pdf --employer acme --json` prints an `exp_` claim, `status: open`, `department: " +
        "salaries`, `grandTotal: 64.50` and one receipt; trace: one expense_claim_transitioned to open; world: one receipt document stored.",
    ),
    claim(
      "A claim settles against the claimant's paid advance, never for more than its total.",
      "cli: from org-with-expenses, Sam's `hr expense-claim create --type Travel --amount 180 --advance <A2> --json` prints " +
        "`advanced: 150.00` and `grandTotal: 30.00`; naming <A1>, which his paid claim took in full, exits INVALID_INPUT naming it.",
    ),
  ],
  returns: rpc_payroll_expense_claims_create.output,
  errors: CLI,
  refusals: [
    ...selfOnly(W_EXP, ", or a line's type (`Hotel`), amount (0) or day (tomorrow), an advance, or a receipt over 128 KB is refused, naming it"),
    suspended("claims an expense", W_EXP),
  ],
  budget: budget("write"),
});

export const operation_hr_expense_claim_list = defineOperation({
  id: "hr.expense-claim.list",
  title: "List your own expense claims",
  about: "Lists your expense claims, from every employer unless `--employer` keeps one, newest first, each with its lines, totals, status, who decided it and, once paid, its payment.",
  area: AREA,
  command: "hr expense-claim list",
  priority: "normal",
  implementedBy: rpc_payroll_expense_claims_mine,
  who: WHO_SELF_HR,
  changes: NOTHING,
  acceptance: [
    claim(
      "An Employee lists their own claims, `--status` filtering.",
      "cli: from org-with-expenses, Sam's `hr expense-claim list --json` lists <C1> open, <C2> approved and <C3> paid with a " +
        "`paymentId`, and not Lead's <C4>; `--status open` lists <C1> alone.",
    ),
    claim(
      "A page holds at most `--limit` claims, and `--employer` keeps one employer's; reading writes nothing.",
      "cli: from org-with-expenses, Sam's `hr expense-claim list --limit 2 --json` lists two of <C1>, <C2> and <C3> " +
        "and a `nextCursor`, `--after <it>` the third with `nextCursor: null`, and `--employer acme` all three; world: " +
        "the diff is empty.",
    ),
    claim(
      "A claim the department cancelled stays listed with its status.",
      "cli: from org-with-expenses, after Lead's `org hr expense-claim cancel <C2>`, Sam's `hr expense-claim list " +
        "--status cancelled --json` lists <C2>.",
    ),
  ],
  returns: rpc_payroll_expense_claims_mine.output,
  errors: CLI,
  refusals: selfOnly(W_EXP, ", or `--after` is a cursor this list did not give"),
  budget: budget("read"),
});

export const operation_hr_expense_claim_get = defineOperation({
  id: "hr.expense-claim.get",
  title: "Read one of your expense claims",
  about: "Reads one of your expense claims: its lines, receipts, the advances it settled, its totals, who decided it and, once paid, its payment.",
  area: AREA,
  command: "hr expense-claim get",
  priority: "normal",
  implementedBy: rpc_payroll_expense_claims_mine_get,
  who: WHO_SELF_HR,
  changes: NOTHING,
  acceptance: [
    claim(
      "A paid claim reads with what settled it and the payment that paid the rest.",
      "cli: from org-with-expenses, Sam's `hr expense-claim get <C3> --json` prints Travel 300.00, <A1> 200.00 advanced, " +
        "`grandTotal: 100.00`, `status: paid`, a `paymentId` and `txHash`; read: `payment get <that id>` shows it settled to Sam's Safe.",
    ),
    claim(
      "An open claim reads with its receipt and no payment; reading writes nothing.",
      "cli: from org-with-expenses, Sam's `hr expense-claim get <C1> --json` prints Travel 120.00, the receipt " +
        "taxi.pdf, `status: open` and no payment; world: the diff is empty.",
    ),
  ],
  returns: rpc_payroll_expense_claims_mine_get.output,
  errors: CLI,
  refusals: selfOnly(W_EXP, ", or Sam names Lead's claim <C4>, which is not his"),
  budget: budget("read"),
});

export const operation_hr_expense_claim_cancel = defineOperation({
  id: "hr.expense-claim.cancel",
  title: "Cancel your own open expense claim",
  about: "Cancels your expense claim while it is still open; once decided it is the department's.",
  area: AREA,
  command: "hr expense-claim cancel",
  priority: "normal",
  implementedBy: rpc_payroll_expense_claims_withdraw,
  who: WHO_SELF_HR,
  changes: "The claim, cancelled, and its line in payroll's change log.",
  acceptance: [
    claim(
      "An open claim is cancelled by its claimant; a decided one is not.",
      "cli: from org-with-expenses, Sam's `hr expense-claim cancel <C1> --json` prints `status: cancelled`; `hr expense-claim " +
        "cancel <C2>` exits WRONG_STATE naming `approved`.",
    ),
    claim(
      "A cancelled claim stays listed on both sides, and cancelling it again is refused.",
      "cli: from org-with-expenses, after Sam's `hr expense-claim cancel <C1>`, his `hr expense-claim list --status " +
        "cancelled` and Lead's `org hr expense-claim list --status cancelled --org acme` each list <C1>; the same " +
        "cancel again exits WRONG_STATE naming `cancelled`; trace: one expense_claim_transitioned open → cancelled.",
    ),
  ],
  returns: rpc_payroll_expense_claims_withdraw.output,
  errors: CLI,
  refusals: [
    ...selfOnly(W_EXP, ", or Sam names Lead's claim <C4>"),
    wrong("Sam's claim <C2> is already approved: the refusal names its status, and nothing is written.", W_EXP),
  ],
  budget: budget("write"),
});

// ── the department's expense claims ─────────────────────────────────────────────────────────

const selfApproval = (what: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given: W_EXP,
  when: `Lead, who wears \`salaries\`' office hat and is an Employee of it, ${what} his own: self-approval is refused, and nothing is written.`,
});

/** An advance of the decider's own: Lead is an Employee of `salaries` as well as its office holder. */
const selfAdvance = (what: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given: W_EXP,
  when:
    "After Lead, an Employee of `salaries` as well as its office holder, asks for his own advance (`hr advance request " +
    "--amount 50 --purpose Books`), he " + what + " it: nobody decides their own, and nothing is prepared or written.",
});

export const operation_org_hr_expense_claim_approve = defineOperation({
  id: "org.hr.expense-claim.approve",
  title: "Approve an expense claim",
  about:
    "Approves an open expense claim, sanctioning each line at its amount or at less (`--sanction <line>=<amount>`), " +
    "and posts what is owed to the books: each line's expense against the claimant's payable, less what their advances " +
    "settle. A claim its advances cover in full is paid at once. Whoever wears the claim's department's hat, or one " +
    "above it, as the chain reads it then, approves; never the claimant.",
  area: AREA,
  command: "org hr expense-claim approve",
  priority: "critical",
  implementedBy: rpc_payroll_expense_claims_approve,
  who: WHO_DEPARTMENT,
  changes: "The claim, approved (or paid when its advances cover it); its advances' claimed amounts; its accrual posted through books.",
  acceptance: [
    claim(
      "The department's hat approves a claim, and what is owed is posted.",
      "cli: from org-with-expenses, Lead's `org hr expense-claim approve <C1> --sanction 1=100 --org acme --json` prints " +
        "`status: approved`, `sanctioned: 100.00`, `grandTotal: 100.00` and `decidedBy: lead@acme.test`; read: Dana's `org " +
        "books facts list --org acme` shows one more `accrual_posted` fact naming the Expense Claim; trace: one " +
        "expense_claim_transitioned open → approved.",
    ),
    claim(
      "Nobody approves their own claim, and neither the People hat nor another department's does.",
      "cli: from org-with-expenses, Lead's `org hr expense-claim approve <C4>`, and Pat's and Plat's `org hr expense-claim " +
        "approve <C1>`, each exit ROLE_PERMISSION_DENIED; world: no diff.",
    ),
    claim(
      "A claim its advances cover is paid at its approval.",
      "cli: from org-with-expenses, after Sam's `hr expense-claim create --type Meals --amount 120 --advance <A2>`, Lead's " +
        "`org hr expense-claim approve <it> --json` prints `status: paid` and `grandTotal: 0.00`; read: `org hr advance get <A2>` " +
        "shows `claimed: 120.00`, `unclaimed: 30.00`, still `paid`; chain: no Budgets.spend.",
    ),
  ],
  returns: rpc_payroll_expense_claims_approve.output,
  errors: CLI,
  refusals: [
    ...departmentOnly("approves Sam's claim <C1>", W_EXP),
    selfApproval("approves <C4>,"),
    invalid("The claim is none of Acme's, or `--sanction 1=200` is above the line's 120.00: the refusal names the line, and nothing is written.", W_EXP),
    wrong("<C2> is already approved: the refusal names its status, and nothing is written.", W_EXP),
    chainDown("nothing is written"),
  ],
  budget: budget("chain-read"),
});

export const operation_org_hr_expense_claim_reject = defineOperation({
  id: "org.hr.expense-claim.reject",
  title: "Reject an expense claim",
  about: "Rejects an open expense claim with a reason; nothing is owed, and any advance it named is free for another claim. The same hat as approving decides.",
  area: AREA,
  command: "org hr expense-claim reject",
  priority: "normal",
  implementedBy: rpc_payroll_expense_claims_reject,
  who: WHO_DEPARTMENT,
  changes: "The claim, rejected, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A rejected claim is owed nothing, and its claimant sees why.",
      "cli: from org-with-expenses, Lead's `org hr expense-claim reject <C1> --reason \"Personal trip\" --org acme --json` " +
        "prints `status: rejected` with the reason; Sam's `hr expense-claim list --status rejected` lists it with the reason; world: no books fact.",
    ),
    claim(
      "An advance the rejected claim named is free for another claim.",
      "cli: from org-with-expenses, after Sam's `hr expense-claim create --type Travel --amount 180 --advance <A2>` " +
        "and Lead's `org hr expense-claim reject <it> --reason Duplicate --org acme`, Sam's `hr advance list` shows " +
        "<A2> `unclaimed: 150.00`, and Sam's second `hr expense-claim create --type Travel --amount 180 --advance <A2>` " +
        "prints `advanced: 150.00`.",
    ),
    claim(
      "A rejection is decided once.",
      "cli: from org-with-expenses, after Lead's `org hr expense-claim reject <C1> --reason \"Personal trip\"`, the " +
        "same command again exits WRONG_STATE naming `rejected`; world: that refusal's diff is empty; trace: one " +
        "expense_claim_transitioned open → rejected in all.",
    ),
  ],
  returns: rpc_payroll_expense_claims_reject.output,
  errors: CLI,
  refusals: [
    ...departmentOnly("rejects <C1>", W_EXP),
    selfApproval("rejects <C4>,"),
    invalid("No `--reason` is given, or the claim is none of Acme's: nothing is written.", W_EXP),
    wrong("<C3> is paid: the refusal names its status, and nothing is written.", W_EXP),
    chainDown("nothing is written"),
  ],
  budget: budget("chain-read"),
});

export const operation_org_hr_expense_claim_pay = defineOperation({
  id: "org.hr.expense-claim.pay",
  title: "Pay an approved expense claim",
  about:
    "Pays an approved claim's grand total to its claimant from its department's budget, as one payment command with " +
    "one approval, which the caller signs from their own Safe. A lapsed approval resumes the same command, so a claim " +
    "is never paid twice; a declined one leaves it owed. Paying is the department's: whoever wears its hat, or one " +
    "above it, when the payment is made; never the claimant.",
  area: AREA,
  command: "org hr expense-claim pay",
  priority: "critical",
  implementedBy: flow_client_org_hr_expense_claims_pay,
  who: WHO_DEPARTMENT,
  changes: "One payment command from the department's budget and its one approval; the claim paying, then paid with the settled facts.",
  acceptance: [
    claim(
      "One approval pays an approved claim from the department's budget to its claimant.",
      "cli: from org-with-expenses, Lead's `org hr expense-claim pay <C2> --org acme --json` signs one approval and prints " +
        "`status: paid` with the claim's `paymentId` and `txHash`; chain: one UserOperation from Lead's Safe whose " +
        "Budgets.spend from `salaries` pays 45 USDC to Sam's Safe; trace: expense_claim_transitioned approved → paying and paying → paid.",
    ),
    claim(
      "Whoever wears the department's hat when it pays may pay, never the one swapped out.",
      "cli: from org-with-expenses, Pat's `org hr expense-claim pay <C2>` exits ROLE_PERMISSION_DENIED; after the Board moves " +
        "`salaries`' office from Lead to Plat (`org department holder remove salaries lead@acme.test`, then `holder add " +
        "salaries plat@acme.test`, both Directors approving), Lead's exits ROLE_PERMISSION_DENIED and Plat's pays it.",
    ),
    claim(
      "Asking twice pays once, and a lapsed approval resumes the same command.",
      "cli: from org-with-expenses, Lead's `org hr expense-claim pay <C2> --request-key k1 --no-wait --json` prints `status: " +
        "awaiting_approval` and an `approvalId`; the same again prints the same `approvalId`; after it lapses unsigned " +
        "(`capxul dev time warp 2h`) the claim reads `approved`, and Lead's next pay opens a new approval on the same " +
        "payment command; world: one payment command for the claim.",
    ),
    claim(
      "A declined approval sends nothing and leaves the claim owed.",
      "cli: from org-with-expenses, Lead declines the approval of `org hr expense-claim pay <C2>` on the approval page: exit " +
        "130, CANCELLED; read: `org hr expense-claim get <C2>` shows `approved` with no payment; chain: no Budgets.spend.",
    ),
  ],
  returns: flow_client_org_hr_expense_claims_pay.output,
  errors: CLI,
  refusals: [
    signedOut,
    outsider(W_EXP),
    notDepartment("pays <C2>", W_EXP),
    invalid("The claim is none of Acme's: nothing is prepared.", W_EXP),
    wrong("<C1> is open, not approved: the refusal names its status, and nothing is prepared.", W_EXP),
    { error: error_PAYROLL_BUDGET_EXCEEDED, given: W_EXP_BUDGET, when: "`salaries` has 30 USDC left this month, less than <C2>'s 45: nothing is prepared or signed." },
    { error: error_INSUFFICIENT_BALANCE, given: W_EXP_SHORT, when: "The company Safe holds 40 USDC, less than <C2>'s 45, though `salaries` has room: nothing is prepared or signed." },
    chainDown("nothing is prepared or signed"),
    { error: error_CANCELLED, given: W_EXP, when: "Lead declines the claim's approval on the approval page: nothing is sent, its Payment is cancelled, and the claim is approved and owed again." },
  ],
  budget: budget("chain-submit"),
});

export const operation_org_hr_expense_claim_cancel = defineOperation({
  id: "org.hr.expense-claim.cancel",
  title: "Cancel an approved expense claim before it is paid",
  about:
    "Cancels an approved claim nothing of which is paid or on its way: its accrual is cancelled in the books and any " +
    "advance it settled is unclaimed again. The department's hat cancels it.",
  area: AREA,
  command: "org hr expense-claim cancel",
  priority: "normal",
  implementedBy: rpc_payroll_expense_claims_cancel,
  who: WHO_DEPARTMENT,
  changes: "The claim, cancelled; its advances unclaimed; its accrual cancelled through books.",
  acceptance: [
    claim(
      "An approved claim is cancelled with its accrual; a paid one is not.",
      "cli: from org-with-expenses, Lead's `org hr expense-claim cancel <C2> --org acme --json` prints `status: cancelled`; " +
        "read: Dana's `org books facts list` shows one `accrual_cancelled` fact naming it; Lead's `org hr expense-claim " +
        "cancel <C3>` exits WRONG_STATE naming `paid`.",
    ),
    claim(
      "A cancellation is done once, with one books fact.",
      "cli: from org-with-expenses, after Lead's `org hr expense-claim cancel <C2> --org acme`, the same command " +
        "again exits WRONG_STATE naming `cancelled`; read: Dana's `org books facts list` still shows one " +
        "`accrual_cancelled` fact naming <C2>; trace: one expense_claim_transitioned approved → cancelled.",
    ),
    claim(
      "Its claimant sees it cancelled, and nothing is paid.",
      "cli: from org-with-expenses, after that cancel, Sam's `hr expense-claim get <C2> --json` prints `status: " +
        "cancelled` and no payment; chain: no transaction for it.",
    ),
  ],
  returns: rpc_payroll_expense_claims_cancel.output,
  errors: CLI,
  refusals: [
    ...departmentOnly("cancels <C2>", W_EXP),
    invalid("The claim is none of Acme's: nothing is written.", W_EXP),
    wrong("<C3> is paid, or <C1> is still open: the refusal names its status, and nothing is written.", W_EXP),
    chainDown("nothing is written"),
  ],
  budget: budget("chain-read"),
});

const readerRefusals = (given: string) => [
  signedOut,
  outsider(given),
  { error: error_ROLE_PERMISSION_DENIED, given, when: "Sam, a member wearing neither the People hat nor any department's, reads them: nothing is read." },
];

export const operation_org_hr_expense_claim_list = defineOperation({
  id: "org.hr.expense-claim.list",
  title: "List the Organization's expense claims",
  about: "Lists expense claims newest first: every one for the People hat, a department's and those below it for its hat. `--status`, `--employee` and `--department` filter.",
  area: AREA,
  command: "org hr expense-claim list",
  priority: "normal",
  implementedBy: rpc_payroll_expense_claims_list,
  who: WHO_EXPENSE_READER,
  changes: NOTHING,
  acceptance: [
    claim(
      "Each hat lists the claims it may read.",
      "cli: from org-with-expenses, Lead's `org hr expense-claim list --org acme --json` lists <C1> to <C4>, `salaries`'; " +
        "Pat's lists the same; Plat's lists none; `--status approved` lists <C2> alone.",
    ),
    claim(
      "`--employee` keeps one Employee's claims, a page at a time; reading writes nothing.",
      "cli: from org-with-expenses, Lead's `org hr expense-claim list --employee <Sam> --org acme --json` lists <C1>, " +
        "<C2> and <C3> and not <C4>; `--limit 2` lists two and a `nextCursor`; world: the diff is empty.",
    ),
  ],
  returns: rpc_payroll_expense_claims_list.output,
  errors: CLI,
  refusals: [...readerRefusals(W_EXP), invalid("`--department` names none of Acme's budgets, or `--after` is a cursor this list did not give: nothing is listed.", W_EXP)],
  budget: budget("read"),
});

export const operation_org_hr_expense_claim_get = defineOperation({
  id: "org.hr.expense-claim.get",
  title: "Read one of the Organization's expense claims",
  about: "Reads one expense claim with its lines, receipts, the advances it settles, its totals, who decided it and, once sent, its payment.",
  area: AREA,
  command: "org hr expense-claim get",
  priority: "normal",
  implementedBy: rpc_payroll_expense_claims_get,
  who: WHO_EXPENSE_READER,
  changes: NOTHING,
  acceptance: [
    claim(
      "The department's hat reads a claim with its receipt; another department's does not.",
      "cli: from org-with-expenses, Lead's `org hr expense-claim get <C1> --org acme --json` prints Travel 120.00, the " +
        "receipt taxi.pdf and `status: open`; Plat's exits INVALID_INPUT, as a claim he may not read.",
    ),
    claim(
      "The People hat reads every claim, and a paid one with what settled it; reading writes nothing.",
      "cli: from org-with-expenses, Pat's `org hr expense-claim get <C3> --org acme --json` prints `status: paid`, " +
        "<A1> 200.00 advanced, `grandTotal: 100.00` and its `paymentId`; world: the diff is empty.",
    ),
  ],
  returns: rpc_payroll_expense_claims_get.output,
  errors: CLI,
  refusals: [...readerRefusals(W_EXP), invalid("Plat names <C1>, `salaries`', which his `platform` hat does not reach: nothing is read.", W_EXP)],
  budget: budget("read"),
});

// ── the Employee's advances ─────────────────────────────────────────────────────────────────

export const operation_hr_advance_request = defineOperation({
  id: "hr.advance.request",
  title: "Ask for an advance",
  about:
    "Asks your employer for money ahead, for a purpose, in your department budget's token, as Frappe's Employee " +
    "Advance. Whoever wears your department's hat pays it, which approves it, or rejects it. What your expense claims " +
    "do not settle of it is later recovered from your salary.",
  area: AREA,
  command: "hr advance request",
  priority: "normal",
  implementedBy: rpc_payroll_advances_request,
  who: WHO_SELF_HR,
  changes: "One requested Employee Advance, and its line in payroll's change log.",
  acceptance: [
    claim(
      "An Employee asks for an advance from their department.",
      "cli: from org-with-expenses, Sam's `hr advance request --amount 250 --purpose \"Trade fair\" --json` prints an `adv_` " +
        "advance, `status: requested`, `department: salaries`, `amount: 250.00`; trace: one employee_advance_transitioned to requested.",
    ),
    claim(
      "The department's hat sees the request at once, to pay or reject it; another department's does not.",
      "cli: from org-with-expenses, after Sam's `hr advance request --amount 250 --purpose \"Trade fair\"`, Lead's `org " +
        "hr advance list --status requested --org acme` lists it beside <A3>, and Plat's lists neither.",
    ),
    claim(
      "Nothing is paid until the department pays it.",
      "cli: from org-with-expenses, after that request, Sam's `hr advance list --status requested --json` shows it " +
        "with nothing paid; chain: no transaction for it.",
    ),
  ],
  returns: rpc_payroll_advances_request.output,
  errors: CLI,
  refusals: [...selfOnly(W_EXP, ", or the amount is 0 or the purpose empty"), suspended("asks for an advance", W_EXP)],
  budget: budget("write"),
});

export const operation_hr_advance_list = defineOperation({
  id: "hr.advance.list",
  title: "List your own advances",
  about: "Lists your advances, from every employer unless `--employer` keeps one, newest first, each with what was paid, claimed and recovered, what is left, and any recovery set for your next payslip.",
  area: AREA,
  command: "hr advance list",
  priority: "normal",
  implementedBy: rpc_payroll_advances_mine,
  who: WHO_SELF_HR,
  changes: NOTHING,
  acceptance: [
    claim(
      "An Employee lists their own advances and what is left of each.",
      "cli: from org-with-expenses, Sam's `hr advance list --json` lists <A3> requested 500.00, <A2> paid with `unclaimed: " +
        "150.00`, and <A1> claimed, `unclaimed: 0.00`.",
    ),
    claim(
      "A recovery set on an advance shows with it.",
      "cli: from org-with-expenses, after Pat's `org hr advance settle <A2> --confirm --org acme`, Sam's `hr advance " +
        "list --json` shows <A2> with a `recovery` of 150.00 and its payroll day.",
    ),
    claim(
      "A page holds at most `--limit` advances, and `--status` filters; reading writes nothing.",
      "cli: from org-with-expenses, Sam's `hr advance list --limit 2 --json` lists two and a `nextCursor`, and " +
        "`--after <it>` the third with `nextCursor: null`; `--status paid` lists <A2> alone; world: the diff is empty.",
    ),
  ],
  returns: rpc_payroll_advances_mine.output,
  errors: CLI,
  refusals: selfOnly(W_EXP, ", or `--after` is a cursor this list did not give"),
  budget: budget("read"),
});

export const operation_hr_advance_cancel = defineOperation({
  id: "hr.advance.cancel",
  title: "Cancel your own advance request",
  about: "Cancels your advance request while nothing of it is paid or on its way.",
  area: AREA,
  command: "hr advance cancel",
  priority: "normal",
  implementedBy: rpc_payroll_advances_withdraw,
  who: WHO_SELF_HR,
  changes: "The advance, cancelled, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A requested advance is cancelled by its Employee; a paid one is not.",
      "cli: from org-with-expenses, Sam's `hr advance cancel <A3> --json` prints `status: cancelled`; `hr advance cancel <A2>` exits WRONG_STATE naming `paid`.",
    ),
    claim(
      "A cancelled request stays listed, pays nothing, and is not cancelled again.",
      "cli: from org-with-expenses, after Sam's `hr advance cancel <A3>`, Lead's `org hr advance list --status " +
        "cancelled --org acme` lists <A3> with nothing paid; the same cancel again exits WRONG_STATE naming " +
        "`cancelled`; trace: one employee_advance_transitioned requested → cancelled.",
    ),
  ],
  returns: rpc_payroll_advances_withdraw.output,
  errors: CLI,
  refusals: [...selfOnly(W_EXP), wrong("<A2> is paid: the refusal names its status, and nothing is written.", W_EXP)],
  budget: budget("write"),
});

// ── the department's advances ───────────────────────────────────────────────────────────────

export const operation_org_hr_advance_pay = defineOperation({
  id: "org.hr.advance.pay",
  title: "Pay a requested advance",
  about:
    "Approves and pays a requested advance to its Employee from their department's budget, as one payment command " +
    "with one approval, which the caller signs from their own Safe. A lapsed approval resumes the same command; a " +
    "declined one leaves it requested. Whoever wears the department's hat, or one above it, when it is paid; never the " +
    "Employee it is for.",
  area: AREA,
  command: "org hr advance pay",
  priority: "normal",
  implementedBy: flow_client_org_hr_advances_pay,
  who: WHO_DEPARTMENT,
  changes: "One payment command from the department's budget and its one approval; the advance paying, then paid with the settled facts.",
  acceptance: [
    claim(
      "Paying an advance approves it, with one approval from the department's budget.",
      "cli: from org-with-expenses, Lead's `org hr advance pay <A3> --org acme --json` signs one approval and prints `status: " +
        "paid`, `paid: 500.00` and a `paymentId`; chain: one Budgets.spend from `salaries` of 500 USDC to Sam's Safe; " +
        "trace: employee_advance_transitioned requested → paying and paying → paid.",
    ),
    claim(
      "Whoever wears the department's hat when it pays may pay; nobody pays their own.",
      "cli: from org-with-expenses, Pat's `org hr advance pay <A3>` exits ROLE_PERMISSION_DENIED; after the Board moves " +
        "`salaries`' office from Lead to Plat, Lead's exits ROLE_PERMISSION_DENIED and Plat's pays it; from " +
        "org-with-expenses again, after Lead's own `hr advance request --amount 50 --purpose Books`, his `org hr advance pay " +
        "<it>` exits ROLE_PERMISSION_DENIED; world: no Budgets.spend for it.",
    ),
    claim(
      "A lapsed approval resumes the same command, never a second.",
      "cli: from org-with-expenses, Lead's `org hr advance pay <A3> --no-wait --json` prints `status: awaiting_approval`; after " +
        "it lapses unsigned (`capxul dev time warp 2h`) the advance reads `requested`, and Lead's next pay opens a new " +
        "approval on the same payment command; world: one payment command for the advance.",
    ),
  ],
  returns: flow_client_org_hr_advances_pay.output,
  errors: CLI,
  refusals: [
    signedOut,
    outsider(W_EXP),
    notDepartment("pays <A3>", W_EXP),
    selfAdvance("pays"),
    invalid("The advance is none of Acme's: nothing is prepared.", W_EXP),
    wrong("<A2> is already paid: the refusal names its status, and nothing is prepared.", W_EXP),
    { error: error_PAYROLL_BUDGET_EXCEEDED, given: W_EXP_BUDGET, when: "`salaries` has 30 USDC left this month, less than <A3>'s 500: nothing is prepared or signed." },
    { error: error_INSUFFICIENT_BALANCE, given: W_EXP_SHORT, when: "The company Safe holds 40 USDC, less than <A3>'s 500: nothing is prepared or signed." },
    chainDown("nothing is prepared or signed"),
    { error: error_CANCELLED, given: W_EXP, when: "Lead declines the advance's approval on the approval page: nothing is sent, and the advance is requested again." },
  ],
  budget: budget("chain-submit"),
});

export const operation_org_hr_advance_reject = defineOperation({
  id: "org.hr.advance.reject",
  title: "Reject an advance request",
  about: "Rejects a requested advance with a reason; nothing is paid. The same hat as paying decides.",
  area: AREA,
  command: "org hr advance reject",
  priority: "normal",
  implementedBy: rpc_payroll_advances_reject,
  who: WHO_DEPARTMENT,
  changes: "The advance, rejected, and its line in payroll's change log.",
  acceptance: [
    claim(
      "A rejected advance pays nothing, and its Employee sees why.",
      "cli: from org-with-expenses, Lead's `org hr advance reject <A3> --reason \"Use the company card\" --org acme --json` " +
        "prints `status: rejected` with the reason; Sam's `hr advance list` lists it so.",
    ),
    claim(
      "A rejection pays nothing and is decided once.",
      "cli: from org-with-expenses, after Lead's `org hr advance reject <A3> --reason \"Use the company card\"`, his " +
        "`org hr advance get <A3> --org acme --json` shows `status: rejected`, that `rejectionReason` and `paymentId: null`; the same " +
        "reject again exits WRONG_STATE naming `rejected`; chain: no transaction; trace: one " +
        "employee_advance_transitioned requested → rejected.",
    ),
  ],
  returns: rpc_payroll_advances_reject.output,
  errors: CLI,
  refusals: [
    ...departmentOnly("rejects <A3>", W_EXP),
    selfAdvance("rejects"),
    invalid("No `--reason` is given, or the advance is none of Acme's: nothing is written.", W_EXP),
    wrong("<A2> is paid: the refusal names its status, and nothing is written.", W_EXP),
    chainDown("nothing is written"),
  ],
  budget: budget("chain-read"),
});

export const operation_org_hr_advance_settle = defineOperation({
  id: "org.hr.advance.settle",
  title: "Recover what is left of an advance from salary",
  about:
    "Settles a paid advance by recovering what no expense claim took of it from the Employee's next payslip, as " +
    "Frappe's `repay_unclaimed_amount_from_salary`: an Additional Salary deduction their next run takes. Nothing moves " +
    "now; the advance is returned when that payslip is submitted. No command takes the deduction back, so it first " +
    "previews the Employee and the amount and asks; `--confirm` answers yes in a script. Recording pay is the People hat's.",
  area: AREA,
  command: "org hr advance settle",
  priority: "normal",
  implementedBy: flow_client_org_hr_advances_settle,
  who: `${WHO_HR} Never the hosted FDE for its asker: the preview is the member's own.`,
  changes: "One Additional Salary (and, the first time, the advance recovery component); the advance marked to be repaid from salary.",
  acceptance: [
    claim(
      "What no claim took of an advance is deducted from the Employee's next payslip, and returns the advance.",
      "cli: from org-with-expenses, Pat's `org hr advance settle <A2> --confirm --org acme --json` prints a `recovery` of 150.00 dated " +
        "today and `status: paid`; Pat's `org payroll run create salaries --start <this month's first day> --end <its " +
        "last day> --json` then shows Sam's slip with an ADVREC deduction of 150.00 and `netPay: 3650.00`; after `org " +
        "payroll run submit <it>`, `org hr advance get <A2>` shows `returned: 150.00` and `status: returned`; trace: one employee_advance_transitioned paid → returned.",
    ),
    claim(
      "An advance is recovered once, and one fully claimed has nothing to recover.",
      "cli: from org-with-expenses, after Pat settles <A2>, `org hr advance settle <A2> --confirm` again exits WRONG_STATE naming its " +
        "recovery, and `org hr advance settle <A1> --confirm` exits WRONG_STATE naming `claimed`; world: one Additional Salary in all.",
    ),
    claim(
      "Answering no at the preview deducts nothing, and a script must say `--confirm`.",
      "cli: from org-with-expenses, at a terminal Pat answers no to the preview of `org hr advance settle <A2>`, which names " +
        "Sam and 150.00 from his next payslip: exit 130, CANCELLED; with no terminal and no `--confirm`: CLI_USAGE; world: no diff after either.",
    ),
  ],
  returns: flow_client_org_hr_advances_settle.output,
  errors: CLI,
  refusals: [
    ...peopleOnly("settles <A2>", W_EXP),
    unknownId("advances", "adv_", W_EXP),
    wrong("<A1> is claimed in full, or <A3> is not yet paid: the refusal names its status, and nothing is written.", W_EXP),
    { error: error_CANCELLED, given: W_EXP, when: "At a terminal, Pat answers no to the preview of settling <A2>: nothing is written." },
    { error: error_CLI_USAGE, given: W_EXP, when: "A script with no terminal and no `--confirm` settles <A2>: refused before any call, and nothing is written." },
  ],
  budget: budget("write"),
});

export const operation_org_hr_advance_list = defineOperation({
  id: "org.hr.advance.list",
  title: "List the Organization's advances",
  about: "Lists advances newest first: every one for the People hat, a department's and those below it for its hat. `--status`, `--employee` and `--department` filter.",
  area: AREA,
  command: "org hr advance list",
  priority: "normal",
  implementedBy: rpc_payroll_advances_list,
  who: WHO_EXPENSE_READER,
  changes: NOTHING,
  acceptance: [
    claim(
      "Each hat lists the advances it may read.",
      "cli: from org-with-expenses, Lead's `org hr advance list --org acme --json` lists <A1> claimed, <A2> paid and <A3> " +
        "requested; `--status requested` lists <A3> alone; Plat's lists none.",
    ),
    claim(
      "The People hat lists every advance; `--employee` and pages narrow it; reading writes nothing.",
      "cli: from org-with-expenses, Pat's `org hr advance list --org acme --json` lists <A1>, <A2> and <A3>; " +
        "`--employee <Sam> --limit 2` lists two and a `nextCursor`, and `--after <it>` the third; world: the diff is " +
        "empty.",
    ),
  ],
  returns: rpc_payroll_advances_list.output,
  errors: CLI,
  refusals: [...readerRefusals(W_EXP), invalid("`--employee` names none of Acme's Employees, or `--after` is a cursor this list did not give: nothing is listed.", W_EXP)],
  budget: budget("read"),
});

export const operation_org_hr_advance_get = defineOperation({
  id: "org.hr.advance.get",
  title: "Read one of the Organization's advances",
  about: "Reads one advance: what was paid, claimed and recovered, the claims that settled it, its recovery and, once sent, its payment.",
  area: AREA,
  command: "org hr advance get",
  priority: "normal",
  implementedBy: rpc_payroll_advances_get,
  who: WHO_EXPENSE_READER,
  changes: NOTHING,
  acceptance: [
    claim(
      "An advance reads with what settled it.",
      "cli: from org-with-expenses, Lead's `org hr advance get <A1> --org acme --json` prints `paid: 200.00`, `claimed: " +
        "200.00`, `status: claimed` and its `paymentId`.",
    ),
    claim(
      "The People hat reads every advance, and a paid one shows what is left unclaimed; reading writes nothing.",
      "cli: from org-with-expenses, Pat's `org hr advance get <A2> --org acme --json` prints `status: paid`, " +
        "`unclaimed: 150.00` and `recovery: null`; world: the diff is empty.",
    ),
    claim(
      "A recovery shows once the advance is settled.",
      "cli: from org-with-expenses, after Pat's `org hr advance settle <A2> --confirm`, Lead's `org hr advance get " +
        "<A2> --org acme --json` shows its `recovery` of 150.00 with its payroll day.",
    ),
  ],
  returns: rpc_payroll_advances_get.output,
  errors: CLI,
  refusals: [...readerRefusals(W_EXP), invalid("Plat names <A1>, `salaries`', which his `platform` hat does not reach: nothing is read.", W_EXP)],
  budget: budget("read"),
});

/** Every HR operation of the pack payroll.hr-commands. */
export const HR_OPERATIONS = [
  operation_org_hr_holiday_add,
  operation_org_hr_holiday_remove,
  operation_org_hr_holiday_list,
  operation_org_hr_leave_type_add,
  operation_org_hr_leave_type_change,
  operation_org_hr_leave_type_list,
  operation_org_hr_leave_allocate,
  operation_org_hr_leave_unallocate,
  operation_org_hr_leave_balance,
  operation_hr_leave_apply,
  operation_hr_leave_list,
  operation_hr_leave_cancel,
  operation_hr_leave_balance,
  operation_org_hr_leave_approve,
  operation_org_hr_leave_reject,
  operation_org_hr_leave_list,
  operation_org_hr_shift_type_add,
  operation_org_hr_shift_type_list,
  operation_org_hr_shift_type_assign,
  operation_org_hr_shift_type_unassign,
  operation_hr_attendance_checkin,
  operation_hr_attendance_list,
  operation_org_hr_attendance_mark,
  operation_org_hr_attendance_cancel,
  operation_org_hr_attendance_list,
  operation_org_hr_expense_type_add,
  operation_org_hr_expense_type_list,
  operation_hr_expense_claim_create,
  operation_hr_expense_claim_list,
  operation_hr_expense_claim_get,
  operation_hr_expense_claim_cancel,
  operation_org_hr_expense_claim_approve,
  operation_org_hr_expense_claim_reject,
  operation_org_hr_expense_claim_pay,
  operation_org_hr_expense_claim_cancel,
  operation_org_hr_expense_claim_list,
  operation_org_hr_expense_claim_get,
  operation_hr_advance_request,
  operation_hr_advance_list,
  operation_hr_advance_cancel,
  operation_org_hr_advance_pay,
  operation_org_hr_advance_reject,
  operation_org_hr_advance_settle,
  operation_org_hr_advance_list,
  operation_org_hr_advance_get,
];
export const HR_CRITICAL = HR_OPERATIONS.filter((o) => o.priority === "critical");
