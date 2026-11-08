// The old book's Payroll area, as it is: one operation record for each operation that
// apps/docs/factory/areas/payroll.yaml lists (11), read from /home/user/factory (branch
// integration/factory). The text (title, about, who, changes, notes, mistakes, acceptance and each
// refusal's `when`) is the frozen book's, spread from ../../frozen, never retyped.
//
// implementedBy: the CLI command is traced to the SDK method the page names (packages/sdk/src/payroll/).
// - `org agreement offer|change|pause|resume|withdraw|end` (apps/cli/src/commands/org/subcommands/agreement/)
//   call `client.org(orgId).agreements.<verb>`. Each is `write` (agreements.ts:62): the session for the
//   write (`sessionForWrite`, which reads the session while it is restoring), one payroll.agreements row,
//   then `checkAgreementWrite` (:88), which checks the prepared call against what the caller asked
//   before anyone signs. Booked as flows (../payroll/flows.ts), as ../payments/flows.ts books every SDK
//   method that does local work beyond forwarding one row.
// - `agreement accept` calls `client.me.agreements.accept` and `agreement collect`
//   `client.agreements.collect` (the same bundle, platform/client/financial-ops.ts:77): one row, then
//   `checkPayeeWrite` (payee-agreements.ts:109) on the prepared call. Flows too.
// - `org agreement list`, `agreement list` and `agreement show` forward one row each
//   (agreements.ts:231; payee-agreements.ts:142, :151): the rpc, from ../payroll/agreements.ts.
// With `--org`, `agreement accept|collect|list|show` act for an Organization payee (Payee A) through
// `client.org(orgId).agreements` and the organizationAccept, organizationCollect, organizationReceived and
// organizationShow rows instead; each record's comment says so.
//
// After the write the CLI hands the approval to the browser, follows it (`followApproval`) and then the
// agreement until its call is on chain (`agreements.wait`, org internal/write.ts:139; payee
// internal/write.ts:127). Those are further calls the CLI makes after its implementation.
//
// returns: a Struct of the page's `returns` fields, typed from the row's output schema
// (packages/protocol/src/payroll/agreement-schema.ts, agreement-payee-schema.ts). `status`, `approvalId` and
// `next` are the CLI's approval hand-over (internal/write.ts:85) or the settled answer: Schema.Unknown, as
// ../payments/operations.ts books them.
//
// errors: what the CLI command produces itself. The Organization scope (`resolveProposalScope`; for a
// payee only with `--org`, agreement/internal/organization.ts:35) refuses with CLI_USAGE (auth/actor.ts:28,
// :43, :59; allowance/internal/scope.ts:16, :20; proposal/internal/scope.ts:31) and ROLE_PERMISSION_DENIED
// (an Organization not in your list, proposal/internal/scope.ts:41). A rate or release that is not one is
// CLI_USAGE (org agreement internal/input.ts:36, :52, :66). Following an approval the CLI refuses
// CANCELLED, WRONG_STATE (expired), CLI_DEADLINE and TRANSACTION_FAILED itself (payment/internal/approval.ts:100,
// :109, :118, :140). The session restore's NOT_AUTHENTICATED (auth/first-party.ts:173) is shared by every
// signed-in command and left out.
//
// A refusal's `given` names a saved devnet world (packages/scenarios) in which a scenario step's command
// reaches the refusal; `?` where none does. No budget: nothing measured these commands. priority is
// `normal`: the old book has none.

import { Schema } from "effect";
import { defineOperation, type Ref } from "../../../packages/book/src/index.ts";
import { frozenClaims, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CANCELLED,
  error_CLI_DEADLINE,
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
  error_TOKEN_REQUIRED,
  error_TRANSACTION_FAILED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  rpc_payroll_agreements_list,
  rpc_payroll_agreements_mine,
  rpc_payroll_agreements_show,
} from "../payroll/agreements.ts";
import {
  flow_client_agreements_collect,
  flow_client_me_agreements_accept,
  flow_client_org_agreements_change,
  flow_client_org_agreements_end,
  flow_client_org_agreements_offer,
  flow_client_org_agreements_pause,
  flow_client_org_agreements_resume,
  flow_client_org_agreements_withdraw,
} from "../payroll/flows.ts";

// ── how a page's refusals become records ─────────────────────────────────────────────────────

type Worlds = Readonly<Record<string, readonly [error: Ref<"error">, given: string]>>;

/** The page's refusals in its order, `when` verbatim; each code mapped to its error and world. */
const refusalsOf = (id: FrozenId, worlds: Worlds) =>
  frozenRefusals(id).map(({ code, when }) => {
    const mapped = worlds[code];
    if (mapped === undefined) throw new Error(`${id}: refusal ${code} has no error record`);
    return { error: mapped[0], given: mapped[1], when };
  });

const page = (id: FrozenId) => `apps/docs/factory/operations/${id}.yaml:1`;
const ORG = "apps/cli/src/commands/org/subcommands/agreement";
const PAYEE = "apps/cli/src/commands/agreement";
const SDK = "packages/sdk/src/payroll";
const ROWS = "packages/protocol/src/payroll";
const APPROVAL = "apps/cli/src/commands/payment/internal/approval.ts";
const PROPOSAL = "apps/cli/src/commands/org/subcommands/proposal/internal";
const SCENARIOS = "packages/scenarios/src/acme";

/** The Organization scope, and the refusals it makes itself. */
const SCOPE_WAS = [
  `${PROPOSAL}/scope.ts:15`,
  `${PROPOSAL}/scope.ts:31`,
  `${PROPOSAL}/scope.ts:41`,
  "apps/cli/src/commands/org/internal/lifecycle.ts:17",
  "apps/cli/src/commands/org/subcommands/allowance/internal/scope.ts:16",
  "apps/cli/src/auth/input.ts:20",
];
const SCOPE_ERRORS = [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED];
const FOLLOW_ERRORS = [error_CANCELLED, error_WRONG_STATE, error_CLI_DEADLINE, error_TRANSACTION_FAILED];

/** A holder's write: prepared, its approval handed over and followed, then the agreement followed to the chain. */
const HOLDER_WAS = [
  `${ORG}/internal/write.ts:54`,
  `${ORG}/internal/write.ts:76`,
  `${ORG}/internal/write.ts:78`,
  `${ORG}/internal/write.ts:85`,
  `${ORG}/internal/write.ts:126`,
  `${ORG}/internal/write.ts:139`,
  `${ORG}/internal/write.ts:149`,
  `${APPROVAL}:159`,
  `${SDK}/agreements.ts:62`,
  `${SDK}/agreements.ts:88`,
  `${SDK}/agreements.ts:115`,
  `${ROWS}/agreement-schema.ts:263`,
  ...SCOPE_WAS,
];
const HOLDER_ERRORS = [...SCOPE_ERRORS, ...FOLLOW_ERRORS];

/** A payee's command: as the person, or with `--org` as an Organization payee (Payee A). */
const PAYEE_WAS = [
  `${PAYEE}/internal/organization.ts:35`,
  `${PAYEE}/internal/write.ts:40`,
  "apps/cli/src/auth/actor.ts:80",
  "apps/cli/src/auth/actor.ts:28",
  "apps/cli/src/auth/actor.ts:43",
  ...SCOPE_WAS,
];

/** A payee's write, followed to the chain: as the person (payeeWrite) or the Organization (a Director proposal). */
const PAYEE_WRITE_WAS = [
  `${PAYEE}/internal/write.ts:49`,
  `${PAYEE}/internal/write.ts:73`,
  `${PAYEE}/internal/write.ts:115`,
  `${PAYEE}/internal/write.ts:127`,
  `${PAYEE}/internal/organization.ts:54`,
  `${PAYEE}/internal/organization.ts:76`,
  `${PROPOSAL}/approval.ts:59`,
  `${APPROVAL}:159`,
  `${SDK}/payee-agreements.ts:100`,
  `${SDK}/payee-agreements.ts:109`,
  `${SDK}/payee-agreements.ts:118`,
  "packages/sdk/src/platform/client/financial-ops.ts:77",
  ...PAYEE_WAS,
];

// ── the row shapes ───────────────────────────────────────────────────────────────────────────

const AGREEMENT_KINDS = ["salary", "stream", "retainer", "fixed_term"] as const; // agreement-schema.ts:15
const AGREEMENT_RELEASES = ["1mo", "7d", "1d", "1s"] as const; // agreement-schema.ts:23
const AGREEMENT_STATUSES = [
  "prepared",
  "offered",
  "active",
  "paused",
  "ending",
  "ended",
  "lapsed",
  "withdrawn",
  "abandoned",
] as const; // agreement-schema.ts:33
const AGREEMENT_ACTIONS = ["offer", "withdraw", "change", "cancelChange", "pause", "resume", "end"] as const; // :48
const RatePeriod = Schema.Literals(["year", "month", "week"]); // agreement-schema.ts:61
const Rate = Schema.Struct({ amount: Schema.String, per: RatePeriod });
const WriteState = Schema.Literals(["awaiting_approval", "sent", "landed", "failed", "abandoned"]);

/** AgreementPartySchema (agreement-schema.ts:162). */
const AgreementParty = Schema.Struct({ address: Schema.String, label: Schema.NullOr(Schema.String) });

/** AgreementSchema (agreement-schema.ts:183), with AgreementLastWriteSchema (:173). */
const Agreement = Schema.Struct({
  agreementId: Schema.String,
  orgId: Schema.String,
  department: Schema.Struct({ departmentId: Schema.String, key: Schema.String, name: Schema.String }),
  kind: Schema.Literals(AGREEMENT_KINDS),
  status: Schema.Literals(AGREEMENT_STATUSES),
  payee: Schema.Struct({
    ...AgreementParty.fields,
    email: Schema.NullOr(Schema.String),
    kind: Schema.Literals(["person", "organization"]),
    handle: Schema.NullOr(Schema.String),
  }),
  offeredBy: AgreementParty,
  token: Schema.String,
  rate: Rate,
  release: Schema.Literals(AGREEMENT_RELEASES),
  startsAt: Schema.NullOr(Schema.String),
  offerExpiresAt: Schema.String,
  acceptedAt: Schema.NullOr(Schema.String),
  pausedAt: Schema.NullOr(Schema.String),
  endsAt: Schema.NullOr(Schema.String),
  reserved: Schema.String,
  total: Schema.NullOr(Schema.String),
  pendingChange: Schema.NullOr(Schema.Struct({ rate: Rate, effectiveAt: Schema.String })),
  terms: Schema.Struct({ documentId: Schema.String, hash: Schema.String }),
  earned: Schema.String,
  collectable: Schema.String,
  collected: Schema.String,
  lastCollectedAt: Schema.NullOr(Schema.String),
  nextReleaseAt: Schema.NullOr(Schema.String),
  txHash: Schema.NullOr(Schema.String),
  lastWrite: Schema.NullOr(
    Schema.Struct({
      action: Schema.Literals(AGREEMENT_ACTIONS),
      approvalId: Schema.String,
      state: WriteState,
      reservedBefore: Schema.String,
      txHash: Schema.NullOr(Schema.String),
    }),
  ),
  chain: Schema.Struct({ id: Schema.NullOr(Schema.String), department: Schema.String }),
});

/** AgreementDepartmentSchema (agreement-schema.ts:245). */
const AgreementDepartment = Schema.Struct({
  departmentId: Schema.String,
  key: Schema.String,
  name: Schema.String,
  token: Schema.String,
  budget: Schema.String,
  committed: Schema.String,
  left: Schema.String,
});

/** AgreementPaymentSchema (agreement-payee-schema.ts:46). */
const AgreementPayment = Schema.Struct({
  paymentId: Schema.NullOr(Schema.String),
  agreementId: Schema.String,
  kind: Schema.Literal(4),
  amount: Schema.String,
  token: Schema.String,
  status: Schema.Literals(["submitted", "settled", "failed"]),
  txHash: Schema.NullOr(Schema.String),
  settledAt: Schema.NullOr(Schema.String),
});

/** AgreementPayerSchema (agreement-payee-schema.ts:77). */
const AgreementPayer = Schema.Struct({
  orgId: Schema.String,
  label: Schema.String,
  address: Schema.String,
  department: Schema.String,
});

/** PayeeAgreementSchema (agreement-payee-schema.ts:89), with PayeeWriteSchema (:64). */
const PayeeAgreement = Schema.Struct({
  ...Agreement.fields,
  payer: AgreementPayer,
  nextReleaseAmount: Schema.NullOr(Schema.String),
  payeeWrite: Schema.NullOr(
    Schema.Struct({
      action: Schema.Literals(["accept", "collect"]),
      approvalId: Schema.String,
      state: WriteState,
      txHash: Schema.NullOr(Schema.String),
      amount: Schema.NullOr(Schema.String),
      period: Schema.NullOr(Schema.Struct({ from: Schema.String, to: Schema.String })),
      payment: Schema.NullOr(AgreementPayment),
    }),
  ),
});

/** A holder's write as the page lists it: the hand-over, then AgreementWriteSchema's agreement and department (:263). */
const HolderWrite = Schema.Struct({
  status: Schema.Unknown, // `awaiting_approval` with `--no-wait`, or the agreement once its call is on chain.
  approvalId: Schema.Unknown, // Your approval of the one call from your personal Safe.
  agreement: Agreement,
  department: AgreementDepartment,
  next: Schema.Unknown, // With `--no-wait`, the `argv` that follows it.
});

// ── org agreement offer ──────────────────────────────────────────────────────────────────────

export const operation_org_agreement_offer = defineOperation({
  ...frozenText("org.agreement.offer"),
  was: [
    page("org.agreement.offer"),
    `${ORG}/subcommands/offer/command.ts:58`,
    `${ORG}/subcommands/offer/execute.ts:23`,
    `${ORG}/subcommands/offer/execute.ts:26`,
    `${ORG}/subcommands/offer/execute.ts:29`,
    `${ORG}/internal/input.ts:44`,
    `${ORG}/internal/input.ts:61`,
    `${SDK}/agreements.ts:159`,
    `${ROWS}/agreement-operations.ts:134`,
    ...HOLDER_WAS,
    `${SCENARIOS}/s3-hiring-offers-and-acceptance.scenario.ts:491`,
    `${SCENARIOS}/s3-hiring-offers-and-acceptance.scenario.ts:311`,
    `${SCENARIOS}/s9-paying-in-euros.scenario.ts:336`,
  ],
  priority: "normal",
  implementedBy: flow_client_org_agreements_offer,
  acceptance: frozenClaims("org.agreement.offer"),
  returns: HolderWrite,
  errors: HOLDER_ERRORS,
  refusals: refusalsOf("org.agreement.offer", {
    // s3.4 (s3:491): Rex offers Ben 30,000 a year from Engineering and is refused PAYROLL_BUDGET_EXCEEDED. It runs
    // inside S3 once 75,000 is committed; in after-s3 (saved at s3:311) Engineering has only 215 left and Rex still
    // holds it, so the same command is refused there.
    PAYROLL_BUDGET_EXCEEDED: [error_PAYROLL_BUDGET_EXCEEDED, "after-s3"],
    TOKEN_REQUIRED: [error_TOKEN_REQUIRED, "?"],
    // s9.6 (s9:336) is refused TOKEN_NOT_BUDGETED for Europe, which S9 creates (s9.2) and no saved world holds.
    TOKEN_NOT_BUDGETED: [error_TOKEN_NOT_BUDGETED, "?"],
    TOKEN_NOT_SUPPORTED: [error_TOKEN_NOT_SUPPORTED, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    FEATURE_NOT_AVAILABLE: [error_FEATURE_NOT_AVAILABLE, "?"],
  }),
});

// ── org agreement list ───────────────────────────────────────────────────────────────────────

export const operation_org_agreement_list = defineOperation({
  ...frozenText("org.agreement.list"),
  was: [
    page("org.agreement.list"),
    `${ORG}/subcommands/list/command.ts:18`,
    `${ORG}/subcommands/list/execute.ts:18`,
    `${ORG}/subcommands/list/execute.ts:20`,
    `${SDK}/agreements.ts:231`,
    `${ROWS}/agreement-operations.ts:190`,
    `${ROWS}/agreement-schema.ts:307`,
    ...SCOPE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_payroll_agreements_list,
  acceptance: frozenClaims("org.agreement.list"),
  // AgreementListSchema (agreement-schema.ts:307) with AgreementSummarySchema (:293); the CLI prints it as is.
  returns: Schema.Struct({
    items: Schema.Array(
      Schema.Struct({
        agreementId: Schema.String,
        department: Schema.String,
        payee: Schema.String,
        kind: Schema.Literals(AGREEMENT_KINDS),
        token: Schema.String,
        rate: Rate,
        status: Schema.Literals(AGREEMENT_STATUSES),
        offeredBy: Schema.String,
      }),
    ),
    departments: Schema.Array(AgreementDepartment),
  }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("org.agreement.list", {
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    PROVIDER_ERROR: [error_PROVIDER_ERROR, "?"],
  }),
});

// ── org agreement change ─────────────────────────────────────────────────────────────────────

// With `--cancel` the CLI calls `agreements.cancelChange` instead (change/execute.ts:32), a flow on the
// payroll.agreements.cancelChange row (agreements.ts:196, agreement-operations.ts:155).
export const operation_org_agreement_change = defineOperation({
  ...frozenText("org.agreement.change"),
  was: [
    page("org.agreement.change"),
    `${ORG}/subcommands/change/command.ts:29`,
    `${ORG}/subcommands/change/execute.ts:27`,
    `${ORG}/subcommands/change/execute.ts:32`,
    `${ORG}/subcommands/change/execute.ts:37`,
    `${ORG}/subcommands/change/execute.ts:40`,
    `${SDK}/agreements.ts:178`,
    `${SDK}/agreements.ts:196`,
    `${ROWS}/agreement-operations.ts:148`,
    ...HOLDER_WAS,
    `${SCENARIOS}/s5-changes-during-the-year.scenario.ts:366`,
    `${SCENARIOS}/s5-changes-during-the-year.scenario.ts:409`,
    `${SCENARIOS}/s5-changes-during-the-year.scenario.ts:671`,
    `${SCENARIOS}/s5-changes-during-the-year.scenario.ts:752`,
    `${SCENARIOS}/s5-changes-during-the-year.scenario.ts:1407`,
  ],
  priority: "normal",
  implementedBy: flow_client_org_agreements_change,
  acceptance: frozenClaims("org.agreement.change"),
  returns: HolderWrite,
  // CLI_USAGE also for `--cancel` with a rate or `--from` (change/execute.ts:27).
  errors: HOLDER_ERRORS,
  refusals: refusalsOf("org.agreement.change", {
    // s5.3 (s5:409): Rex raises Ben from 30,000 to 32,000 with 215 left in Engineering and is refused
    // PAYROLL_BUDGET_EXCEEDED. S5 restores after-s3 (s5:366), which holds those 215 and Rex as a holder.
    PAYROLL_BUDGET_EXCEEDED: [error_PAYROLL_BUDGET_EXCEEDED, "after-s3"],
    // s5.12 (s5:752): Mia changes BrightSpace's retainer after its end date was set (s5.10, s5:671) and is refused
    // WRONG_STATE `already_ended`. S5 saves after-s5 at its end (s5:1407), where that retainer still has its end.
    WRONG_STATE: [error_WRONG_STATE, "after-s5"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    FEATURE_NOT_AVAILABLE: [error_FEATURE_NOT_AVAILABLE, "?"],
  }),
});

// ── org agreement pause ──────────────────────────────────────────────────────────────────────

export const operation_org_agreement_pause = defineOperation({
  ...frozenText("org.agreement.pause"),
  was: [
    page("org.agreement.pause"),
    `${ORG}/subcommands/pause/command.ts:5`,
    `${ORG}/subcommands/pause/execute.ts:23`,
    `${SDK}/agreements.ts:204`,
    `${ROWS}/agreement-operations.ts:162`,
    ...HOLDER_WAS,
    `${SCENARIOS}/s5-changes-during-the-year.scenario.ts:1128`,
    `${SCENARIOS}/s5-changes-during-the-year.scenario.ts:1235`,
    `${SCENARIOS}/s5-changes-during-the-year.scenario.ts:1407`,
  ],
  priority: "normal",
  implementedBy: flow_client_org_agreements_pause,
  acceptance: frozenClaims("org.agreement.pause"),
  returns: HolderWrite,
  errors: HOLDER_ERRORS,
  refusals: refusalsOf("org.agreement.pause", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    // s5.24 (s5:1235): Rex, removed from Engineering at s5.22 (s5:1128), pauses Ben's agreement and is refused
    // ROLE_PERMISSION_DENIED. after-s5 (s5:1407) holds Rex removed and Ben's agreement running.
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "after-s5"],
    FEATURE_NOT_AVAILABLE: [error_FEATURE_NOT_AVAILABLE, "?"],
  }),
});

// ── org agreement resume ─────────────────────────────────────────────────────────────────────

export const operation_org_agreement_resume = defineOperation({
  ...frozenText("org.agreement.resume"),
  was: [
    page("org.agreement.resume"),
    `${ORG}/subcommands/resume/command.ts:5`,
    `${ORG}/subcommands/pause/execute.ts:24`,
    `${SDK}/agreements.ts:212`,
    `${ROWS}/agreement-operations.ts:169`,
    ...HOLDER_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_agreements_resume,
  acceptance: frozenClaims("org.agreement.resume"),
  returns: HolderWrite,
  errors: HOLDER_ERRORS,
  refusals: refusalsOf("org.agreement.resume", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    FEATURE_NOT_AVAILABLE: [error_FEATURE_NOT_AVAILABLE, "?"],
  }),
});

// ── org agreement withdraw ───────────────────────────────────────────────────────────────────

export const operation_org_agreement_withdraw = defineOperation({
  ...frozenText("org.agreement.withdraw"),
  was: [
    page("org.agreement.withdraw"),
    `${ORG}/subcommands/withdraw/command.ts:5`,
    `${ORG}/subcommands/withdraw/execute.ts:11`,
    `${SDK}/agreements.ts:170`,
    `${ROWS}/agreement-operations.ts:141`,
    ...HOLDER_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_agreements_withdraw,
  acceptance: frozenClaims("org.agreement.withdraw"),
  returns: HolderWrite,
  errors: HOLDER_ERRORS,
  refusals: refusalsOf("org.agreement.withdraw", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    FEATURE_NOT_AVAILABLE: [error_FEATURE_NOT_AVAILABLE, "?"],
  }),
});

// ── org agreement end ────────────────────────────────────────────────────────────────────────

export const operation_org_agreement_end = defineOperation({
  ...frozenText("org.agreement.end"),
  was: [
    page("org.agreement.end"),
    `${ORG}/subcommands/end/command.ts:14`,
    `${ORG}/subcommands/end/execute.ts:12`,
    `${SDK}/agreements.ts:220`,
    `${ROWS}/agreement-operations.ts:176`,
    ...HOLDER_WAS,
  ],
  priority: "normal",
  implementedBy: flow_client_org_agreements_end,
  acceptance: frozenClaims("org.agreement.end"),
  returns: HolderWrite,
  errors: HOLDER_ERRORS,
  refusals: refusalsOf("org.agreement.end", {
    WRONG_STATE: [error_WRONG_STATE, "?"],
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
    FEATURE_NOT_AVAILABLE: [error_FEATURE_NOT_AVAILABLE, "?"],
  }),
});

// ── agreement list ───────────────────────────────────────────────────────────────────────────

// As the person: `client.agreements.list` (list/execute.ts:27) forwards payroll.agreements.mine and returns its
// `items` (payee-agreements.ts:142). With `--org`: `client.org(id).agreements.received` (:19), the
// payroll.agreements.organizationReceived row (agreement-operations.ts:243).
export const operation_agreement_list = defineOperation({
  ...frozenText("agreement.list"),
  was: [
    page("agreement.list"),
    `${PAYEE}/subcommands/list/command.ts:16`,
    `${PAYEE}/subcommands/list/execute.ts:13`,
    `${PAYEE}/subcommands/list/execute.ts:19`,
    `${PAYEE}/subcommands/list/execute.ts:27`,
    `${SDK}/payee-agreements.ts:142`,
    `${ROWS}/agreement-operations.ts:197`,
    `${ROWS}/agreement-operations.ts:243`,
    `${ROWS}/agreement-payee-schema.ts:98`,
    ...PAYEE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_payroll_agreements_mine,
  acceptance: frozenClaims("agreement.list"),
  // PayeeAgreementListSchema (agreement-payee-schema.ts:98); the CLI prints `{ items }` (list/execute.ts:31).
  returns: Schema.Struct({ items: Schema.Array(PayeeAgreement) }),
  errors: SCOPE_ERRORS,
  // As is, `--status` is a closed flag: a status that is not one of the nine is refused by the CLI's parser with
  // CLI_USAGE before the row's INVALID_INPUT can answer.
  refusals: refusalsOf("agreement.list", {
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    NOT_AUTHENTICATED: [error_NOT_AUTHENTICATED, "?"],
    PROVIDER_ERROR: [error_PROVIDER_ERROR, "?"],
  }),
});

// ── agreement show ───────────────────────────────────────────────────────────────────────────

// As the person: `client.agreements.get` (show/execute.ts:32) forwards payroll.agreements.show
// (payee-agreements.ts:151). With `--org`: `client.org(id).agreements.get` (:16), which reads the paying side
// (payroll.agreements.get) and falls back to the payee side (organizationShow, agreements.ts:104).
export const operation_agreement_show = defineOperation({
  ...frozenText("agreement.show"),
  was: [
    page("agreement.show"),
    `${PAYEE}/subcommands/show/command.ts:7`,
    `${PAYEE}/subcommands/show/execute.ts:12`,
    `${PAYEE}/subcommands/show/execute.ts:16`,
    `${PAYEE}/subcommands/show/execute.ts:32`,
    `${SDK}/payee-agreements.ts:151`,
    `${SDK}/agreements.ts:104`,
    `${ROWS}/agreement-operations.ts:204`,
    `${ROWS}/agreement-payee-schema.ts:89`,
    ...PAYEE_WAS,
  ],
  priority: "normal",
  implementedBy: rpc_payroll_agreements_show,
  acceptance: frozenClaims("agreement.show"),
  // PayeeAgreementSchema's fields (agreement-payee-schema.ts:89); the CLI prints the whole agreement (show/execute.ts:35).
  returns: Schema.Struct({
    payer: PayeeAgreement.fields.payer,
    kind: PayeeAgreement.fields.kind,
    status: PayeeAgreement.fields.status,
    rate: PayeeAgreement.fields.rate,
    release: PayeeAgreement.fields.release,
    terms: PayeeAgreement.fields.terms,
    earned: PayeeAgreement.fields.earned,
    collectable: PayeeAgreement.fields.collectable,
    collected: PayeeAgreement.fields.collected,
    nextReleaseAt: PayeeAgreement.fields.nextReleaseAt,
  }),
  errors: SCOPE_ERRORS,
  refusals: refusalsOf("agreement.show", {
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "?"],
  }),
});

// ── agreement accept ─────────────────────────────────────────────────────────────────────────

// As the person: `client.me.agreements.accept` (accept/execute.ts:48), the payroll.agreements.accept row then
// `checkPayeeWrite` (payee-agreements.ts:155). With `--org`: `client.org(id).agreements.accept` (:23), the
// organizationAccept row (agreement-operations.ts:261), as a Director proposal on the payee's Safe.
export const operation_agreement_accept = defineOperation({
  ...frozenText("agreement.accept"),
  was: [
    page("agreement.accept"),
    `${PAYEE}/subcommands/accept/command.ts:26`,
    `${PAYEE}/subcommands/accept/execute.ts:17`,
    `${PAYEE}/subcommands/accept/execute.ts:23`,
    `${PAYEE}/subcommands/accept/execute.ts:48`,
    `${PAYEE}/subcommands/accept/execute.ts:54`,
    `${SDK}/payee-agreements.ts:155`,
    `${ROWS}/agreement-operations.ts:215`,
    `${ROWS}/agreement-operations.ts:261`,
    `${ROWS}/agreement-payee-schema.ts:142`,
    ...PAYEE_WRITE_WAS,
    "packages/backend/src/payroll/agreements/operations/accept.ts:28",
    "packages/backend/src/payroll/agreements/operations/accept.ts:38",
    "packages/backend/src/payroll/agreements/guards.ts:204",
    `${SCENARIOS}/s3-hiring-offers-and-acceptance.scenario.ts:271`,
    `${SCENARIOS}/s3-hiring-offers-and-acceptance.scenario.ts:311`,
    `${SCENARIOS}/s3-hiring-offers-and-acceptance.scenario.ts:907`,
    `${SCENARIOS}/s3-hiring-offers-and-acceptance.scenario.ts:940`,
    `${SCENARIOS}/s3-hiring-offers-and-acceptance.scenario.ts:1159`,
  ],
  priority: "normal",
  implementedBy: flow_client_me_agreements_accept,
  acceptance: frozenClaims("agreement.accept"),
  // `agreement` is PayeeWritePreparedSchema's (agreement-payee-schema.ts:142), as the follow re-reads it; the rest
  // is the hand-over or the settled answer (accept/execute.ts:61).
  returns: Schema.Struct({
    status: Schema.Unknown, // `awaiting_approval` with `--no-wait`, or the agreement's once the acceptance is on chain.
    approvalId: Schema.Unknown, // Your approval of the one accept call.
    agreement: PayeeAgreement,
    next: Schema.Unknown, // With `--no-wait`, the `argv` that follows it.
  }),
  errors: [...SCOPE_ERRORS, ...FOLLOW_ERRORS],
  refusals: refusalsOf("agreement.accept", {
    // s3.15 (s3:940) pins a stale terms hash on Alice's offer while it is open. The backend checks the offer is open
    // (accept.ts:38) before the hash (:49), and Alice accepts it at s3.16, before either saved world of S3 (s3:271,
    // :311): no saved world holds an offer that step's command reaches the hash check on.
    INVALID_INPUT: [error_INVALID_INPUT, "?"],
    // s3.21 (s3:1159): Cara accepts her offer after it lapsed and is refused WRONG_STATE `lapsed`. It runs from
    // before-cara-accepts (saved at s3:271, her offer still open) after only a clock warp (s3.20).
    WRONG_STATE: [error_WRONG_STATE, "before-cara-accepts"],
    // s3.14 (s3:907): Dana accepts Alice's offer for her and is refused ROLE_PERMISSION_DENIED (not the payee). The
    // backend checks the payee (requirePayee, accept.ts:28) before the offer's state (:38), so the same command is
    // refused alike in after-s3 (s3:311), where Alice has accepted.
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "after-s3"],
  }),
});

// ── agreement collect ────────────────────────────────────────────────────────────────────────

// As the person: `client.agreements.collect` (collect/execute.ts:51): the payroll.agreements.collect row, then, when
// something is released, `checkPayeeWrite` (payee-agreements.ts:165). With `--org`: `client.org(id).agreements
// .collect` (:20), the organizationCollect row (agreement-operations.ts:272). Nothing released prints the row's
// answer at once (:53).
export const operation_agreement_collect = defineOperation({
  ...frozenText("agreement.collect"),
  was: [
    page("agreement.collect"),
    `${PAYEE}/subcommands/collect/command.ts:20`,
    `${PAYEE}/subcommands/collect/execute.ts:14`,
    `${PAYEE}/subcommands/collect/execute.ts:20`,
    `${PAYEE}/subcommands/collect/execute.ts:51`,
    `${PAYEE}/subcommands/collect/execute.ts:53`,
    `${PAYEE}/subcommands/collect/execute.ts:55`,
    `${SDK}/payee-agreements.ts:165`,
    `${SDK}/payee-agreements.ts:48`,
    `${ROWS}/agreement-operations.ts:226`,
    `${ROWS}/agreement-operations.ts:272`,
    `${ROWS}/agreement-payee-schema.ts:170`,
    ...PAYEE_WRITE_WAS,
    "packages/backend/src/payroll/agreements/operations/collect.ts:46",
    `${SCENARIOS}/s4-the-first-month-of-pay.scenario.ts:25`,
    `${SCENARIOS}/s4-the-first-month-of-pay.scenario.ts:875`,
    `${SCENARIOS}/s7-when-money-controls-say-no.scenario.ts:947`,
  ],
  priority: "normal",
  implementedBy: flow_client_agreements_collect,
  acceptance: frozenClaims("agreement.collect"),
  // CollectAgreementResultSchema (agreement-payee-schema.ts:170): PayeeWritePrepared's `collected` (:142) or
  // NothingReleased's `0.00` and `nextReleaseAt` (:159). `payment` is the payee write's AgreementPayment (:46), as the
  // follow reads it back (payee-agreements.ts:83).
  returns: Schema.Struct({
    status: Schema.Unknown, // `settled` or `submitted`; `nothing_released`; or `awaiting_approval` with `--no-wait`.
    collected: Schema.NullOr(Schema.String),
    payment: Schema.NullOr(AgreementPayment),
    agreement: PayeeAgreement,
    nextReleaseAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  errors: [...SCOPE_ERRORS, ...FOLLOW_ERRORS],
  refusals: refusalsOf("agreement.collect", {
    // s7.14 (s7:947) is refused PAYER_BALANCE_TOO_LOW once S7 has drained Acme's Safe; no saved world holds it short.
    PAYER_BALANCE_TOO_LOW: [error_PAYER_BALANCE_TOO_LOW, "?"],
    // s4.22 (s4:875): Rex collects Alice's pay and is refused ROLE_PERMISSION_DENIED (not the payee). S4 restores
    // after-s3 (s4:25), where Alice's salary is accepted; the payee check (collect.ts:46) comes before any release.
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, "after-s3"],
    WRONG_STATE: [error_WRONG_STATE, "?"],
  }),
});
