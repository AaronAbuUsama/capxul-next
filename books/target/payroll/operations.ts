// The eleven frozen operations payroll owns (OPERATION_OWNERS: area payroll), each built from its
// frozen text. Acceptance lines keep their claim word for word (P1), except the lines opening "On
// v4", which lose the opening (P9), and one line that named the old read-time settling, rewritten as
// an outcome (payroll.acceptance). "Reports" in a claim is read as decision payroll.reports says.
//
// The writes are implemented by one Core SDK flow each (flows.ts); the reads by one rpc each.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
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
  return { claim: rest.charAt(0).toUpperCase() + rest.slice(1), observes, was: [`frozen: ${line.claim}`, ...line.was] };
};

/** P1: a claim that named an internal mechanism, rewritten as an outcome (payroll.acceptance). */
const rewritten = (id: FrozenId, n: number, claim: string, observes: string): Claim => {
  const line = frozenLine(id, n);
  return { claim, observes, was: [`frozen: ${line.claim}`, ...line.was] };
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
