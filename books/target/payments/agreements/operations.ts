// The eleven frozen operations payroll owns (OPERATION_OWNERS: area payroll), each built from its
// frozen text, and then, at the end of the file, Frappe HR's 28 commands beyond the 215 (payroll.hr-surface) and
// the 45 HR commands after them (payroll.hr-commands; rules.new-operations books them here). Acceptance lines keep
// their claim word for word (P1), except the lines opening "On
// v4", which lose the opening (P9), and one line that named the old read-time settling, rewritten as
// an outcome (payroll.acceptance). "Reports" in a claim is read as decision payroll.reports says.
//
// The writes are implemented by one Core SDK flow each (flows.ts); the reads by one rpc each.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../../frozen/index.ts";
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
} from "../../shared/vocabulary.ts";
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

/** The refusals a status verb shares: an unknown Employee, and the state its transition does not leave from. */
const statusRefusals = (what: string, wrong: string) => [
  ...peopleOnly(what),
  unknownId("Employees", "emp_"),
  hrWrong(`${wrong} The refusal names the status, and nothing is written.`),
];

// Salary components

// Salary structures and assignments

// Payroll runs

// Payslips: the Organization's hold on one

// Payslips: the payee's own

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

// ── leave types ─────────────────────────────────────────────────────────────────────────────

// ── allocations and balances ────────────────────────────────────────────────────────────────

// ── the Employee's leave ────────────────────────────────────────────────────────────────────

// ── deciding leave ──────────────────────────────────────────────────────────────────────────

const notApprover = (what: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given: W_LEAVE,
  when:
    `Plat, whose Safe wears \`platform\`'s office hat and not \`salaries\`' or one above it nor the People hat, ${what}; ` +
    "or Lead decides his own application: self-approval is refused, and nothing is written.",
});

// ── shifts ──────────────────────────────────────────────────────────────────────────────────

// ── check-ins and attendance ────────────────────────────────────────────────────────────────

// ── expense claim types ─────────────────────────────────────────────────────────────────────

// ── the claimant's expense claims ───────────────────────────────────────────────────────────

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

const readerRefusals = (given: string) => [
  signedOut,
  outsider(given),
  { error: error_ROLE_PERMISSION_DENIED, given, when: "Sam, a member wearing neither the People hat nor any department's, reads them: nothing is read." },
];

// ── the Employee's advances ─────────────────────────────────────────────────────────────────

// ── the department's advances ───────────────────────────────────────────────────────────────

