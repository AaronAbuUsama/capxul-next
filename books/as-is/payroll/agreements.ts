// The as-is book of the old payroll concept: the agreements area (slices 08 to 10, CAP-1058,
// CAP-1118, CAP-1122): a department holder's payment agreements, their payee's accept and collect,
// an Organization payee's (Payee A), their notices and the daily sweep.
//
// Every operation registered at `payroll/agreements:*` (packages/backend/convex/payroll/agreements.ts).
// Eighteen are public rows of `agreements` (packages/protocol/src/payroll/agreement-operations.ts).
// The rest are internal: queries and mutations an action runs in the same call, the two send actions
// accounts' approval page runs (`sendSigned`, `sendPayeeSigned`), and emitTransitioned (telemetry
// plumbing). notify (scheduled by an agreement event) and sweep (a daily cron) are workflows.
//
// How touches are booked: as runs.ts. A public action lists what the payroll rpcs it runs touch on
// the paths it can take: pre-v4 (PayrollDepartments, a holder's write through the department's Roles
// role) and Protocol v4 (Agreements and Budgets, a plain call). Named in `about`, not linked:
// accounts' internal mutation `accounts.approvals.openForAgreement`, which opens the approval a write
// signs; organizations' action helpers requireSafeOwner and settleOrganizationProposals; payments'
// buildSponsoredSafeUserOp, whose chain calls are booked under `calls`.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_IMPLEMENTED,
  error_PAYER_BALANCE_TOO_LOW,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_TOKEN_NOT_BUDGETED,
  error_TOKEN_NOT_SUPPORTED,
  error_TOKEN_REQUIRED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_payroll_agreement_transitioned,
} from "../shared/vocabulary.ts";
import {
  contract_agreements,
  contract_budgets,
  contract_entry_point,
  contract_erc20,
  contract_payroll_departments,
  contract_roles,
  contract_safe,
  integration_chain_rpc,
  integration_mail,
} from "../shared/external.ts";
import {
  machine_payroll_agreement,
  machine_payroll_agreement_payee_write,
  machine_payroll_agreement_write,
  machine_payroll_department,
  machine_payroll_department_change,
  table_payroll_agreement_notices,
  table_payroll_agreement_payee_writes,
  table_payroll_agreements,
  table_payroll_department_changes,
  table_payroll_departments,
} from "./data.ts";
import {
  procedure_payments_birth_collection_payment_in_tx,
  procedure_payments_read_collection_payment_in_tx,
} from "../payments/procedures.ts";
import {
  procedure_access_feature_on_from_action,
  procedure_access_require_feature_from_action,
} from "../access/procedures.ts";
import {
  procedure_accounts_account_id_for_auth_user_or_null,
  procedure_accounts_read_workspace_setup_signer_in_tx,
} from "../accounts/procedures.ts";
import {
  procedure_organizations_read_activity_safe_address_in_tx,
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_read_organizations_at_safe_in_tx,
  procedure_organizations_read_owner_safes_in_tx,
  procedure_organizations_read_subject_proposal_in_tx,
  procedure_organizations_record_owner_proposal_in_tx,
  procedure_organizations_require_org_participant,
} from "../organizations/procedures.ts";
import { procedure_parties_party_by_handle, procedure_parties_party_by_safe_address } from "../parties/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/payroll/agreements.ts`;
const SRC = `${BACKEND}/src/payroll`;
const AG = `${SRC}/agreements`;
const OPS = `${AG}/operations`;
const ROWS = "packages/protocol/src/payroll/agreement-operations.ts";
const ORG_GUARDS = `${BACKEND}/src/organizations/proposals/guards.ts`;
const OPEN_APPROVAL = `${BACKEND}/src/accounts/approvals/operations/open-for-agreement.ts`;

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

/** Keep each link once, in first-seen order. */
const union = <const L extends ReadonlyArray<ReadonlyArray<{ readonly id: string }>>>(...lists: L): Array<L[number][number]> => {
  const seen = new Set<string>();
  const out: Array<L[number][number]> = [];
  for (const list of lists)
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  return out;
};
const spanUnion = (...lists: ReadonlyArray<ReadonlyArray<string>>): string[] => [...new Set(lists.flat())];

type Touch = {
  readonly reads?: ReadonlyArray<{ readonly _kind: "table"; readonly id: string }>;
  readonly writes?: ReadonlyArray<{ readonly _kind: "table"; readonly id: string }>;
  readonly drives?: ReadonlyArray<{ readonly _kind: "transition"; readonly id: string }>;
  readonly invokes?: ReadonlyArray<{ readonly _kind: "procedure"; readonly id: string }>;
  readonly emits?: ReadonlyArray<{ readonly _kind: "event"; readonly id: string }>;
  readonly calls?: ReadonlyArray<{ readonly _kind: "call"; readonly id: string }>;
  readonly chain?: ReadonlyArray<{ readonly _kind: "function"; readonly id: string }>;
  readonly spans?: ReadonlyArray<string>;
};

/** A workflow's touches carry no spans. */
const withoutSpans = <T extends { readonly spans: unknown }>({ spans: _spans, ...rest }: T): Omit<T, "spans"> => rest;

/** Every touch of every part, each link once: what one action does across the rpcs it runs. */
const all = (...parts: ReadonlyArray<Touch>) => ({
  reads: union(...parts.map((p) => p.reads ?? [])),
  writes: union(...parts.map((p) => p.writes ?? [])),
  drives: union(...parts.map((p) => p.drives ?? [])),
  invokes: union(...parts.map((p) => p.invokes ?? [])),
  emits: union(...parts.map((p) => p.emits ?? [])),
  calls: union(...parts.map((p) => p.calls ?? [])),
  chain: union(...parts.map((p) => p.chain ?? [])),
  spans: spanUnion(...parts.map((p) => p.spans ?? [])),
});

// ── errors (agreement-operations.ts:33 to :126; protocol/src/operation.ts:54) ───────────────

const CALL_DEFECTS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];
/** `AGREEMENT_WRITE`. */
const AGREEMENT_WRITE = [
  ...CALL_DEFECTS,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
  error_SMART_ACCOUNT_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_INSUFFICIENT_BALANCE,
];
/** `AGREEMENT_COMMIT`: an offer or a raise needs room in the budget. */
const AGREEMENT_COMMIT = [...AGREEMENT_WRITE, error_PAYROLL_BUDGET_EXCEEDED];
/** `AGREEMENT_OFFER`: an offer names its token. */
const AGREEMENT_OFFER = [...AGREEMENT_COMMIT, error_TOKEN_NOT_SUPPORTED, error_TOKEN_REQUIRED, error_TOKEN_NOT_BUDGETED];
/** `AGREEMENT_READ`. */
const AGREEMENT_READ = [...CALL_DEFECTS, error_ROLE_PERMISSION_DENIED, error_PROVIDER_ERROR];
/** `PAYEE_LIST`: a sent collection settles into the Payment ledger first. */
const PAYEE_LIST = [...CALL_DEFECTS, error_PROVIDER_ERROR, error_NOT_IMPLEMENTED];
/** `PAYEE_READ`. */
const PAYEE_READ = [...PAYEE_LIST, error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING];
/** `PAYEE_WRITE`. */
const PAYEE_WRITE = [...PAYEE_READ, error_WRONG_STATE, error_PROVIDER_RESPONSE_INVALID, error_INSUFFICIENT_BALANCE];
/** `ORGANIZATION_PAYEE_READ`. */
const ORG_PAYEE_READ = [...PAYEE_LIST, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE];
/** `ORGANIZATION_PAYEE_WRITE`. */
const ORG_PAYEE_WRITE = [...ORG_PAYEE_READ, error_SMART_ACCOUNT_MISSING];

// ── shapes ─────────────────────────────────────────────────────────────────────────────────

const AGREEMENT_STATUSES = ["prepared", "offered", "active", "paused", "ending", "ended", "lapsed", "withdrawn", "abandoned"] as const;
const Status = Schema.Literals(AGREEMENT_STATUSES);
const Call = Schema.Struct({ to: S, data: S });
const AgreementRequest = Schema.Struct({ orgId: S, agreementId: S });
const PayeeRequest = Schema.Struct({ agreementId: S });
const OrganizationPayeeRequest = Schema.Struct({ orgId: S, agreementId: S });

/** `AgreementWriteSchema` (agreement-schema.ts:263); the agreement, department and approval are too deep: Unknown. */
const AgreementWrite = Schema.Struct({
  action: Schema.Literals(["offer", "withdraw", "change", "cancelChange", "pause", "resume", "end"]),
  agreement: Schema.Unknown,
  department: Schema.Unknown,
  call: Call,
  role: opt(Schema.Struct({ rolesModule: S, roleKey: S })),
  protocol: opt(Schema.Struct({ version: Schema.Literals(["v4"]), budgetId: S })),
  approval: Schema.Unknown,
});
/** `PayeeAgreementSchema` (agreement-payee-schema.ts): the terms, the money, the next release; too deep. */
const PayeeAgreement = Schema.Unknown;
const NothingReleased = Schema.Struct({
  status: Schema.Literals(["nothing_released"]),
  collected: Schema.Literals(["0.00"]),
  earned: S,
  nextReleaseAt: Schema.NullOr(S),
  nextReleaseAmount: Schema.NullOr(S),
  agreement: PayeeAgreement,
});
const Remainder = opt(Schema.Struct({ owed: S, collectableFrom: S }));
/** `PayeeWritePreparedSchema` (agreement-payee-schema.ts:142). */
const PayeeWritePrepared = Schema.Struct({
  status: Schema.Literals(["prepared"]),
  action: Schema.Literals(["accept", "collect"]),
  agreement: PayeeAgreement,
  call: Call,
  approval: Schema.Unknown,
  collected: Schema.NullOr(S),
  preview: Schema.NullOr(Schema.Unknown),
  remainder: Remainder,
});
/** `OrganizationPayeeWriteProposedSchema` (agreement-payee-schema.ts:206). */
const OrganizationPayeeWriteProposed = Schema.Struct({
  status: Schema.Literals(["proposed"]),
  action: Schema.Literals(["accept", "collect"]),
  agreement: PayeeAgreement,
  proposal: Schema.Unknown,
  collected: Schema.NullOr(S),
  preview: Schema.NullOr(Schema.Unknown),
  remainder: Remainder,
});
/** A sent write's receipt, as an action hands it to a settle mutation (operations/settle.ts:28). */
const WriteOutcome = Schema.Union([
  Schema.Struct({ outcome: Schema.Literals(["pending"]) }),
  Schema.Struct({ outcome: Schema.Literals(["failed"]), txHash: S }),
  Schema.Struct({
    outcome: Schema.Literals(["landed"]),
    txHash: S,
    landedAtMs: N,
    events: Schema.Array(
      Schema.Struct({
        event: Schema.Literals(["offered", "withdrawn", "rateChanged", "rateChangeCancelled", "paused", "resumed", "ended", "accepted", "collected"]),
        id: S,
        settlementId: opt(S),
        amount: opt(S),
      }),
    ),
  }),
]);
const SweepNotice = Schema.Struct({
  key: S,
  notice: Schema.Struct({
    template: Schema.Literals(["pay-ready", "agreement-ending", "agreement-ended", "low-balance-alert"]),
    to: Schema.Array(S),
    content: Schema.Struct({ subject: S, html: S, text: S }),
  }),
});
/** The stored agreement row and payee write row as an internal rpc carries them: see data.ts. */
const AgreementRowShape = Schema.Unknown;
const SignedSend = Schema.Struct({ userOpHash: S });

// ── shared touches ─────────────────────────────────────────────────────────────────────────

const GATE: Touch = { invokes: [procedure_access_require_feature_from_action] };

/** payroll.departments.settle, run by settleDepartments before every holder action (departments/writes.ts:209). */
const DEPARTMENTS_SETTLE: Touch = {
  reads: [table_payroll_department_changes, table_payroll_departments],
  writes: [table_payroll_department_changes, table_payroll_departments],
  drives: [
    machine_payroll_department_change.t.to_applied,
    machine_payroll_department_change.t.to_abandoned,
    machine_payroll_department.t.to_active,
    machine_payroll_department.t.to_abandoned,
  ],
  invokes: [procedure_organizations_read_subject_proposal_in_tx],
};

/** payroll.agreements.load: the holder's context (readAgreementContextInTx, reads/context.ts:106). */
const LOAD: Touch = {
  reads: [table_payroll_departments, table_payroll_agreements],
  invokes: [
    procedure_organizations_require_org_participant,
    procedure_accounts_read_workspace_setup_signer_in_tx,
    procedure_parties_party_by_handle,
    procedure_organizations_read_organizations_at_safe_in_tx,
    procedure_organizations_read_organization_name_in_tx,
    procedure_parties_party_by_safe_address,
  ],
};

/** payroll.agreements.settle: the holders' sent writes by their receipts, and the lapsed ones (records.ts:222). */
const SETTLE: Touch = {
  reads: [table_payroll_agreements],
  writes: [table_payroll_agreements],
  drives: [
    machine_payroll_agreement.t.to_onChain,
    machine_payroll_agreement.t.to_abandoned,
    machine_payroll_agreement_write.t.to_landed,
    machine_payroll_agreement_write.t.to_failed,
    machine_payroll_agreement_write.t.to_abandoned,
  ],
  emits: [event_payroll_agreement_transitioned],
};

/** Each sent write's receipt, by its operation hash (readWriteOutcomes, external.ts:198). */
const RECEIPTS: Touch = {
  calls: [integration_chain_rpc.c.fetchUserOperationReceipt, integration_chain_rpc.c.fetchBlockTimestamp],
  spans: ["chain.read eth_getUserOperationReceipt", "chain.read eth_getBlockByNumber"],
};

/**
 * The chain's answer now: each agreement (`agreementOf`, `earnedOf`, `availableOf` on PayrollDepartments,
 * or on v4 Agreements), the latest block's time, and each department's budget (PayrollDepartments
 * `configs` and `budgetOf`, the payout ceilings in Roles; on v4 Budgets `budgetOf` and `leftOf`).
 */
const CHAIN_NOW: Touch = {
  calls: [integration_chain_rpc.c.fetchEthCall, integration_chain_rpc.c.fetchLatestBlock],
  chain: [
    contract_payroll_departments.f.agreementOf,
    contract_payroll_departments.f.earnedOf,
    contract_payroll_departments.f.availableOf,
    contract_payroll_departments.f.configs,
    contract_payroll_departments.f.budgetOf,
    contract_roles.f.allowances,
    contract_agreements.f.agreementOf,
    contract_agreements.f.earnedOf,
    contract_agreements.f.availableOf,
    contract_budgets.f.budgetOf,
    contract_budgets.f.leftOf,
  ],
  spans: ["chain.read eth_call", "chain.read eth_getBlockByNumber"],
};
const CHAIN_WAS = [
  `${AG}/external.ts:46`,
  `${AG}/external.ts:115`,
  `${AG}/external.ts:198`,
  `${AG}/external/v4.ts:41`,
  `${AG}/external/v4.ts:61`,
  `${AG}/reads/context.ts:180`,
  `${AG}/reads/context.ts:219`,
  `${SRC}/departments/external.ts:154`,
];

/**
 * Organizations' Safe read inside settleOrganizationProposals and requireSafeOwner (readSafeState,
 * organizations/proposals/external.ts:71): block number, owners, threshold, nonce, approvedHashes.
 */
const ORG_SAFE: Touch = {
  calls: [
    integration_chain_rpc.c.fetchLatestBlockNumber,
    integration_chain_rpc.c.fetchSafeOwners,
    integration_chain_rpc.c.fetchEthCall,
  ],
  chain: [contract_safe.f.getOwners, contract_safe.f.getThreshold, contract_safe.f.nonce, contract_safe.f.approvedHashes],
  spans: ["chain.read eth_blockNumber", "chain.read eth_call"],
};

/** settledContext (writes/actions.ts:106): departments settled, the context loaded, sent writes settled, loaded again. */
const SETTLED_CONTEXT = all(ORG_SAFE, DEPARTMENTS_SETTLE, LOAD, SETTLE, RECEIPTS, CHAIN_NOW);
const SETTLED_CONTEXT_WAS = [
  `${ORG_GUARDS}:154`,
  `${SRC}/departments/writes.ts:275`,
  `${AG}/writes/actions.ts:58`,
  `${AG}/writes/actions.ts:106`,
  `${AG}/reads/context.ts:106`,
  `${AG}/reads/context.ts:158`,
  `${AG}/writes/records.ts:222`,
  `${AG}/writes/records.ts:270`,
  ...CHAIN_WAS,
];

/** The sponsored operation a personal Safe signs (buildHolderOperation, external.ts:148, through payments' buildSponsoredSafeUserOp). */
const BUILD: Touch = {
  calls: [
    integration_chain_rpc.c.fetchEntryPointNonce,
    integration_chain_rpc.c.fetchUserOperationFees,
    integration_chain_rpc.c.sponsorUserOperation,
  ],
  chain: [contract_entry_point.f.getNonce],
  spans: ["chain.read eth_call"],
};

/** payroll.agreements.record: an offer's record, or the next write on an agreement (records.ts:40). */
const RECORD: Touch = {
  reads: [table_payroll_agreements, table_payroll_departments],
  writes: [table_payroll_agreements, table_payroll_departments],
  drives: [machine_payroll_agreement.t.to_prepared, machine_payroll_agreement_write.t.to_awaiting_approval],
};

/** A holder's write: gate, settled context, then prepareWrite (writes/actions.ts:203): build, open the approval, record. */
const HOLDER_WRITE = all(GATE, SETTLED_CONTEXT, BUILD, RECORD);
const HOLDER_WRITE_WAS = [
  ...SETTLED_CONTEXT_WAS,
  `${AG}/guards.ts:82`,
  `${AG}/rules.ts:149`,
  `${AG}/writes/actions.ts:203`,
  `${AG}/writes/records.ts:40`,
  `${AG}/external.ts:148`,
  OPEN_APPROVAL,
];
const HOLDER_WRITE_ABOUT =
  "Signed in (`signedInAction`); the `payment-agreements` gate; settledContext: organizations settles the Organization's " +
  "proposals, payroll.departments.settle, payroll.agreements.load, then payroll.agreements.settle when a sent write has a " +
  "receipt (eth_getUserOperationReceipt, then its block's time) or an approval lapsed. " +
  "requireAgreementWrite: the record, its department, the caller as a holder (or on v4 any Safe Budgets lets act on its " +
  "budget), the agreement on chain now, and no write already sent (WRONG_STATE write_sent).";
const PREPARE_ABOUT =
  "prepareWrite builds one sponsored UserOperation from the caller's personal Safe (the call through the department's " +
  "role, or on v4 the call itself; nonce key from the agreement id), runs accounts' internal mutation " +
  "accounts.approvals.openForAgreement for the approval that signs it, then payroll.agreements.record with the holder " +
  "and the call's linkage. The write lapses with its sponsorship. Nothing is on chain yet.";

const WHO_HOLDER =
  "A signed-in participant who holds the department (their personal Safe is a holder; on v4, a Safe Budgets lets act on " +
  "the budget), with the `payment-agreements` gate on; a removed holder is refused like anyone (ROLE_PERMISSION_DENIED).";

/** payroll.agreements.load-payee (reads/payee.ts:108). */
const PAYEE_LOAD: Touch = {
  reads: [table_payroll_agreements, table_payroll_agreement_payee_writes, table_payroll_departments],
  invokes: [
    procedure_accounts_read_workspace_setup_signer_in_tx,
    procedure_payments_read_collection_payment_in_tx,
    procedure_organizations_read_organization_name_in_tx,
    procedure_organizations_read_activity_safe_address_in_tx,
    procedure_parties_party_by_safe_address,
  ],
};

/** payroll.agreements.settle-payee (writes/payees.ts:231): a landed collect births its Payment. */
const PAYEE_SETTLE: Touch = {
  reads: [table_payroll_agreement_payee_writes, table_payroll_agreements],
  writes: [table_payroll_agreement_payee_writes],
  drives: [
    machine_payroll_agreement_payee_write.t.to_landed,
    machine_payroll_agreement_payee_write.t.to_failed,
    machine_payroll_agreement_payee_write.t.to_abandoned,
  ],
  invokes: [procedure_accounts_account_id_for_auth_user_or_null, procedure_payments_birth_collection_payment_in_tx],
  emits: [event_payroll_agreement_transitioned],
};

/** settledPayeeContext (writes/payee-actions.ts:41): load, the holders' sent writes per Organization, the payee's own. */
const SETTLED_PAYEE = all(PAYEE_LOAD, SETTLE, PAYEE_SETTLE, RECEIPTS, CHAIN_NOW);
const SETTLED_PAYEE_WAS = [
  `${AG}/writes/payee-actions.ts:41`,
  `${AG}/writes/payee-settled.ts:28`,
  `${AG}/writes/payee-settled.ts:47`,
  `${AG}/writes/payee-settled.ts:92`,
  `${AG}/reads/payee.ts:65`,
  `${AG}/reads/payee.ts:108`,
  `${AG}/writes/payees.ts:167`,
  `${AG}/writes/payees.ts:231`,
  ...CHAIN_WAS,
];
const SETTLED_PAYEE_ABOUT =
  "settledPayeeContext: payroll.agreements.load-payee (the caller's personal Safe and the agreements that pay it, or the " +
  "one agreement named, whoever it pays), payroll.agreements.settle for each Organization whose holder write is sent (a " +
  "landed offer reads at once), then payroll.agreements.settle-payee for the payee's own sent and lapsed writes (a " +
  "landed collect births its collection Payment), loaded again when anything changed, and the chain's answer now.";

/** payroll.agreements.record-payee-write (writes/payees.ts:40). */
const PAYEE_RECORD: Touch = {
  reads: [table_payroll_agreements, table_payroll_agreement_payee_writes],
  writes: [table_payroll_agreement_payee_writes],
  drives: [machine_payroll_agreement_payee_write.t.to_awaiting_approval, machine_payroll_agreement_payee_write.t.to_abandoned],
};

/** What the payer can pay now (readPayerFunds, external.ts:243): the Safe's balance and the payout ceiling left. */
const PAYER_FUNDS: Touch = {
  calls: [integration_chain_rpc.c.fetchErc20Balance, integration_chain_rpc.c.fetchEthCall, integration_chain_rpc.c.fetchLatestBlock],
  chain: [contract_erc20.f.balanceOf, contract_payroll_departments.f.configs, contract_roles.f.allowances, contract_budgets.f.configs],
  spans: ["chain.read eth_call", "chain.read eth_getBlockByNumber"],
};

/** payroll.agreements.load-organization-payee (reads/organization-payee.ts:41). */
const ORG_PAYEE_LOAD: Touch = {
  reads: [table_payroll_agreements, table_payroll_agreement_payee_writes, table_payroll_departments],
  invokes: [
    procedure_organizations_require_org_participant,
    procedure_organizations_read_activity_safe_address_in_tx,
    procedure_organizations_read_organization_name_in_tx,
    procedure_payments_read_collection_payment_in_tx,
    procedure_parties_party_by_safe_address,
  ],
};

/** payroll.agreements.follow-organization-payee (writes/organization-payees.ts:62). */
const FOLLOW: Touch = {
  reads: [table_payroll_agreement_payee_writes],
  writes: [table_payroll_agreement_payee_writes],
  drives: [machine_payroll_agreement_payee_write.t.to_sent, machine_payroll_agreement_payee_write.t.to_abandoned],
  invokes: [procedure_organizations_read_subject_proposal_in_tx],
};

/** settledOrganizationPayeeContext (writes/organization-payee-actions.ts:65). */
const SETTLED_ORG_PAYEE = all(ORG_SAFE, ORG_PAYEE_LOAD, FOLLOW, SETTLE, PAYEE_SETTLE, RECEIPTS, CHAIN_NOW);
const SETTLED_ORG_PAYEE_WAS = [
  `${ORG_GUARDS}:154`,
  `${AG}/writes/organization-payee-actions.ts:65`,
  `${AG}/writes/organization-payees.ts:62`,
  `${AG}/reads/organization-payee.ts:41`,
  `${AG}/writes/payee-settled.ts:92`,
  ...CHAIN_WAS,
];
const SETTLED_ORG_PAYEE_ABOUT =
  "settledOrganizationPayeeContext: organizations settles the payee Organization's proposals from the chain; " +
  "payroll.agreements.load-organization-payee (a participant of the payee Organization, its Safe, the agreements that " +
  "pay it); payroll.agreements.follow-organization-payee moves each waiting write by its proposal (executed: sent with " +
  "the execution's hash; rejected or replaced: abandoned); the holders' and its own sent writes settle as a person " +
  "payee's do; and the chain's answer now.";

/** payroll.agreements.record-organization-payee-write (writes/organization-payees.ts:31). */
const ORG_PAYEE_RECORD: Touch = {
  reads: [table_payroll_agreements, table_payroll_agreement_payee_writes],
  writes: [table_payroll_agreement_payee_writes],
  drives: [machine_payroll_agreement_payee_write.t.to_awaiting_approval, machine_payroll_agreement_payee_write.t.to_abandoned],
  invokes: [procedure_organizations_record_owner_proposal_in_tx],
};

/** Sending a signed write (external/sends.ts:82): the bundler must acknowledge exactly its hash. */
const SEND: Touch = {
  calls: [integration_chain_rpc.c.sendUserOperation, integration_chain_rpc.c.hasUserOperationByHash],
  spans: ["chain.read eth_getUserOperationByHash"],
};

/** What an agreement's notices are read from (readAgreementNoticeFactsInTx, reads/notices.ts:35). */
const NOTICE_FACTS: Touch = {
  reads: [table_payroll_agreements, table_payroll_departments],
  invokes: [
    procedure_organizations_read_organization_name_in_tx,
    procedure_organizations_read_owner_safes_in_tx,
    procedure_parties_party_by_safe_address,
  ],
};

/** payroll.agreements.claim-notices (writes/sweeps.ts:22). */
const CLAIM: Touch = { reads: [table_payroll_agreement_notices], writes: [table_payroll_agreement_notices] };

// ── a holder's writes ──────────────────────────────────────────────────────────────────────

export const rpc_payroll_agreements_offer = defineRpc({
  id: "payroll.agreements.offer",
  title: "A holder offers a payee an agreement from a department's budget",
  about:
    "Row `payroll.agreements.offer`, registered as the public action `payroll/agreements:offer`. The payee must be an email " +
    "or an Organization's `@handle` (Payee A: a claimed Organization, never the payer itself), else INVALID_INPUT. " +
    "Signed in; the `payment-agreements` gate; settledContext with the payee resolved (a person at the personal Safe their " +
    "email names). The department must be active (INVALID_INPUT unknown, WRONG_STATE otherwise). Before v4: the caller " +
    "must hold it, the payout role must exist (WRONG_STATE), the token is the one named or the department's only one " +
    "(TOKEN_NOT_SUPPORTED, TOKEN_REQUIRED, TOKEN_NOT_BUDGETED), terms are checked at chain time, and the reservation must " +
    "fit `budgetOf`'s room (PAYROLL_BUDGET_EXCEEDED). On v4 (CAP-1122): the department's top budget (kept, or found by its " +
    "office hat), Budgets' authority for the caller's Safe, an open budget and ancestors, the budget's own token, fewer " +
    "than 64 open agreements and the contract's own reservation within what is left, after settling what is due. " +
    PREPARE_ABOUT +
    " The new record (`ag_<ULID>`, lifecycle prepared) carries the terms document and hash.",
  was: [
    `${CONVEX}:24`,
    `${OPS}/offer.ts:61`,
    `${OPS}/offer.ts:195`,
    `${OPS}/offer.ts:201`,
    `${AG}/reads/context.ts:70`,
    `${AG}/reads/context.ts:81`,
    `${AG}/guards.ts:36`,
    `${AG}/guards.ts:52`,
    `${AG}/rules.ts:191`,
    `${AG}/rules.ts:309`,
    `${AG}/rules/offers.ts:26`,
    `${AG}/external/v4-offers.ts:41`,
    `${AG}/external/v4-offers.ts:83`,
    `${AG}/external/v4-offers.ts:106`,
    `${AG}/external/v4-offers.ts:130`,
    `${ROWS}:134`,
    ...HOLDER_WRITE_WAS,
  ],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: Schema.Struct({
    orgId: S,
    department: S,
    payee: S,
    kind: opt(S),
    rate: Schema.Struct({ amount: S, per: S, token: opt(S) }),
    start: opt(S),
    end: opt(S),
    earlyAccess: opt(Schema.Literals(["daily"])),
    release: opt(S),
    expires: opt(S),
  }),
  output: AgreementWrite,
  errors: AGREEMENT_OFFER,
  ...all(HOLDER_WRITE, {
    chain: [
      contract_agreements.f.openOf,
      contract_agreements.f.reservation,
      contract_budgets.f.authorised,
      contract_budgets.f.budgetCount,
      contract_budgets.f.pathOf,
    ],
  }),
});

export const rpc_payroll_agreements_withdraw = defineRpc({
  id: "payroll.agreements.withdraw",
  title: "A holder withdraws an offer not yet accepted",
  about:
    "Row `payroll.agreements.withdraw`, registered as the public action `payroll/agreements:withdraw`. " +
    HOLDER_WRITE_ABOUT +
    " The agreement must be an offer not accepted (requireWritable, WRONG_STATE). " +
    PREPARE_ABOUT +
    " Once it lands its reservation frees at once; a withdrawn offer sends the payee no notice.",
  was: [`${CONVEX}:44`, `${OPS}/withdraw.ts:15`, `${ROWS}:141`, ...HOLDER_WRITE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: AgreementRequest,
  output: AgreementWrite,
  errors: AGREEMENT_WRITE,
  ...HOLDER_WRITE,
});

export const rpc_payroll_agreements_change = defineRpc({
  id: "payroll.agreements.change",
  title: "A holder raises or lowers an agreement's rate",
  about:
    "Row `payroll.agreements.change`, registered as the public action `payroll/agreements:change`. " +
    HOLDER_WRITE_ABOUT +
    " An agreement with an end keeps its rate (WRONG_STATE, the contract's AlreadyEnded). A raise takes effect now (a " +
    "`from` is INVALID_INPUT) and must fit the room: the yearly difference before v4; on v4 the difference of the two " +
    "rates' reservations in the budget's period (Agreements `reservation`), after settling what is due (`openOf`). A " +
    "lowering takes effect `from` a time, else the next UTC day; one in the past is INVALID_INPUT. " +
    PREPARE_ABOUT,
  was: [`${CONVEX}:8`, `${OPS}/change.ts:24`, `${OPS}/change.ts:49`, `${OPS}/change.ts:70`, `${AG}/rules.ts:211`, `${ROWS}:148`, ...HOLDER_WRITE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: Schema.Struct({ orgId: S, agreementId: S, rate: Schema.Struct({ amount: S, per: S }), from: opt(S) }),
  output: AgreementWrite,
  errors: AGREEMENT_COMMIT,
  ...all(HOLDER_WRITE, { chain: [contract_agreements.f.openOf, contract_agreements.f.reservation] }),
});

export const rpc_payroll_agreements_cancel_change = defineRpc({
  id: "payroll.agreements.cancel-change",
  title: "A holder cancels a lowering that waits for its date",
  about:
    "Row `payroll.agreements.cancelChange`, registered as the public action `payroll/agreements:cancelChange`. " +
    HOLDER_WRITE_ABOUT +
    " Only a lowering whose date has not come can be cancelled (WRONG_STATE, the contract's NoPendingChange); the rate and " +
    "the reservation stay. " +
    PREPARE_ABOUT +
    " A landed cancel sends no notice: the old Book has no email for it.",
  was: [`${CONVEX}:7`, `${OPS}/cancel-change.ts:20`, `${ROWS}:155`, ...HOLDER_WRITE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: AgreementRequest,
  output: AgreementWrite,
  errors: AGREEMENT_WRITE,
  ...HOLDER_WRITE,
});

export const rpc_payroll_agreements_pause = defineRpc({
  id: "payroll.agreements.pause",
  title: "A holder pauses a running agreement",
  about:
    "Row `payroll.agreements.pause`, registered as the public action `payroll/agreements:pause`. The gate first, then " +
    "toggle(pause): " +
    HOLDER_WRITE_ABOUT +
    " A running agreement only (WRONG_STATE). " +
    PREPARE_ABOUT +
    " Nothing accrues while paused; earned pay stays collectable; the reservation stays. A landed pause keeps its block " +
    "time as pausedAt.",
  was: [`${CONVEX}:29`, `${OPS}/pause.ts:15`, `${OPS}/pause.ts:56`, `${ROWS}:162`, ...HOLDER_WRITE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: AgreementRequest,
  output: AgreementWrite,
  errors: AGREEMENT_WRITE,
  ...HOLDER_WRITE,
});

export const rpc_payroll_agreements_resume = defineRpc({
  id: "payroll.agreements.resume",
  title: "A holder resumes a paused agreement",
  about:
    "Row `payroll.agreements.resume`, registered as the public action `payroll/agreements:resume`. The gate first, then " +
    "toggle(resume), as pause: " +
    HOLDER_WRITE_ABOUT +
    " A paused agreement only (WRONG_STATE). " +
    PREPARE_ABOUT +
    " Pay accrues again from the landing; pausedAt is cleared.",
  was: [`${CONVEX}:36`, `${OPS}/resume.ts:10`, `${OPS}/pause.ts:15`, `${ROWS}:169`, ...HOLDER_WRITE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: AgreementRequest,
  output: AgreementWrite,
  errors: AGREEMENT_WRITE,
  ...HOLDER_WRITE,
});

export const rpc_payroll_agreements_end = defineRpc({
  id: "payroll.agreements.end",
  title: "A holder ends an agreement after its last day",
  about:
    "Row `payroll.agreements.end`, registered as the public action `payroll/agreements:end`. " +
    HOLDER_WRITE_ABOUT +
    " `on` is the last day, inclusive: pay stops at 00:00 UTC the next day (INVALID_INPUT unreadable or past); an end " +
    "already set, by an earlier end or a fixed term, can only move earlier (WRONG_STATE). " +
    PREPARE_ABOUT +
    " Once it lands the whole reservation frees then, and endSet is kept.",
  was: [`${CONVEX}:14`, `${OPS}/end.ts:21`, `${AG}/errors.ts:152`, `${ROWS}:176`, ...HOLDER_WRITE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: WHO_HOLDER,
  input: Schema.Struct({ orgId: S, agreementId: S, on: S }),
  output: AgreementWrite,
  errors: AGREEMENT_WRITE,
  ...HOLDER_WRITE,
});

// ── a holder Organization's reads ──────────────────────────────────────────────────────────

export const rpc_payroll_agreements_get = defineRpc({
  id: "payroll.agreements.get",
  title: "Read one agreement and its department as the chain answers now",
  about:
    "Row `payroll.agreements.get`, registered as the public action `payroll/agreements:get`. Signed in; settledContext " +
    "(proposals, department changes, load, sent writes settled). An agreement or department not in the Organization is " +
    "INVALID_INPUT. The agreement as the contract answers now (`agreementOf`, `earnedOf`, `availableOf`) and its " +
    "department's budget in the agreement's token.",
  was: [`${CONVEX}:16`, `${OPS}/get.ts:13`, `${ROWS}:183`, ...SETTLED_CONTEXT_WAS],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in current participant of the paying Organization.",
  input: AgreementRequest,
  output: Schema.Struct({ agreement: Schema.Unknown, department: Schema.Unknown }),
  errors: AGREEMENT_READ,
  ...SETTLED_CONTEXT,
});

export const rpc_payroll_agreements_list = defineRpc({
  id: "payroll.agreements.list",
  title: "List an Organization's agreements by department",
  about:
    "Row `payroll.agreements.list`, registered as the public action `payroll/agreements:list`. Signed in; settledContext. " +
    "An unknown department key is INVALID_INPUT. The agreements oldest first, as the chain answers now; withdrawn, lapsed, " +
    "abandoned and unsigned ones only when a status asks for them; and one line per department and token it budgets in.",
  was: [`${CONVEX}:17`, `${OPS}/list.ts:20`, `${AG}/rules.ts:88`, `${ROWS}:190`, ...SETTLED_CONTEXT_WAS],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in current participant of the paying Organization.",
  input: Schema.Struct({ orgId: S, department: opt(S), status: opt(Status) }),
  output: Schema.Struct({ items: Schema.Array(Schema.Unknown), departments: Schema.Array(Schema.Unknown) }),
  errors: AGREEMENT_READ,
  ...SETTLED_CONTEXT,
});

// ── a person payee ─────────────────────────────────────────────────────────────────────────

export const rpc_payroll_agreements_mine = defineRpc({
  id: "payroll.agreements.mine",
  title: "List the agreements that pay the caller, from every Organization",
  about:
    "Row `payroll.agreements.mine`, registered as the public action `payroll/agreements:mine`. Signed in; " +
    SETTLED_PAYEE_ABOUT +
    " A caller with no personal Safe is paid by no agreement. Newest first; lapsed and withdrawn offers only when a status " +
    "asks for them. Prepared and abandoned offers never reached the chain, so the payee reads none of them.",
  was: [`${CONVEX}:21`, `${OPS}/mine.ts:17`, `${ROWS}:197`, ...SETTLED_PAYEE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in person; they read only the agreements that pay their own personal Safe.",
  input: Schema.Struct({ status: opt(Status) }),
  output: Schema.Struct({ items: Schema.Array(PayeeAgreement) }),
  errors: PAYEE_LIST,
  ...SETTLED_PAYEE,
});

export const rpc_payroll_agreements_show = defineRpc({
  id: "payroll.agreements.show",
  title: "Read one agreement as its payee reads it",
  about:
    "Row `payroll.agreements.show`, registered as the public action `payroll/agreements:show`. Signed in; " +
    SETTLED_PAYEE_ABOUT +
    " requirePayee: an unknown agreement is INVALID_INPUT; no personal Safe is SMART_ACCOUNT_MISSING; an agreement that " +
    "pays someone else is ROLE_PERMISSION_DENIED naming whom (the contract's NotThePayee). The terms, the money and the " +
    "next release.",
  was: [`${CONVEX}:41`, `${OPS}/show.ts:13`, `${AG}/guards.ts:204`, `${AG}/errors.ts:166`, `${ROWS}:204`, ...SETTLED_PAYEE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in person the agreement pays at their personal Safe.",
  input: PayeeRequest,
  output: PayeeAgreement,
  errors: PAYEE_READ,
  ...SETTLED_PAYEE,
});

const PAYEE_PREPARE_ABOUT =
  "preparePayeeWrite builds one sponsored UserOperation from the payee's personal Safe straight to the contract (no " +
  "Roles, no Organization signature), runs accounts.approvals.openForAgreement, then payroll.agreements.record-payee-write " +
  "(a waiting write of the payee's is abandoned; one sent refuses). Returns at the approval; nothing is on chain yet.";

export const rpc_payroll_agreements_accept = defineRpc({
  id: "payroll.agreements.accept",
  title: "A payee accepts an offer by signing its exact terms hash",
  about:
    "Row `payroll.agreements.accept`, registered as the public action `payroll/agreements:accept`. Signed in, no gate; " +
    SETTLED_PAYEE_ABOUT +
    " requirePayee; no payee write already sent (WRONG_STATE). The offer must be open on chain (WRONG_STATE, a lapsed " +
    "one naming its expiry); a pinned termsHash that is not the offer's is INVALID_INPUT. The call is the contract's " +
    "`accept` (v4 Agreements.accept, CAP-1118). " +
    PAYEE_PREPARE_ABOUT,
  was: [
    `${CONVEX}:6`,
    `${OPS}/accept.ts:23`,
    `${AG}/guards.ts:221`,
    `${AG}/external/payee-calls.ts:22`,
    `${AG}/writes/payee-actions.ts:108`,
    `${AG}/writes/payees.ts:40`,
    `${AG}/errors.ts:180`,
    OPEN_APPROVAL,
    `${ROWS}:215`,
    ...SETTLED_PAYEE_WAS,
  ],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in person the offer pays at their personal Safe; no gate.",
  input: Schema.Struct({ agreementId: S, termsHash: opt(S) }),
  output: PayeeWritePrepared,
  errors: PAYEE_WRITE,
  ...all(SETTLED_PAYEE, BUILD, PAYEE_RECORD),
});

const RELEASED_ABOUT =
  "releasedPay: the agreement must be active, paused, ending or ended (WRONG_STATE). Nothing available returns " +
  "`nothing_released` with the next release, signing nothing. Otherwise it reads the payer's funds (the Safe's balance " +
  "and the token's payout ceiling left, Roles' refill applied) and splits pay above what the ceiling ever holds into a " +
  "remainder owed. A Safe short is PAYER_BALANCE_TOO_LOW and a ceiling short is ROLE_PERMISSION_DENIED budget_exhausted: " +
  "both schedule the `collection_refused` notice from the action (payroll.agreements.notify) and sign nothing. The " +
  "payslip is shown when the payer's `payslip-preview` gate is on (featureOnFromAction).";

export const rpc_payroll_agreements_collect = defineRpc({
  id: "payroll.agreements.collect",
  title: "A payee collects everything released",
  about:
    "Row `payroll.agreements.collect`, registered as the public action `payroll/agreements:collect`. Signed in, no gate; " +
    SETTLED_PAYEE_ABOUT +
    " requirePayee; no payee write already sent. " +
    RELEASED_ABOUT +
    " The call is the contract's `collect` of exactly the amount, which pays it through the payer's payout role as one " +
    "stamped Payments V3 payment. " +
    PAYEE_PREPARE_ABOUT,
  was: [
    `${CONVEX}:12`,
    `${OPS}/collect.ts:40`,
    `${OPS}/collect.ts:82`,
    `${OPS}/collect.ts:129`,
    `${OPS}/preview-collect.ts:17`,
    `${AG}/rules.ts:288`,
    `${AG}/external.ts:243`,
    `${AG}/external/payee-calls.ts:34`,
    `${AG}/writes/payee-actions.ts:108`,
    `${AG}/writes/notices.ts:43`,
    OPEN_APPROVAL,
    `${ROWS}:226`,
    ...SETTLED_PAYEE_WAS,
  ],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in person the agreement pays at their personal Safe; no gate.",
  input: PayeeRequest,
  output: Schema.Union([PayeeWritePrepared, NothingReleased]),
  errors: [...PAYEE_WRITE, error_PAYER_BALANCE_TOO_LOW],
  ...all(SETTLED_PAYEE, PAYER_FUNDS, BUILD, PAYEE_RECORD, { invokes: [procedure_access_feature_on_from_action] }),
});

export const rpc_payroll_agreements_preview_collect = defineRpc({
  id: "payroll.agreements.preview-collect",
  title: "The payslip a collection would claim now",
  about:
    "Row `payroll.agreements.previewCollect`, registered as the public action `payroll/agreements:previewCollect`. Signed " +
    "in; " +
    SETTLED_PAYEE_ABOUT +
    " requirePayee; the paying Organization's `payslip-preview` gate must be on (FEATURE_NOT_AVAILABLE); the agreement must " +
    "be accepted (WRONG_STATE). The release window since the last collection, the rate and the gross a collection would " +
    "take now under the payout ceiling, as collect does. Nothing is signed or stored, and no refusal notice is sent.",
  was: [`${CONVEX}:30`, `${OPS}/preview-collect.ts:29`, `${AG}/rules.ts:288`, `${AG}/external.ts:243`, `${ROWS}:233`, ...SETTLED_PAYEE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in person the agreement pays, while the paying Organization's `payslip-preview` gate is on.",
  input: PayeeRequest,
  output: Schema.Struct({
    agreementId: S,
    payer: Schema.Unknown,
    payee: Schema.Struct({ label: Schema.NullOr(S), address: S }),
    periodStart: S,
    periodEnd: S,
    rate: Schema.Struct({ amount: S, per: Schema.Literals(["year", "month", "week"]) }),
    gross: S,
    token: S,
    terms: Schema.Struct({ documentId: S, hash: S }),
  }),
  errors: [...PAYEE_READ, error_WRONG_STATE, error_FEATURE_NOT_AVAILABLE],
  ...all(SETTLED_PAYEE, PAYER_FUNDS, { invokes: [procedure_access_require_feature_from_action] }),
});

// ── an Organization payee (Payee A, slice 10) ──────────────────────────────────────────────

export const rpc_payroll_agreements_organization_received = defineRpc({
  id: "payroll.agreements.organization-received",
  title: "List the agreements that pay an Organization's Safe",
  about:
    "Row `payroll.agreements.organizationReceived`, registered as the public action " +
    "`payroll/agreements:organizationReceived`. Signed in; " +
    SETTLED_ORG_PAYEE_ABOUT +
    " Every agreement that pays the Organization's Safe, from every payer, newest first; lapsed and withdrawn offers only " +
    "when a status asks for them.",
  was: [`${CONVEX}:27`, `${OPS}/organization-received.ts:16`, `${ROWS}:243`, ...SETTLED_ORG_PAYEE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in current participant of the payee Organization.",
  input: Schema.Struct({ orgId: S, status: opt(Status) }),
  output: Schema.Struct({ items: Schema.Array(PayeeAgreement) }),
  errors: [...PAYEE_LIST, error_ROLE_PERMISSION_DENIED],
  ...SETTLED_ORG_PAYEE,
});

export const rpc_payroll_agreements_organization_show = defineRpc({
  id: "payroll.agreements.organization-show",
  title: "Read one agreement that pays an Organization",
  about:
    "Row `payroll.agreements.organizationShow`, registered as the public action `payroll/agreements:organizationShow`. " +
    "Signed in; " +
    SETTLED_ORG_PAYEE_ABOUT +
    " requireOrganizationPayee: unknown is INVALID_INPUT; one that pays another Safe is ROLE_PERMISSION_DENIED naming whom.",
  was: [`${CONVEX}:28`, `${OPS}/organization-show.ts:14`, `${AG}/writes/organization-payee-actions.ts:92`, `${ROWS}:250`, ...SETTLED_ORG_PAYEE_WAS],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in current participant of the payee Organization.",
  input: OrganizationPayeeRequest,
  output: PayeeAgreement,
  errors: ORG_PAYEE_READ,
  ...SETTLED_ORG_PAYEE,
});

const ORG_PROPOSE_ABOUT =
  "proposeOrganizationPayeeWrite: organizations' requireSafeOwner (the caller is a Director of the payee Safe, else " +
  "ROLE_PERMISSION_DENIED not_an_owner), then payroll.agreements.record-organization-payee-write saves the Director " +
  "proposal at the Safe's next free nonce (one call from the Organization's Safe straight to the contract, so the " +
  "contract's msg.sender == payee holds) with the payee write it carries (its approvalId is the proposal; it never " +
  "lapses). Returns at the proposal.";

export const rpc_payroll_agreements_organization_accept = defineRpc({
  id: "payroll.agreements.organization-accept",
  title: "A Director proposes that the Organization's Safe accept an offer",
  about:
    "Row `payroll.agreements.organizationAccept`, registered as the public action `payroll/agreements:organizationAccept`. " +
    "Signed in; " +
    SETTLED_ORG_PAYEE_ABOUT +
    " requireOrganizationPayee, and an earlier accept or collect waiting on its proposal is WRONG_STATE. The offer must " +
    "be open (WRONG_STATE); a pinned termsHash that is not the offer's is INVALID_INPUT. The call is `accept` (v4 " +
    "Agreements.accept). " +
    ORG_PROPOSE_ABOUT,
  was: [
    `${CONVEX}:25`,
    `${OPS}/organization-accept.ts:25`,
    `${AG}/writes/organization-payee-actions.ts:92`,
    `${AG}/writes/organization-payee-actions.ts:158`,
    `${AG}/writes/organization-payees.ts:31`,
    `${ORG_GUARDS}:129`,
    `${ROWS}:261`,
    ...SETTLED_ORG_PAYEE_WAS,
  ],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in Director (an owner) of the payee Organization's Safe with a personal Safe; the proposal waits for its threshold.",
  input: Schema.Struct({ orgId: S, agreementId: S, termsHash: opt(S) }),
  output: OrganizationPayeeWriteProposed,
  errors: ORG_PAYEE_WRITE,
  ...all(SETTLED_ORG_PAYEE, ORG_PAYEE_RECORD),
});

export const rpc_payroll_agreements_organization_collect = defineRpc({
  id: "payroll.agreements.organization-collect",
  title: "A Director proposes that the Organization's Safe collect what is released",
  about:
    "Row `payroll.agreements.organizationCollect`, registered as the public action " +
    "`payroll/agreements:organizationCollect`. Signed in; " +
    SETTLED_ORG_PAYEE_ABOUT +
    " requireOrganizationPayee; a write already sent is WRONG_STATE. " +
    RELEASED_ABOUT +
    " The call is `collect` of exactly the amount, paid from the payer's Safe into the Organization's. " +
    ORG_PROPOSE_ABOUT,
  was: [
    `${CONVEX}:26`,
    `${OPS}/organization-collect.ts:24`,
    `${OPS}/collect.ts:82`,
    `${AG}/writes/organization-payee-actions.ts:158`,
    `${AG}/writes/organization-payees.ts:31`,
    `${ROWS}:272`,
    ...SETTLED_ORG_PAYEE_WAS,
  ],
  concept: concept_payroll,
  kind: "action",
  who: "A signed-in Director (an owner) of the payee Organization's Safe with a personal Safe.",
  input: OrganizationPayeeRequest,
  output: Schema.Union([OrganizationPayeeWriteProposed, NothingReleased]),
  errors: [...ORG_PAYEE_WRITE, error_PAYER_BALANCE_TOO_LOW],
  ...all(SETTLED_ORG_PAYEE, PAYER_FUNDS, ORG_PAYEE_RECORD, { invokes: [procedure_access_feature_on_from_action] }),
});

// ── internal: a holder's write ─────────────────────────────────────────────────────────────

export const rpc_payroll_agreements_load = defineRpc({
  id: "payroll.agreements.load",
  title: "Read a holder action's context: caller, departments, agreements, payee",
  about:
    "Registered as the internal query `payroll/agreements:load`. requireOrgParticipant (ROLE_PERMISSION_DENIED); the " +
    "caller's workspace signer and personal Safe on the chain (null without one); the Organization's name; the departments " +
    "and every agreement record, oldest first; and an offer's payee: a person at the personal Safe their email names, or " +
    "an Organization by `@handle` (a person's or unknown handle, or the payer itself, is INVALID_INPUT).",
  was: [`${CONVEX}:18`, `${OPS}/load.ts:13`, `${AG}/reads/context.ts:70`, `${AG}/reads/context.ts:81`, `${AG}/reads/context.ts:106`, `${AG}/reads/rows.ts:15`, `${AG}/errors.ts:45`],
  concept: concept_payroll,
  kind: "query",
  who: "internal: every holder action runs it with ctx.runQuery (loadAgreementContext) for the caller.",
  input: Schema.Struct({ authUserId: S, orgId: S, chainId: N, payee: opt(S) }),
  output: Schema.Struct({
    orgId: S,
    organizationName: S,
    caller: Schema.NullOr(Schema.Struct({ personalSafe: S, signer: S, label: Schema.UndefinedOr(S) })),
    departments: Schema.Array(Schema.Unknown),
    agreements: Schema.Array(AgreementRowShape),
    payee: Schema.NullOr(Schema.Unknown),
  }),
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_UNKNOWN],
  reads: LOAD.reads ?? [],
  writes: [],
  drives: [],
  invokes: LOAD.invokes ?? [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_record = defineRpc({
  id: "payroll.agreements.record",
  title: "Save a holder's write: an offer's record, or the next write",
  about:
    "Registered as the internal mutation `payroll/agreements:record`. An offer inserts its record `prepared` with its " +
    "first write `awaiting_approval`, and keeps a v4 budget id an offer found on its department when it has none. Any " +
    "other write needs this Organization's agreement (INVALID_INPUT), refuses while the last write is sent (WRONG_STATE " +
    "write_sent), and replaces the last write, keeping it in earlierWrites (at most 20; an unsent one as `replaced`, an " +
    "abandoned sent one as `dropped`).",
  was: [`${CONVEX}:31`, `${OPS}/record.ts:22`, `${AG}/writes/records.ts:40`, `${AG}/writes/records.ts:79`, `${AG}/writes/records.ts:83`, `${AG}/errors.ts:132`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: prepareWrite runs it with ctx.runMutation after the approval opened.",
  input: Schema.Struct({
    method: S,
    orgId: S,
    agreementId: S,
    offer: opt(AgreementRowShape),
    departmentBudgetId: opt(S),
    write: Schema.Struct({
      writeId: S,
      action: Schema.Literals(["offer", "withdraw", "change", "cancelChange", "pause", "resume", "end"]),
      approvalId: S,
      reservedBefore: S,
      expiresAt: N,
      userOpHash: opt(S),
      txHash: opt(S),
      roleCall: Call,
      authUserId: opt(S),
      observationContext: opt(Schema.Unknown),
    }),
  }),
  output: AgreementRowShape,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: RECORD.reads ?? [],
  writes: RECORD.writes ?? [],
  drives: RECORD.drives ?? [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_record_submission = defineRpc({
  id: "payroll.agreements.record-submission",
  title: "Note a holder write's operation hash before it is sent",
  about:
    "Registered as the internal mutation `payroll/agreements:recordSubmission`. The agreement's last write must be this " +
    "writeId (WRONG_STATE staleWrite otherwise); the same hash already sent writes nothing; anything but " +
    "awaiting_approval is WRONG_STATE; else it becomes `sent` with the hash, so a write that lands is always found by its " +
    "receipt.",
  was: [`${CONVEX}:35`, `${OPS}/record-submission.ts:12`, `${AG}/writes/records.ts:100`, `${AG}/errors.ts:135`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: payroll.agreements.send-signed runs it with ctx.runMutation before the send.",
  input: Schema.Struct({ method: S, agreementId: S, writeId: S, userOpHash: S }),
  output: Schema.Null,
  errors: [error_WRONG_STATE, error_UNKNOWN],
  reads: [table_payroll_agreements],
  writes: [table_payroll_agreements],
  drives: [machine_payroll_agreement_write.t.to_sent],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_clear_submission = defineRpc({
  id: "payroll.agreements.clear-submission",
  title: "Hand back a holder write the bundler refused",
  about:
    "Registered as the internal mutation `payroll/agreements:clearSubmission` (CAP-1018). When the last write is still " +
    "this writeId, `sent`, with this hash, its hash is dropped and it waits for its approval again, so a new write can " +
    "replace it at once. Anything else writes nothing. Answers null.",
  was: [`${CONVEX}:11`, `${OPS}/clear-submission.ts:12`, `${AG}/writes/records.ts:128`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: payroll.agreements.send-signed runs it when the bundler definitively refused the operation and does not hold it.",
  input: Schema.Struct({ agreementId: S, writeId: S, userOpHash: S }),
  output: Schema.Null,
  errors: [error_UNKNOWN],
  reads: [table_payroll_agreements],
  writes: [table_payroll_agreements],
  drives: [machine_payroll_agreement_write.t.to_awaiting_approval],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_settle = defineRpc({
  id: "payroll.agreements.settle",
  title: "Settle an Organization's sent agreement writes by their receipts",
  about:
    "Registered as the internal mutation `payroll/agreements:settle`. For each of the Organization's agreements: a sent " +
    "write with a receipt lands only when the receipt carries its own event for this agreement (an offer: `offered`, " +
    "which puts it onChain with its uint256 id; withdraw sets withdrawn, end sets endSet, pause keeps the block time, " +
    "resume clears it), otherwise fails; a pending receipt whose sponsorship and grace lapsed abandons it; an approval " +
    "that lapsed unsent abandons it. A failed or abandoned offer's record is abandoned. Each landing schedules " +
    "payroll_agreement_transitioned (emitTransitioned) and the payee's notice (offered, changed, paused, resumed, ended).",
  was: [`${CONVEX}:39`, `${OPS}/settle.ts:28`, `${OPS}/settle.ts:40`, `${AG}/writes/records.ts:157`, `${AG}/writes/records.ts:222`, `${AG}/writes/records.ts:270`, `${AG}/events.ts:96`, `${AG}/writes/notices.ts:43`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: settleAgreements runs it with ctx.runMutation from any holder, department or payee action that read a receipt or saw a lapse.",
  input: Schema.Struct({ orgId: S, outcomes: Schema.Array(Schema.Struct({ agreementId: S, writeId: S, outcome: WriteOutcome })), now: N }),
  output: Schema.Null,
  errors: [error_UNKNOWN],
  reads: SETTLE.reads ?? [],
  writes: SETTLE.writes ?? [],
  drives: SETTLE.drives ?? [],
  invokes: [],
  emits: SETTLE.emits ?? [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_send_signed = defineRpc({
  id: "payroll.agreements.send-signed",
  title: "Send a holder's signed agreement write from its approval",
  about:
    "Registered as the internal action `payroll/agreements:sendSigned`. accounts' send-approved action runs it with " +
    "ctx.runAction when the holder signed on the approval page. Decodes the stored unsigned operation; re-reads the " +
    "`payment-agreements` gate (off stops the send); settledContext. The write must still be the agreement's waiting or " +
    "sent write (WRONG_STATE staleWrite), the department known (INVALID_INPUT) and the caller still its holder. " +
    "admitHolderOperation: Base Sepolia only, the operation exactly the write's role call from the caller's personal Safe " +
    "with no factory, the signature recovering to the caller's signer (INVALID_INPUT otherwise). The hash is noted " +
    "first (payroll.agreements.record-submission); the bundler must acknowledge exactly that hash; a definitive refusal " +
    "the bundler does not hold hands the write back (payroll.agreements.clear-submission). A send asked again resends it. " +
    "The send admits only PROVIDER_ERROR and ENV_MISSING (sends.ts:27): a PROVIDER_RESPONSE_INVALID, such as the bundler " +
    "acknowledging another hash, dies as UNKNOWN.",
  was: [
    `${CONVEX}:38`,
    `${OPS}/send-signed.ts:49`,
    `${OPS}/send-signed.ts:68`,
    `${OPS}/send-signed.ts:84`,
    `${AG}/external/sends.ts:37`,
    `${AG}/external/sends.ts:82`,
    `${AG}/external/sends.ts:27`,
    `${BACKEND}/src/accounts/approvals/operations/send-approved.ts:115`,
    ...SETTLED_CONTEXT_WAS,
  ],
  concept: concept_payroll,
  kind: "action",
  who: "internal: accounts' send-approved action runs it for the signed-in holder who signed the approval.",
  input: Schema.Struct({ authUserId: S, orgId: S, agreementId: S, writeId: S, unsignedUserOpJson: S, signature: S }),
  output: SignedSend,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_FEATURE_NOT_AVAILABLE, error_PROVIDER_ERROR, error_ENV_MISSING, error_UNKNOWN],
  ...all(GATE, SETTLED_CONTEXT, SEND, {
    reads: [table_payroll_agreements],
    writes: [table_payroll_agreements],
    drives: [machine_payroll_agreement_write.t.to_sent, machine_payroll_agreement_write.t.to_awaiting_approval],
  }),
});

// ── internal: a person payee's write ───────────────────────────────────────────────────────

export const rpc_payroll_agreements_load_payee = defineRpc({
  id: "payroll.agreements.load-payee",
  title: "Read a payee action's context: their Safe and the agreements it reads or writes",
  about:
    "Registered as the internal query `payroll/agreements:loadPayee`. The caller's workspace signer and personal Safe on " +
    "Base Sepolia; either the one agreement named (whoever it pays, so a refusal can say whom) or every agreement that " +
    "pays their Safe (by_payee). Each entry that reached the chain carries its department, its payee writes with each " +
    "collection's Payment status (payments' readCollectionPaymentInTx), the paying Organization's name and Activity Safe, " +
    "and the payee's label; the holder rows whose write is sent ride along so a payee read settles them.",
  was: [`${CONVEX}:20`, `${OPS}/load-payee.ts:13`, `${AG}/reads/payee.ts:65`, `${AG}/reads/payee.ts:108`, `${AG}/reads/rows.ts:36`, `${AG}/reads/rows.ts:48`],
  concept: concept_payroll,
  kind: "query",
  who: "internal: every person payee action runs it with ctx.runQuery (loadPayeeContext) for the caller.",
  input: Schema.Struct({ authUserId: S, agreementId: opt(S) }),
  output: Schema.Unknown,
  errors: [error_UNKNOWN],
  reads: PAYEE_LOAD.reads ?? [],
  writes: [],
  drives: [],
  invokes: PAYEE_LOAD.invokes ?? [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_record_payee_write = defineRpc({
  id: "payroll.agreements.record-payee-write",
  title: "Save a payee's prepared accept or collect",
  about:
    "Registered as the internal mutation `payroll/agreements:recordPayeeWrite`. An unknown agreement is INVALID_INPUT; a " +
    "payee write already sent on it is WRONG_STATE; every write of it still awaiting approval is abandoned, so that " +
    "approval can no longer be sent; then the new write is inserted `awaiting_approval`.",
  was: [`${CONVEX}:34`, `${OPS}/record-payee-write.ts:20`, `${AG}/writes/payees.ts:28`, `${AG}/writes/payees.ts:40`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: preparePayeeWrite runs it with ctx.runMutation after the approval opened.",
  input: Schema.Struct({ method: S, write: Schema.Unknown }),
  output: Schema.Unknown,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: PAYEE_RECORD.reads ?? [],
  writes: PAYEE_RECORD.writes ?? [],
  drives: PAYEE_RECORD.drives ?? [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_record_payee_submission = defineRpc({
  id: "payroll.agreements.record-payee-submission",
  title: "Note a payee write's operation hash before it is sent",
  about:
    "Registered as the internal mutation `payroll/agreements:recordPayeeSubmission`. An unknown write is WRONG_STATE; " +
    "the same hash already sent writes nothing; anything but awaiting_approval is WRONG_STATE; else it becomes `sent` " +
    "with the hash.",
  was: [`${CONVEX}:33`, `${OPS}/record-payee-submission.ts:12`, `${AG}/writes/payees.ts:65`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: payroll.agreements.send-payee-signed runs it before the send.",
  input: Schema.Struct({ method: S, writeId: S, userOpHash: S }),
  output: Schema.Null,
  errors: [error_WRONG_STATE, error_UNKNOWN],
  reads: [table_payroll_agreement_payee_writes],
  writes: [table_payroll_agreement_payee_writes],
  drives: [machine_payroll_agreement_payee_write.t.to_sent],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_clear_payee_submission = defineRpc({
  id: "payroll.agreements.clear-payee-submission",
  title: "Hand back a payee write the bundler refused",
  about:
    "Registered as the internal mutation `payroll/agreements:clearPayeeSubmission`. When the write is `sent` with this " +
    "hash it waits for its approval again with no hash. Anything else writes nothing. Answers null.",
  was: [`${CONVEX}:10`, `${OPS}/clear-payee-submission.ts:12`, `${AG}/writes/payees.ts:140`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: payroll.agreements.send-payee-signed runs it when the bundler definitively refused the operation.",
  input: Schema.Struct({ writeId: S, userOpHash: S }),
  output: Schema.Null,
  errors: [error_UNKNOWN],
  reads: [table_payroll_agreement_payee_writes],
  writes: [table_payroll_agreement_payee_writes],
  drives: [machine_payroll_agreement_payee_write.t.to_awaiting_approval],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_settle_payee = defineRpc({
  id: "payroll.agreements.settle-payee",
  title: "Settle a payee's sent writes; a landed collection becomes its Payment",
  about:
    "Registered as the internal mutation `payroll/agreements:settlePayee`. A sent write with a receipt lands only with " +
    "its own `accepted` or `collected` event for this agreement, else fails (a failed collect schedules " +
    "`collection_refused` TRANSACTION_FAILED). A landed collect is recorded in the Payment ledger through payments' " +
    "birthCollectionPaymentInTx (requestKey the writeId, the department id as permissionId, the payee's Account from " +
    "accounts or the payee Organization, the Collected event's settlement id, the terms hash); then the write keeps " +
    "amount, settlementId, paymentId and landedAt, and the accepted or collected notice and payroll_agreement_transitioned " +
    "are scheduled. A person's sent write that lapsed, or approval that lapsed, is abandoned; an Organization payee's never lapses.",
  was: [`${CONVEX}:40`, `${OPS}/settle-payee.ts:16`, `${AG}/writes/payees.ts:98`, `${AG}/writes/payees.ts:167`, `${AG}/writes/payees.ts:231`, `${AG}/events.ts:96`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: settlePayeeWrites runs it with ctx.runMutation from a person's or an Organization's payee action.",
  input: Schema.Struct({ outcomes: Schema.Array(Schema.Struct({ writeId: S, outcome: WriteOutcome })), writeIds: Schema.Array(S), now: N }),
  output: Schema.Null,
  errors: [error_UNKNOWN],
  reads: PAYEE_SETTLE.reads ?? [],
  writes: PAYEE_SETTLE.writes ?? [],
  drives: PAYEE_SETTLE.drives ?? [],
  invokes: PAYEE_SETTLE.invokes ?? [],
  emits: PAYEE_SETTLE.emits ?? [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_send_payee_signed = defineRpc({
  id: "payroll.agreements.send-payee-signed",
  title: "Send a payee's signed accept or collect from its approval",
  about:
    "Registered as the internal action `payroll/agreements:sendPayeeSigned`. accounts' send-approved action runs it with " +
    "ctx.runAction. Decodes the stored operation; payroll.agreements.load-payee; requirePayee; the write must still be " +
    "awaiting approval or sent (WRONG_STATE). admitHolderOperation checks the operation is exactly the write's contract " +
    "call from the payee's personal Safe and signed by their signer; the hash is noted first " +
    "(payroll.agreements.record-payee-submission); a definitive bundler refusal hands it back " +
    "(payroll.agreements.clear-payee-submission). No gate and no settle before the send. The send admits only " +
    "PROVIDER_ERROR and ENV_MISSING (sends.ts:27): a PROVIDER_RESPONSE_INVALID, such as the bundler acknowledging another " +
    "hash, dies as UNKNOWN.",
  was: [
    `${CONVEX}:37`,
    `${OPS}/send-payee-signed.ts:49`,
    `${AG}/external/sends.ts:37`,
    `${AG}/external/sends.ts:82`,
    `${AG}/external/sends.ts:27`,
    `${BACKEND}/src/accounts/approvals/operations/send-approved.ts:106`,
  ],
  concept: concept_payroll,
  kind: "action",
  who: "internal: accounts' send-approved action runs it for the signed-in payee who signed the approval.",
  input: Schema.Struct({ authUserId: S, agreementId: S, writeId: S, unsignedUserOpJson: S, signature: S }),
  output: SignedSend,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_SMART_ACCOUNT_MISSING, error_PROVIDER_ERROR, error_ENV_MISSING, error_UNKNOWN],
  ...all(PAYEE_LOAD, SEND, {
    reads: [table_payroll_agreement_payee_writes],
    writes: [table_payroll_agreement_payee_writes],
    drives: [machine_payroll_agreement_payee_write.t.to_sent, machine_payroll_agreement_payee_write.t.to_awaiting_approval],
  }),
});

// ── internal: an Organization payee's write ────────────────────────────────────────────────

export const rpc_payroll_agreements_load_organization_payee = defineRpc({
  id: "payroll.agreements.load-organization-payee",
  title: "Read an Organization payee's context",
  about:
    "Registered as the internal query `payroll/agreements:loadOrganizationPayee` (Payee A). requireOrgParticipant of the " +
    "payee Organization (ROLE_PERMISSION_DENIED); its Activity Safe (none: INVALID_INPUT); the one agreement named or " +
    "every agreement that pays that Safe, keeping those on chain as payee entries; the rows a holder's write is sent for.",
  was: [`${CONVEX}:19`, `${OPS}/load-organization-payee.ts:13`, `${AG}/reads/organization-payee.ts:41`, `${AG}/reads/payee.ts:65`],
  concept: concept_payroll,
  kind: "query",
  who: "internal: every Organization payee action runs it with ctx.runQuery for the caller.",
  input: Schema.Struct({ authUserId: S, orgId: S, agreementId: opt(S) }),
  output: Schema.Unknown,
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_UNKNOWN],
  reads: ORG_PAYEE_LOAD.reads ?? [],
  writes: [],
  drives: [],
  invokes: ORG_PAYEE_LOAD.invokes ?? [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_record_organization_payee_write = defineRpc({
  id: "payroll.agreements.record-organization-payee-write",
  title: "Save an Organization payee's write with the Director proposal that carries it",
  about:
    "Registered as the internal mutation `payroll/agreements:recordOrganizationPayeeWrite`. In one transaction: the " +
    "Director proposal at the payee Safe's next free nonce through organizations' recordOwnerProposalInTx (subject " +
    "agreement_payee_write), then the payee write as recordPayeeWriteInTx saves it, its approvalId the proposal's id. " +
    "Calls are lower-cased and hex-checked first.",
  was: [`${CONVEX}:32`, `${OPS}/record-organization-payee-write.ts:23`, `${AG}/writes/organization-payees.ts:31`, `${AG}/writes/payees.ts:40`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: proposeOrganizationPayeeWrite runs it with ctx.runMutation for the Director.",
  input: Schema.Struct({
    method: S,
    owner: Schema.Struct({ orgId: S, chainId: N, safeAddress: S, chainNonce: N, threshold: N, proposer: S }),
    calls: Schema.Array(Schema.Struct({ to: S, value: S, data: S })),
    note: S,
    write: Schema.Unknown,
  }),
  output: Schema.Struct({ proposal: Schema.Unknown, write: Schema.Unknown }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: ORG_PAYEE_RECORD.reads ?? [],
  writes: ORG_PAYEE_RECORD.writes ?? [],
  drives: ORG_PAYEE_RECORD.drives ?? [],
  invokes: ORG_PAYEE_RECORD.invokes ?? [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_follow_organization_payee = defineRpc({
  id: "payroll.agreements.follow-organization-payee",
  title: "Move an Organization payee's waiting writes by their proposals",
  about:
    "Registered as the internal mutation `payroll/agreements:followOrganizationPayee`. For each named write of this " +
    "Organization still awaiting approval, its proposal as organizations last stored it: executed with an execution hash " +
    "makes it `sent` with that hash (its receipt settles it); rejected or replaced abandons it. Answers whether anything " +
    "changed.",
  was: [`${CONVEX}:15`, `${OPS}/follow-organization-payee.ts:15`, `${AG}/writes/organization-payees.ts:62`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: settledOrganizationPayeeContext runs it with ctx.runMutation after organizations settled the proposals.",
  input: Schema.Struct({ orgId: S, writeIds: Schema.Array(S) }),
  output: Schema.Boolean,
  errors: [error_UNKNOWN],
  reads: FOLLOW.reads ?? [],
  writes: FOLLOW.writes ?? [],
  drives: FOLLOW.drives ?? [],
  invokes: FOLLOW.invokes ?? [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal: notices ──────────────────────────────────────────────────────────────────────

export const rpc_payroll_agreements_notice_facts = defineRpc({
  id: "payroll.agreements.notice-facts",
  title: "Read what an agreement's emails are built from",
  about:
    "Registered as the internal query `payroll/agreements:noticeFacts`. Null when the agreement or its department is gone. " +
    "The record, the Organization's and department's names, the people Capxul knows at each Safe a notice names (payee, " +
    "offerer and the addresses asked for: each Safe's Party email and display name), and for an Organization payee its " +
    "name, handle and its Directors' mailboxes.",
  was: [`${CONVEX}:22`, `${OPS}/notice-facts.ts:12`, `${AG}/reads/notices.ts:20`, `${AG}/reads/notices.ts:35`, `${AG}/reads/notices.ts:56`, `${AG}/reads/notices.ts:85`],
  concept: concept_payroll,
  kind: "query",
  who: "internal: the payroll.agreements.notify and payroll.agreements.sweep workflows run it with ctx.runQuery.",
  input: Schema.Struct({ agreementId: S, addresses: Schema.Array(S) }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [error_UNKNOWN],
  reads: NOTICE_FACTS.reads ?? [],
  writes: [],
  drives: [],
  invokes: NOTICE_FACTS.invokes ?? [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_sweep_facts = defineRpc({
  id: "payroll.agreements.sweep-facts",
  title: "Read every agreement on chain, by Organization, for the daily sweep",
  about:
    "Registered as the internal query `payroll/agreements:sweepFacts`. Every agreement record (with orgId, that " +
    "Organization's only) that is onChain, not withdrawn and has a chain id, grouped by Organization with its name, chain " +
    "and Safe, each with its payee's mailboxes: the offer's email, else the Party at the payee Safe, or an Organization " +
    "payee's Directors (organizations' owner Safes, then their Parties). Without orgId it reads the whole table.",
  was: [`${CONVEX}:43`, `${OPS}/sweep-facts.ts:12`, `${AG}/reads/notices.ts:85`, `${AG}/reads/notices.ts:108`],
  concept: concept_payroll,
  kind: "query",
  who: "internal: the payroll.agreements.sweep workflow runs it with ctx.runQuery.",
  input: Schema.Struct({ orgId: opt(S) }),
  output: Schema.Array(Schema.Unknown),
  errors: [error_UNKNOWN],
  reads: [table_payroll_agreements],
  writes: [],
  drives: [],
  invokes: [
    procedure_organizations_read_organization_name_in_tx,
    procedure_organizations_read_owner_safes_in_tx,
    procedure_parties_party_by_safe_address,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_claim_notices = defineRpc({
  id: "payroll.agreements.claim-notices",
  title: "Claim agreement notices once, before they are sent",
  about:
    "Registered as the internal mutation `payroll/agreements:claimNotices` (G5). Each distinct key not held yet is " +
    "inserted with sentAt now and answered; one held is left out. Each cleared key's rows are deleted, so its condition " +
    "can alert again. An action with nothing to claim or clear does not call it.",
  was: [`${CONVEX}:9`, `${OPS}/claim-notices.ts:12`, `${AG}/writes/sweeps.ts:22`, `${AG}/writes/sweeps.ts:59`],
  concept: concept_payroll,
  kind: "mutation",
  who: "internal: the payroll.agreements.sweep and payroll.agreements.notify workflows run it with ctx.runMutation.",
  input: Schema.Struct({ orgId: S, claim: Schema.Array(S), clear: Schema.Array(S) }),
  output: Schema.Array(S),
  errors: [error_UNKNOWN],
  reads: CLAIM.reads ?? [],
  writes: CLAIM.writes ?? [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_payroll_agreements_emit_transitioned = defineRpc({
  id: "payroll.agreements.emit-transitioned",
  title: "Deliver one agreement transition event after its landing commits",
  about:
    "Telemetry plumbing: registered as the internal action `payroll/agreements:emitTransitioned` (CAP-1058). " +
    "scheduleAgreementTransitionInTx schedules it through scheduleTelemetryEmit from the settle transaction that recorded " +
    "a landed write (a holder's offer, withdraw, change, cancel, pause, resume or end; a payee's accept or collect), with " +
    "its block time. It attributes the event to the person who prepared the write, else the system job " +
    "`agreement_writer`, and posts payroll_agreement_transitioned with only durable ids and closed words (agreement kind, " +
    "payee kind, a payee Organization). It reads and writes no table.",
  was: [`${CONVEX}:13`, `${OPS}/emit-transitioned.ts:14`, `${AG}/events.ts:28`, `${AG}/events.ts:96`, `${AG}/events.ts:147`],
  concept: concept_payroll,
  kind: "action",
  who: "internal: scheduled by scheduleAgreementTransitionInTx from payroll.agreements.settle or payroll.agreements.settle-payee.",
  input: Schema.Struct({
    transition: Schema.Literals(["offered", "withdrawn", "rate_changed", "rate_change_cancelled", "paused", "resumed", "ended", "accepted", "collected"]),
    agreementId: S,
    agreementKind: Schema.Literals(["salary", "stream", "retainer", "fixed_term"]),
    payeeKind: Schema.Literals(["person", "organization"]),
    organizationId: S,
    occurredAt: N,
    authUserId: opt(S),
    observationContext: opt(Schema.Unknown),
    payeeOrgId: opt(S),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_payroll_agreement_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflows ──────────────────────────────────────────────────────────────────────────────

export const workflow_payroll_agreements_notify = defineWorkflow({
  id: "payroll.agreements.notify",
  title: "Email what one agreement event tells whom",
  about:
    "Registered as the internal action `payroll/agreements:notify` (G5). Scheduled (runAfter 0, attempt 0, scheduledAt) " +
    "in the transaction that settles a landed holder write (offered, changed, paused, resumed, ended) or a payee write " +
    "(accepted, collected, a failed collect's collection_refused), and from the collect actions when a payer cannot pay " +
    "(collection_refused). Attributed to the system job `agreement_notices`. It reads the facts (noticeFacts), the " +
    "agreement and the chain's time now; an `ended` event whose end has passed claims the sweep's `ended:` key first and " +
    "sends nothing if already claimed; a ceiling refusal (ROLE_PERMISSION_DENIED) reads the payer Safe's Directors through " +
    "fetchSafeOwners and adds them. agreementNotices plans the emails; deliverNotices sends them under " +
    "`payroll.agreements.notify:<id>:<event>`, retrying the recipients the provider did not take.",
  was: [
    `${CONVEX}:23`,
    `${OPS}/notify.ts:29`,
    `${OPS}/notify.ts:47`,
    `${OPS}/notify.ts:55`,
    `${AG}/writes/notices.ts:14`,
    `${AG}/writes/notices.ts:43`,
    `${AG}/external/notices.ts:33`,
    `${AG}/external/notices.ts:48`,
    `${AG}/external/notices.ts:79`,
    `${AG}/rules/notices.ts:170`,
    `${AG}/rules/notices.ts:178`,
    `${OPS}/collect.ts:129`,
    `${AG}/writes/payees.ts:189`,
  ],
  concept: concept_payroll,
  priority: "low",
  trigger: { transition: machine_payroll_agreement_write.t.to_landed },
  instance: { per: table_payroll_agreements },
  steps: [
    { name: "attribute", about: "Records the run as the system job `agreement_notices`." },
    { name: "facts", about: "Runs payroll.agreements.notice-facts; null ends with { sent: 0, failed: 0 }." },
    { name: "chain", about: "The agreement as the contract answers now and the latest block's time." },
    { name: "claim-ended", about: "An `ended` event whose end has passed, on the first attempt: payroll.agreements.claim-notices for `ended:<id>`." },
    { name: "directors", about: "A ceiling refusal: the payer Safe's owners on chain, then the facts again with their addresses." },
    { name: "send", about: "agreementNotices plans the emails; deliverNotices sends them, to `only` on a retry." },
    { name: "retry", about: "Recipients the provider did not take: this action again after the retry delay, attempt + 1." },
  ],
  ...withoutSpans(
    all(NOTICE_FACTS, CLAIM, CHAIN_NOW, {
      calls: [integration_chain_rpc.c.fetchSafeOwners, integration_mail.c.deliverNotices],
      chain: [contract_safe.f.getOwners],
    }),
  ),
  idempotency:
    "Only an `ended` notice whose end has passed is claimed once (`ended:<agreementId>`); every other event is sent each time it is scheduled. scheduledAt keeps each event its own delivery record.",
  timeoutMs: 600000,
  retries: { max: 2, backoff: "exponential" },
});

export const workflow_payroll_agreements_sweep = defineWorkflow({
  id: "payroll.agreements.sweep",
  title: "The daily agreement sweep: pay ready, terms ending, ended, low balance",
  about:
    "Registered as the internal action `payroll/agreements:sweep`, the job `send payment agreement notices` at 00:15 UTC " +
    "every day (G5). An executed Safe proposal also schedules it for its one Organization at once " +
    "(scheduleAgreementCheckInTx), so a Safe left short alerts its Directors then. Attributed to the system job " +
    "`agreement_notice_sweep`. For each Organization's agreements on chain (sweepFacts): the chain's time and each " +
    "agreement now; each payee whose release made pay ready hears once per release period, a fixed term's payee in its " +
    "last week, an ended agreement's payee what waits; per token, a Safe holding less than its payees can collect now " +
    "alerts the Directors (fetchSafeOwners) once, and a key whose condition passed is cleared. Each notice is claimed " +
    "(claimNotices) before it is sent. One Organization's failed chain read skips it; the job fails after the others are " +
    "sent. A failed send is retried by this action with only that notice.",
  was: [
    `${CONVEX}:42`,
    `${BACKEND}/src/platform/jobs.ts:153`,
    `${BACKEND}/src/organizations/proposals/writes/notices.ts:42`,
    `${OPS}/sweep.ts:44`,
    `${OPS}/sweep.ts:55`,
    `${OPS}/sweep.ts:138`,
    `${AG}/rules/sweeps.ts:47`,
    `${AG}/rules/sweeps.ts:129`,
    `${AG}/rules/sweeps.ts:144`,
    `${AG}/external/notices.ts:55`,
    `${AG}/external/notices.ts:111`,
  ],
  concept: concept_payroll,
  priority: "normal",
  trigger: { cron: "15 0 * * *" },
  instance: "singleton",
  steps: [
    { name: "attribute", about: "Records the run as the system job `agreement_notice_sweep`." },
    { name: "retry", about: "A retry run only delivers the notices it carries, at its attempt, and returns." },
    { name: "facts", about: "Runs payroll.agreements.sweep-facts for every Organization, or the one named." },
    { name: "read", about: "Per Organization: the latest block's time and each agreement on chain." },
    { name: "due", about: "agreementDue: ready (per release period), reminder (a fixed term's last week), ended." },
    { name: "low-balance", about: "Per token owed: the Safe's balance; short alerts its Directors (owners on chain, then their mailboxes)." },
    { name: "claim", about: "Runs payroll.agreements.claim-notices with the due keys and the cleared low_balance keys." },
    { name: "send", about: "deliverNotices for each claimed notice, its own delivery record under its key." },
    { name: "fail-unread", about: "Any Organization whose chain read failed fails the run after the others are sent." },
  ],
  ...withoutSpans(
    all({ reads: [table_payroll_agreements] }, NOTICE_FACTS, CLAIM, CHAIN_NOW, {
      calls: [integration_chain_rpc.c.fetchErc20Balance, integration_chain_rpc.c.fetchSafeOwners, integration_mail.c.deliverNotices],
      chain: [contract_erc20.f.balanceOf, contract_safe.f.getOwners],
    }),
  ),
  idempotency:
    "Each notice key is claimed in payrollAgreementNotices before it is sent, so a sweep that runs again sends nothing twice; a cleared low_balance key can alert again.",
  timeoutMs: 600000,
  retries: { max: 2, backoff: "exponential" },
});
