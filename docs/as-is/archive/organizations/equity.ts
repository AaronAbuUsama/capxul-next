// The as-is book of the old organizations concept: the equity area (a v4 company's cap table).
//
// Every operation registered at `organizations/equity:*` (packages/backend/convex/organizations/equity.ts).
// Eight are public actions: five rows of `equity` (packages/protocol/src/organizations/equity-operations.ts)
// and three of `shareTransfers` (share-transfer-operations.ts), which register as `organizations.equity.*`.
// The rest are internal; followTransfer is scheduled by organizations.equity.record-transfer-outcome, so it
// is a workflow, and the two emit actions are telemetry plumbing.
//
// The Board writes (setup, issue, createSafeRound, grantOptions, approveTransfer) start with
// `requireSafeOwner` (proposals.ts: load, refresh, the caller a Director now) and end with one Board
// proposal stored in the same transaction as the equity row that names it. A sale (sell) is the seller's
// own sponsored UserOperation. Touches follow proposals.ts; Accounts' accounts.approvals.openForShareTransfer
// and accounts.lanes.reserve/release are named in `about` and booked by Accounts.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_organizations } from "../shared/foundation.ts";
import {
  error_AUTHORISED_EXCEEDED,
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_POOL_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SHARES_LOCKED,
  error_SMART_ACCOUNT_MISSING,
  error_TOKEN_NOT_SUPPORTED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_equity_grant_transitioned,
  event_equity_shares_transitioned,
  event_fundraise_round_transitioned,
} from "../shared/vocabulary.ts";
import {
  contract_captable,
  contract_exits,
  contract_installer,
  contract_multi_send_call_only,
  contract_options,
  contract_rounds,
  contract_safe_4337_module,
  contract_share_class,
  contract_vesting,
  integration_chain_rpc,
  integration_companies_house,
} from "../shared/external.ts";
import {
  machine_org_share_transfer,
  table_org_equities,
  table_org_equity_issues,
  table_org_lifecycles,
  table_org_members,
  table_org_option_grants,
  table_org_safe_proposals,
  table_org_safe_rounds,
  table_org_share_transfers,
  table_orgs,
} from "./data.ts";
import { procedure_access_require_feature_from_action } from "../access/procedures.ts";
import { procedure_accounts_read_workspace_setup_signer_in_tx } from "../accounts/procedures.ts";
import { procedure_parties_party_by_id } from "../parties/procedures.ts";
import {
  Approval,
  PROPOSALS_LOAD_WAS,
  PROPOSALS_PARTICIPANT_READS,
  PROPOSALS_PARTICIPANT_WAS,
  PROPOSALS_RECORD_OWNER,
  PROPOSALS_RECORD_OWNER_WAS,
  PROPOSALS_REFRESH,
  PROPOSALS_REFRESH_WAS,
  PROPOSALS_SAFE_OWNER,
  PROPOSALS_SAFE_OWNER_WAS,
  PROPOSALS_SETTLE,
  SafeProposal,
  SPONSORED_BUILD,
  SPONSORED_BUILD_WAS,
  spanUnion,
  union,
} from "./proposals.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/organizations/equity.ts`;
const ORG = `${BACKEND}/src/organizations`;
const SRC = `${ORG}/equity`;
const OPS = `${SRC}/operations`;
const ROWS = "packages/protocol/src/organizations/equity-operations.ts";
const SALE_ROWS = "packages/protocol/src/organizations/share-transfer-operations.ts";
const SCHEMA = "packages/protocol/src/organizations/equity-schema.ts";
const SALE_SCHEMA = "packages/protocol/src/organizations/share-transfer-schema.ts";
const EVM = "packages/protocol/src/evm";
const HOUSE = `${BACKEND}/src/integrations/companies-house`;

// ── errors ─────────────────────────────────────────────────────────────────────────────────

const DEFECT = [error_UNKNOWN];

/** CALL, DEFECTS, PARTICIPANT, OWNER, STATE, CHAIN, the `equity` gate (equity-operations.ts:30). */
const BOARD_ROW_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_UNKNOWN,
  error_ENV_MISSING,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_STATE,
  error_PROVIDER_ERROR,
  error_FEATURE_NOT_AVAILABLE,
];

/** `transfer` (share-transfer-operations.ts:47): CALL, DEFECTS, PARTICIPANT, CHAIN, ENV_MISSING. */
const READ_ROW_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_UNKNOWN,
  error_ENV_MISSING,
  error_ROLE_PERMISSION_DENIED,
  error_PROVIDER_ERROR,
];

// ── shared touches ─────────────────────────────────────────────────────────────────────────

/**
 * A Board write's start (`requireSafeOwner`) with the `equity` gate: the proposals load and refresh, whose
 * settle mutation can write every subject's rows.
 */
const BOARD = {
  reads: PROPOSALS_SAFE_OWNER.reads,
  writes: PROPOSALS_SETTLE.writes,
  drives: PROPOSALS_SETTLE.drives,
  invokes: union([procedure_access_require_feature_from_action], PROPOSALS_SAFE_OWNER.invokes),
  emits: PROPOSALS_SETTLE.emits,
  calls: PROPOSALS_REFRESH.calls,
  chain: PROPOSALS_REFRESH.chain,
  spans: PROPOSALS_REFRESH.spans,
};
const BOARD_WAS = [...PROPOSALS_SAFE_OWNER_WAS, ...PROPOSALS_LOAD_WAS, ...PROPOSALS_REFRESH_WAS];

/**
 * `equityFactsInTx` (reads.ts:70), the `load` query: the Organization, its v4 setup and install, its Party's
 * handle (else WRONG_STATE `notAV4Company`), the equity row, its proposal's status and the active members the
 * founders' emails name. It checks no caller.
 */
const FACTS = {
  reads: [table_orgs, table_org_lifecycles, table_org_equities, table_org_members, table_org_safe_proposals],
  invokes: [procedure_parties_party_by_id],
};
const FACTS_WAS = [`${SRC}/reads.ts:44`, `${SRC}/reads.ts:52`, `${SRC}/reads.ts:70`, `${SRC}/reads.ts:110`, `${SRC}/reads.ts:124`, `${ORG}/members/reads.ts:1`];

/**
 * `recordLandedInTx` (writes/landed.ts:30), run by the `record` mutation's `landed` step: an install, issue,
 * option grant or SAFE round whose Board proposal executed is noted once and reported.
 */
const LANDED = {
  reads: [table_org_equities, table_org_safe_proposals, table_org_equity_issues, table_org_option_grants, table_org_safe_rounds],
  writes: [table_org_equities, table_org_equity_issues, table_org_option_grants, table_org_safe_rounds],
  emits: [event_equity_shares_transitioned, event_equity_grant_transitioned, event_fundraise_round_transitioned],
};
const LANDED_WAS = [`${SRC}/writes/landed.ts:12`, `${SRC}/writes/landed.ts:30`, `${SRC}/writes/landed.ts:99`, `${SRC}/events.ts:44`, `${SRC}/events.ts:105`, `${ORG}/rounds/events.ts:1`];

/** `transferContextInTx` (reads/transfers.ts:77), the `loadTransfer` query. */
const TRANSFER_CONTEXT = {
  reads: union([table_org_share_transfers], PROPOSALS_PARTICIPANT_READS, [table_org_equities]),
  invokes: [procedure_accounts_read_workspace_setup_signer_in_tx],
};
const TRANSFER_CONTEXT_WAS = [
  `${SRC}/reads/transfers.ts:62`,
  `${SRC}/reads/transfers.ts:77`,
  `${SRC}/reads/transfers.ts:86`,
  `${SRC}/reads/transfers.ts:90`,
  `${SRC}/reads/transfers.ts:91`,
  `${SRC}/reads/transfers.ts:96`,
  `${SRC}/reads/transfers.ts:125`,
  `${SRC}/reads/transfers.ts:147`,
  ...PROPOSALS_PARTICIPANT_WAS,
];

/** A class's headroom (external/classes.ts:23): the class, its token's supply, the convertible reserve, the exit close. */
const HEADROOM_READS = [
  contract_captable.f.getClass,
  contract_share_class.f.totalSupply,
  contract_captable.f.convertibleReserved,
  contract_captable.f.closedForExit,
];

/** `settleSentOffer` (external/transfers.ts:82): the receipt, Exits' `TransferOffered` from its logs, then the outcome. */
const SETTLE_OFFER = {
  reads: [table_org_share_transfers],
  writes: [table_org_share_transfers],
  drives: [machine_org_share_transfer.t.to_offered, machine_org_share_transfer.t.to_failed],
  calls: [integration_chain_rpc.c.fetchUserOperationReceipt],
  spans: ["convex.mutation", "chain.read eth_getUserOperationReceipt", "chain.attempt <upstream>"],
};
const SETTLE_OFFER_WAS = [`${SRC}/external/transfers.ts:82`, `${SRC}/external/transfers.ts:104`, `${SRC}/external/holders.ts:124`, `${EVM}/company-share-transfers.ts:106`, `${SRC}/writes/transfers.ts:48`];

const ACTION_SPANS = ["convex.query", "convex.mutation", "chain.attempt <upstream>"];

const Owner = Schema.Struct({
  orgId: Schema.String,
  chainId: Schema.Number,
  safeAddress: Schema.String,
  chainNonce: Schema.Number,
  threshold: Schema.Number,
  proposer: Schema.String,
});
const Call = Schema.Struct({ to: Schema.String, value: Schema.String, data: Schema.String });
const Template = Schema.Literals(["solo", "co-founders", "pre-safe", "seed", "founder-control", "llc"]);
const SaleParty = Schema.Struct({ email: Schema.NullOr(Schema.String), safe: Schema.String });

/** `ShareTransferSchema` (share-transfer-schema.ts:76): a sale as callers read it; too wide to transcribe in full. */
const ShareTransfer = Schema.Unknown;

const DIRECTOR = "A signed-in current Seat whose claimed personal Safe is a live Director of the company Safe (and, behind the Signer Gate, wears the Director hat).";

// ── public: Board writes ───────────────────────────────────────────────────────────────────

export const rpc_organizations_equity_setup = defineRpc({
  id: "organizations.equity.setup",
  title: "Switch a v4 company's equity on as one Board proposal",
  about:
    "Row `organizations.equity.setup`, registered as the public action `organizations/equity:setup` (CAP-1174). Signed in. " +
    "The `equity` gate, `requireSafeOwner`, then organizations.equity.load with the founders' emails. `planSetup` checks " +
    "the template's plan against what it authorises (INVALID_INPUT, AUTHORISED_EXCEEDED); the Protocol v4 config must be " +
    "set (ENV_MISSING). `Installer.deployEquity`'s call is built and its keccak256 is the terms digest. Equity already " +
    "installed is noted (`landed`) and refused WRONG_STATE; a waiting proposal for other terms is WRONG_STATE. " +
    "`ensureEquityDeployed` holds the service key's lane (Accounts' accounts.lanes.reserve, retried every 2 s for a minute) " +
    "and makes the clones once: an earlier deployment for the same terms is reused; a recorded `deployEquity` is found by " +
    "hash or broadcast again from its stored bytes; else the service key (CAPXUL_COMPANIES_HOUSE_SERVICE_KEY) signs a new one, " +
    "organizations.equity.record stores it before the broadcast, and its receipt's clones are stored. `readEquityBatch` asks " +
    "the Installer's `buildEquity` (eth_call) for the Board's batch, which organizations.equity.record stores as one proposal " +
    "(`equity_setup`) with the cap table. Answers the setup with its proposal; the SDK then asks for the approval.",
  was: [
    `${CONVEX}:5`,
    `${OPS}/setup.ts:35`,
    `${OPS}/setup.ts:39`,
    `${OPS}/setup.ts:40`,
    `${OPS}/setup.ts:41`,
    `${OPS}/setup.ts:46`,
    `${OPS}/setup.ts:62`,
    `${OPS}/setup.ts:63`,
    `${OPS}/setup.ts:76`,
    `${OPS}/setup.ts:89`,
    `${OPS}/setup.ts:93`,
    `${OPS}/setup.ts:95`,
    `${OPS}/setup.ts:106`,
    `${OPS}/setup.ts:116`,
    `${ROWS}:30`,
    `${SCHEMA}:43`,
    `${SCHEMA}:119`,
    `${SRC}/rules.ts:83`,
    `${SRC}/rules.ts:209`,
    `${SRC}/external.ts:40`,
    `${SRC}/external.ts:57`,
    `${SRC}/external.ts:72`,
    `${SRC}/external.ts:104`,
    `${SRC}/external.ts:140`,
    `${SRC}/external.ts:201`,
    `${SRC}/writes.ts:280`,
    `${EVM}/company-equity.ts:25`,
    `${HOUSE}/service.ts:46`,
    `${HOUSE}/service.ts:92`,
    `${BACKEND}/src/accounts/lanes/external.ts:21`,
    ...BOARD_WAS,
    ...FACTS_WAS,
    ...LANDED_WAS,
    ...PROPOSALS_RECORD_OWNER_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({
    orgId: Schema.String,
    template: Template,
    authorised: Schema.Number,
    founders: Schema.Array(Schema.Struct({ shareholder: Schema.String, shares: Schema.Number })),
    pool: Schema.optionalKey(Schema.Number),
    vesting: Schema.optionalKey(Schema.Struct({ months: Schema.Number, cliffMonths: Schema.optionalKey(Schema.Number) })),
    start: Schema.optionalKey(Schema.String),
    note: Schema.optionalKey(Schema.String),
  }),
  /** `EquitySetupSchema` (equity-schema.ts:119): status, template, summary, cap table, Governor, contracts, proposal. */
  output: Schema.Struct({
    status: Schema.Literals(["awaiting_approvals", "installed"]),
    template: Template,
    summary: Schema.String,
    capTable: Schema.Unknown,
    governor: Schema.Unknown,
    contracts: Schema.Unknown,
    proposal: SafeProposal,
  }),
  errors: [...BOARD_ROW_ERRORS, error_AUTHORISED_EXCEEDED],
  reads: union(BOARD.reads, FACTS.reads, LANDED.reads),
  writes: union(BOARD.writes, LANDED.writes, PROPOSALS_RECORD_OWNER.writes),
  drives: BOARD.drives,
  invokes: union(BOARD.invokes, FACTS.invokes),
  emits: union(BOARD.emits, LANDED.emits),
  calls: union(BOARD.calls, [
    integration_chain_rpc.c.fetchBoundedTransaction,
    integration_chain_rpc.c.prepareTransaction,
    integration_chain_rpc.c.broadcastTransaction,
    integration_chain_rpc.c.waitForTransactionReceipt,
    integration_companies_house.c.signServiceCall,
    integration_companies_house.c.confirmServiceTransaction,
  ]),
  chain: union(BOARD.chain, [contract_installer.f.deployEquity, contract_installer.f.buildEquity]),
  spans: spanUnion(BOARD.spans, [
    "chain.read eth_getTransactionByHash",
    "chain.read eth_sendRawTransaction",
    "chain.read eth_getTransactionReceipt",
  ]),
});

export const rpc_organizations_equity_issue = defineRpc({
  id: "organizations.equity.issue",
  title: "Issue shares in a class as one Board proposal",
  about:
    "Row `organizations.equity.issue`, registered as `organizations/equity:issue` (CAP-1173). Signed in. The `equity` gate, " +
    "`requireSafeOwner`, then organizations.equity.record `landed` notes what earlier Board proposals did; equity not " +
    "installed is WRONG_STATE. organizations.equity.load names the recipient: an address as given, else an active member's " +
    "personal Safe (INVALID_INPUT otherwise). An unknown class is INVALID_INPUT. The class's headroom is read as " +
    "`Captable.issue` would check it: a Captable closed for an exit is WRONG_STATE, over the authorised amount is " +
    "AUTHORISED_EXCEEDED. organizations.equity.record-issue stores the issue and its Board proposal of `Captable.issue` " +
    "with the reason's hash; the same issue again while its proposal waits answers that proposal.",
  was: [
    `${CONVEX}:7`,
    `${OPS}/issue.ts:32`,
    `${OPS}/issue.ts:36`,
    `${OPS}/issue.ts:37`,
    `${OPS}/issue.ts:42`,
    `${OPS}/issue.ts:45`,
    `${OPS}/issue.ts:50`,
    `${OPS}/issue.ts:58`,
    `${OPS}/issue.ts:63`,
    `${OPS}/issue.ts:64`,
    `${OPS}/issue.ts:73`,
    `${OPS}/issue.ts:80`,
    `${ROWS}:51`,
    `${SCHEMA}:138`,
    `${SCHEMA}:154`,
    `${SRC}/external/classes.ts:23`,
    `${SRC}/writes/issues.ts:99`,
    `${EVM}/company-equity-issue.ts:1`,
    ...BOARD_WAS,
    ...FACTS_WAS,
    ...LANDED_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({
    orgId: Schema.String,
    className: Schema.String,
    to: Schema.String,
    shares: Schema.Number,
    reasonHash: Schema.String,
    note: Schema.optionalKey(Schema.String),
  }),
  /** `EquityIssueSchema` (equity-schema.ts:154). */
  output: Schema.Struct({ status: Schema.Literals(["awaiting_approvals", "issued"]), issue: Schema.Unknown, proposal: SafeProposal }),
  errors: [...BOARD_ROW_ERRORS, error_AUTHORISED_EXCEEDED],
  reads: union(BOARD.reads, LANDED.reads, FACTS.reads),
  writes: union(BOARD.writes, LANDED.writes),
  drives: BOARD.drives,
  invokes: union(BOARD.invokes, FACTS.invokes),
  emits: union(BOARD.emits, LANDED.emits),
  calls: BOARD.calls,
  chain: union(BOARD.chain, HEADROOM_READS),
  spans: BOARD.spans,
});

export const rpc_organizations_equity_create_safe_round = defineRpc({
  id: "organizations.equity.create-safe-round",
  title: "Open a post-money SAFE round as one Board proposal",
  about:
    "Row `organizations.equity.createSafeRound`, registered as `organizations/equity:createSafeRound` (CAP-1198). Signed in. " +
    "The `equity` gate, `requireSafeOwner`, the `landed` note; equity or the Rounds clone not installed is WRONG_STATE. A " +
    "close date already passed is INVALID_INPUT; a Captable closed for an exit is WRONG_STATE; the chain's USDC must be " +
    "configured (TOKEN_NOT_SUPPORTED). organizations.equity.record-safe-round stores the round (`sr_` id) and its Board " +
    "proposal of `Rounds.createSafeRound` in USDC with the SAFE form's hash; the same round again while its proposal waits " +
    "answers it.",
  was: [
    `${CONVEX}:18`,
    `${OPS}/create-safe-round.ts:30`,
    `${OPS}/create-safe-round.ts:36`,
    `${OPS}/create-safe-round.ts:37`,
    `${OPS}/create-safe-round.ts:39`,
    `${OPS}/create-safe-round.ts:45`,
    `${OPS}/create-safe-round.ts:48`,
    `${OPS}/create-safe-round.ts:50`,
    `${OPS}/create-safe-round.ts:52`,
    `${OPS}/create-safe-round.ts:53`,
    `${OPS}/create-safe-round.ts:62`,
    `${ROWS}:73`,
    `${SCHEMA}:197`,
    `${SCHEMA}:216`,
    `${SRC}/external.ts:48`,
    `${SRC}/external/classes.ts:42`,
    `${SRC}/writes/safe-rounds.ts:118`,
    `${EVM}/company-safe-rounds.ts:1`,
    ...BOARD_WAS,
    ...LANDED_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({
    orgId: Schema.String,
    cap: Schema.Number,
    discountPct: Schema.Number,
    raise: Schema.Number,
    closes: Schema.String,
    termsHash: Schema.String,
    note: Schema.optionalKey(Schema.String),
  }),
  /** `SafeRoundCreateSchema` (equity-schema.ts:216). */
  output: Schema.Struct({ status: Schema.Literals(["awaiting_approvals", "opened"]), safeRound: Schema.Unknown, proposal: SafeProposal }),
  errors: [...BOARD_ROW_ERRORS, error_TOKEN_NOT_SUPPORTED],
  reads: union(BOARD.reads, LANDED.reads),
  writes: union(BOARD.writes, LANDED.writes),
  drives: BOARD.drives,
  invokes: BOARD.invokes,
  emits: union(BOARD.emits, LANDED.emits),
  calls: BOARD.calls,
  chain: union(BOARD.chain, [contract_captable.f.closedForExit]),
  spans: BOARD.spans,
});

export const rpc_organizations_equity_grant_options = defineRpc({
  id: "organizations.equity.grant-options",
  title: "Grant options from the pool as one Board proposal",
  about:
    "Row `organizations.equity.grantOptions`, registered as `organizations/equity:grantOptions` (CAP-1182). Signed in. " +
    "The `equity` gate, `requireSafeOwner`, the `landed` note; equity not installed is WRONG_STATE; a stored deployment that " +
    "does not parse is a broken row. organizations.equity.load names the grantee (an address, else an active member's Safe; " +
    "INVALID_INPUT otherwise). `planGrant` dates the vesting from today or `start` and resolves the strike token " +
    "(INVALID_INPUT, TOKEN_NOT_SUPPORTED). The pool is read (`Options.pool`, `allocated`, `classId`); more than it has left " +
    "is POOL_EXCEEDED. organizations.equity.record-grant stores the grant and its Board proposal of `Options.grant` with " +
    "the agreement's hash, keyed by what was asked without today's dates, so the same grant on a later day answers the " +
    "waiting proposal on its original terms.",
  was: [
    `${CONVEX}:22`,
    `${OPS}/grant-options.ts:36`,
    `${OPS}/grant-options.ts:42`,
    `${OPS}/grant-options.ts:43`,
    `${OPS}/grant-options.ts:48`,
    `${OPS}/grant-options.ts:54`,
    `${OPS}/grant-options.ts:58`,
    `${OPS}/grant-options.ts:64`,
    `${OPS}/grant-options.ts:72`,
    `${OPS}/grant-options.ts:73`,
    `${OPS}/grant-options.ts:81`,
    `${OPS}/grant-options.ts:115`,
    `${OPS}/grant-options.ts:124`,
    `${ROWS}:112`,
    `${SCHEMA}:273`,
    `${SCHEMA}:332`,
    `${SRC}/rules/grants.ts:16`,
    `${SRC}/rules.ts:240`,
    `${SRC}/external/options.ts:20`,
    `${SRC}/writes/grants.ts:107`,
    `${EVM}/company-options.ts:1`,
    ...BOARD_WAS,
    ...FACTS_WAS,
    ...LANDED_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({
    orgId: Schema.String,
    to: Schema.String,
    shares: Schema.Number,
    strike: Schema.String,
    strikeToken: Schema.optionalKey(Schema.String),
    vesting: Schema.optionalKey(Schema.Struct({ months: Schema.Number, cliffMonths: Schema.optionalKey(Schema.Number) })),
    start: Schema.optionalKey(Schema.String),
    exerciseWindowDays: Schema.optionalKey(Schema.Number),
    agreementHash: Schema.String,
    note: Schema.optionalKey(Schema.String),
  }),
  /** `OptionsGrantSchema` (equity-schema.ts:332). */
  output: Schema.Struct({
    status: Schema.Literals(["awaiting_approvals", "granted"]),
    grant: Schema.Unknown,
    pool: Schema.Struct({ options: Schema.String, size: Schema.Number, left: Schema.Number }),
    proposal: SafeProposal,
  }),
  errors: [...BOARD_ROW_ERRORS, error_POOL_EXCEEDED, error_TOKEN_NOT_SUPPORTED],
  reads: union(BOARD.reads, LANDED.reads, FACTS.reads),
  writes: union(BOARD.writes, LANDED.writes),
  drives: BOARD.drives,
  invokes: union(BOARD.invokes, FACTS.invokes),
  emits: union(BOARD.emits, LANDED.emits),
  calls: BOARD.calls,
  chain: union(BOARD.chain, [contract_options.f.pool, contract_options.f.allocated, contract_options.f.classId]),
  spans: BOARD.spans,
});

export const rpc_organizations_equity_approve_transfer = defineRpc({
  id: "organizations.equity.approve-transfer",
  title: "The Board approves a share sale Exits holds",
  about:
    "Row `organizations.equity.approveTransfer`, registered as `organizations/equity:approveTransfer` (CAP-1175). Signed in. " +
    "The `equity` gate, `requireSafeOwner`, then organizations.equity.load-transfer for the sale; an unknown sale is " +
    "INVALID_INPUT, one not `offered` (or with no Exits offer id) WRONG_STATE. organizations.equity.record-transfer-approval " +
    "stores one Board proposal of `Exits.approveTransfer(offerId)` (`share_transfer`), or answers the one waiting with the " +
    "same call. Answers `approved` when that proposal already executed; the settlement that sees it execute moves the sale " +
    "to `approved`.",
  was: [
    `${CONVEX}:9`,
    `${OPS}/approve-transfer.ts:24`,
    `${OPS}/approve-transfer.ts:29`,
    `${OPS}/approve-transfer.ts:30`,
    `${OPS}/approve-transfer.ts:35`,
    `${OPS}/approve-transfer.ts:41`,
    `${OPS}/approve-transfer.ts:44`,
    `${OPS}/approve-transfer.ts:46`,
    `${SALE_ROWS}:60`,
    `${SALE_SCHEMA}:47`,
    `${SALE_SCHEMA}:119`,
    `${SRC}/writes/transfer-approvals.ts:83`,
    `${EVM}/company-share-transfers.ts:1`,
    ...BOARD_WAS,
    ...TRANSFER_CONTEXT_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: DIRECTOR,
  input: Schema.Struct({ orgId: Schema.String, transferId: Schema.String }),
  output: Schema.Struct({ status: Schema.Literals(["awaiting_approvals", "approved"]), transfer: ShareTransfer, proposal: SafeProposal }),
  errors: BOARD_ROW_ERRORS,
  reads: union(BOARD.reads, TRANSFER_CONTEXT.reads),
  writes: union(BOARD.writes, [table_org_share_transfers]),
  drives: BOARD.drives,
  invokes: union(BOARD.invokes, TRANSFER_CONTEXT.invokes),
  emits: BOARD.emits,
  calls: BOARD.calls,
  chain: BOARD.chain,
  spans: BOARD.spans,
});

// ── public: reads and the sale ─────────────────────────────────────────────────────────────

export const rpc_organizations_equity_cap_table = defineRpc({
  id: "organizations.equity.cap-table",
  title: "The cap table as the chain holds it",
  about:
    "Row `organizations.equity.capTable`, registered as `organizations/equity:capTable` (CAP-1154). Signed in; anyone in the " +
    "company. organizations.equity.load-cap-table first (so an outsider is refused ROLE_PERMISSION_DENIED before the gate " +
    "says anything), then the `equity` gate; equity not installed is WRONG_STATE. The known holders are the cap table's " +
    "founders, everyone Capxul issued to and the members naming them; per class the Captable's class and its token's supply, " +
    "each holder's balance, and the pool and options allocated. Answers the table as of now.",
  was: [
    `${CONVEX}:20`,
    `${OPS}/cap-table.ts:23`,
    `${OPS}/cap-table.ts:27`,
    `${OPS}/cap-table.ts:28`,
    `${OPS}/cap-table.ts:29`,
    `${OPS}/cap-table.ts:36`,
    `${OPS}/cap-table.ts:41`,
    `${ROWS}:93`,
    `${SCHEMA}:236`,
    `${SCHEMA}:257`,
    `${SRC}/reads/cap-table.ts:35`,
    `${SRC}/reads/cap-table.ts:96`,
    `${SRC}/rules/cap-table.ts:18`,
    `${SRC}/rules/cap-table.ts:72`,
    `${SRC}/external/cap-table.ts:33`,
    ...PROPOSALS_PARTICIPANT_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of the company.",
  input: Schema.Struct({ orgId: Schema.String }),
  /** `CapTableReadSchema` (equity-schema.ts:257): rows by holder and class; too deep to transcribe. */
  output: Schema.Unknown,
  errors: [...READ_ROW_ERRORS, error_WRONG_STATE, error_FEATURE_NOT_AVAILABLE],
  reads: union(PROPOSALS_PARTICIPANT_READS, [table_org_equities, table_org_safe_proposals, table_org_equity_issues]),
  writes: [],
  drives: [],
  invokes: [procedure_access_require_feature_from_action],
  emits: [],
  calls: [integration_chain_rpc.c.fetchEthCall],
  chain: [
    contract_captable.f.getClass,
    contract_share_class.f.totalSupply,
    contract_share_class.f.balanceOf,
    contract_options.f.pool,
    contract_options.f.allocated,
  ],
  spans: spanUnion(ACTION_SPANS, ["chain.read eth_call"]),
});

export const rpc_organizations_equity_sell = defineRpc({
  id: "organizations.equity.sell",
  title: "Offer shares to a buyer from the seller's own Safe",
  about:
    "Row `organizations.equity.sell`, registered as `organizations/equity:sell` (CAP-1217). Signed in. The `equity` gate, " +
    "the `landed` note, then organizations.equity.load-transfer with the buyer's email; no personal Safe is " +
    "SMART_ACCOUNT_MISSING; equity not installed WRONG_STATE; a buyer who is not an active member, the seller's own Safe, an " +
    "unknown class or a bad price INVALID_INPUT. The seller's balance in the class and what vesting still locks are read " +
    "(the class token's `balanceOf`, the Captable's vesting, `Vesting.lockedOf` at the latest block): fewer held is " +
    "INVALID_INPUT, fewer unlocked SHARES_LOCKED. The calls are `Captable.consentToTransfer` and `Exits.offerTransfer` in " +
    "USDC with the agreement's hash, built as the seller's sponsored operation on the sale's own lane; Accounts opens the " +
    "approval (accounts.approvals.openForShareTransfer) and organizations.equity.record-transfer stores the sale. Nothing " +
    "moves until it is signed, the Board approves and the buyer pays.",
  was: [
    `${CONVEX}:15`,
    `${OPS}/sell.ts:42`,
    `${OPS}/sell.ts:47`,
    `${OPS}/sell.ts:51`,
    `${OPS}/sell.ts:52`,
    `${OPS}/sell.ts:57`,
    `${OPS}/sell.ts:65`,
    `${OPS}/sell.ts:67`,
    `${OPS}/sell.ts:81`,
    `${OPS}/sell.ts:87`,
    `${OPS}/sell.ts:89`,
    `${OPS}/sell.ts:92`,
    `${OPS}/sell.ts:104`,
    `${SALE_ROWS}:28`,
    `${SALE_SCHEMA}:31`,
    `${SALE_SCHEMA}:105`,
    `${SRC}/external/transfers.ts:32`,
    `${SRC}/external/holders.ts:43`,
    `${SRC}/external/holders.ts:49`,
    `${SRC}/writes/transfers.ts:120`,
    ...LANDED_WAS,
    ...TRANSFER_CONTEXT_WAS,
    ...SPONSORED_BUILD_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of the company whose personal Safe holds unlocked shares in the class.",
  input: Schema.Struct({
    orgId: Schema.String,
    className: Schema.String,
    to: Schema.String,
    shares: Schema.Number,
    price: Schema.String,
    documentHash: Schema.String,
  }),
  output: Schema.Struct({ transfer: ShareTransfer, approval: Approval }),
  errors: [
    ...READ_ROW_ERRORS,
    error_WRONG_STATE,
    error_SMART_ACCOUNT_MISSING,
    error_INSUFFICIENT_BALANCE,
    error_PROVIDER_RESPONSE_INVALID,
    error_FEATURE_NOT_AVAILABLE,
    error_SHARES_LOCKED,
  ],
  reads: union(LANDED.reads, TRANSFER_CONTEXT.reads),
  writes: union(LANDED.writes, [table_org_share_transfers]),
  drives: [],
  invokes: union([procedure_access_require_feature_from_action], TRANSFER_CONTEXT.invokes),
  emits: LANDED.emits,
  calls: union([integration_chain_rpc.c.fetchEthCall, integration_chain_rpc.c.fetchLatestBlock], SPONSORED_BUILD.calls),
  chain: union(
    [contract_captable.f.getClass, contract_captable.f.vesting, contract_share_class.f.balanceOf, contract_vesting.f.lockedOf],
    SPONSORED_BUILD.chain,
  ),
  spans: spanUnion(ACTION_SPANS, ["chain.read eth_call", "chain.read eth_getBlockByNumber"], SPONSORED_BUILD.spans),
});

export const rpc_organizations_equity_transfer = defineRpc({
  id: "organizations.equity.transfer",
  title: "One share sale, settled from the chain",
  about:
    "Row `organizations.equity.transfer`, registered as `organizations/equity:transfer`. Signed in; any participant. " +
    "organizations.equity.load-transfer by id; an unknown sale is INVALID_INPUT. A `sent` sale is settled " +
    "(`settleSentOffer`): `offered` with Exits' id from the receipt's `TransferOffered`, `failed` when it reverted or no " +
    "receipt came before its sponsorship ended, written through organizations.equity.record-transfer-outcome (which " +
    "reports `sale_requested` for an offer). An unsigned sale past its sponsorship reads `lapsed`.",
  was: [`${CONVEX}:17`, `${OPS}/transfer.ts:20`, `${OPS}/transfer.ts:25`, `${OPS}/transfer.ts:27`, `${OPS}/transfer.ts:29`, `${SALE_ROWS}:47`, `${SRC}/views/transfers.ts:21`, ...TRANSFER_CONTEXT_WAS, ...SETTLE_OFFER_WAS],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of the company.",
  input: Schema.Struct({ orgId: Schema.String, transferId: Schema.String }),
  output: ShareTransfer,
  errors: READ_ROW_ERRORS,
  reads: TRANSFER_CONTEXT.reads,
  writes: SETTLE_OFFER.writes,
  drives: SETTLE_OFFER.drives,
  invokes: TRANSFER_CONTEXT.invokes,
  emits: [event_equity_shares_transitioned],
  calls: SETTLE_OFFER.calls,
  chain: [],
  spans: spanUnion(ACTION_SPANS, SETTLE_OFFER.spans),
});

// ── internal: the sale's send ──────────────────────────────────────────────────────────────

export const rpc_organizations_equity_send_transfer_signed = defineRpc({
  id: "organizations.equity.send-transfer-signed",
  title: "Send a seller's signed offer",
  about:
    "Registered as the internal action `organizations/equity:sendTransferSigned`. Accounts' accounts.approvals.sendApproved " +
    "runs it for an approved `share_transfer` approval. It decodes the stored operation and loads the sale's context; the " +
    "sale must be the caller's, waiting (or `sent`, a resend) and unexpired (WRONG_STATE `staleTransfer`). The `equity` " +
    "gate must still be on; the caller's Safe must be the seller. The operation must be exactly the sale's calls from that " +
    "Safe, signed by the caller's signer (INVALID_INPUT otherwise); a resend must hash to the noted one. A first send " +
    "notes the hash through organizations.equity.record-transfer-outcome (`sent`, which schedules the follow) before " +
    "eth_sendUserOperation." +
    " The send admits only PROVIDER_ERROR and ENV_MISSING: a bundler answer that does not parse, or a hash other than the one noted (PROVIDER_RESPONSE_INVALID), dies as a defect and reaches the caller as UNKNOWN.",
  was: [`${CONVEX}:16`, `${OPS}/send-transfer-signed.ts:45`, `${OPS}/send-transfer-signed.ts:56`, `${OPS}/send-transfer-signed.ts:57`, `${OPS}/send-transfer-signed.ts:60`, `${OPS}/send-transfer-signed.ts:69`, `${OPS}/send-transfer-signed.ts:73`, `${OPS}/send-transfer-signed.ts:86`, `${OPS}/send-transfer-signed.ts:90`, `${OPS}/send-transfer-signed.ts:97`, `${SRC}/external/holders.ts:72`, `${SRC}/external/holders.ts:105`, `${BACKEND}/src/accounts/approvals/operations/send-approved.ts:202`, ...TRANSFER_CONTEXT_WAS, `${SRC}/writes/transfers.ts:48`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: run by Accounts' accounts.approvals.sendApproved once the seller's approval is recorded.",
  input: Schema.Struct({ authUserId: Schema.String, transferId: Schema.String, unsignedUserOpJson: Schema.String, signature: Schema.String }),
  output: Schema.Struct({ userOpHash: Schema.String }),
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE, error_FEATURE_NOT_AVAILABLE, error_PROVIDER_ERROR, error_ENV_MISSING, ...DEFECT],
  reads: TRANSFER_CONTEXT.reads,
  writes: [table_org_share_transfers],
  drives: [machine_org_share_transfer.t.to_sent],
  invokes: union([procedure_access_require_feature_from_action], TRANSFER_CONTEXT.invokes),
  emits: [],
  calls: [integration_chain_rpc.c.sendUserOperation],
  chain: [
    contract_safe_4337_module.f.executeUserOpWithErrorString,
    contract_multi_send_call_only.f.multiSend,
    contract_captable.f.consentToTransfer,
    contract_exits.f.offerTransfer,
  ],
  spans: spanUnion(ACTION_SPANS, ["chain.read eth_sendUserOperation"]),
});

// ── internal: reads ────────────────────────────────────────────────────────────────────────

export const rpc_organizations_equity_load = defineRpc({
  id: "organizations.equity.load",
  title: "A v4 company's equity facts and the members its founders name",
  about:
    "Registered as the internal query `organizations/equity:load`, run by setup, issue, grantOptions, organizations.rounds." +
    "create and `ensureEquityDeployed`. `equityFactsInTx` (see FACTS); a pre-v4 Organization or one without a Party handle " +
    "is WRONG_STATE. It takes no caller and checks none: its callers have already proved a Director, and it answers any " +
    "Organization's facts and members by email.",
  was: [`${CONVEX}:3`, `${OPS}/load.ts:9`, `${OPS}/load.ts:11`, ...FACTS_WAS],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by the equity and rounds Board actions after `requireSafeOwner`.",
  input: Schema.Struct({ orgId: Schema.String, emails: Schema.Array(Schema.String) }),
  /** `EquityFacts` (reads.ts): the company, its install, the equity row and the founders named; summarized. */
  output: Schema.Unknown,
  errors: [error_WRONG_STATE, ...DEFECT],
  reads: FACTS.reads,
  writes: [],
  drives: [],
  invokes: FACTS.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_equity_load_cap_table = defineRpc({
  id: "organizations.equity.load-cap-table",
  title: "The cap table's installed equity, issued-to holders and members",
  about:
    "Registered as the internal query `organizations/equity:loadCapTable`, run by capTable. The participant check, the " +
    "equity row counted installed when `installedAt` is set or its proposal reads executed, the addresses Capxul issued to " +
    "(`orgEquityIssues`) and the Organization's members (to name holders).",
  was: [`${CONVEX}:21`, `${OPS}/load-cap-table.ts:9`, `${OPS}/load-cap-table.ts:14`, `${SRC}/reads/cap-table.ts:35`, `${SRC}/reads/cap-table.ts:80`, ...PROPOSALS_PARTICIPANT_WAS],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by organizations.equity.cap-table for the signed-in caller.",
  input: Schema.Struct({ authUserId: Schema.String, orgId: Schema.String }),
  output: Schema.Unknown,
  errors: [error_ROLE_PERMISSION_DENIED, ...DEFECT],
  reads: union(PROPOSALS_PARTICIPANT_READS, [table_org_equities, table_org_safe_proposals, table_org_equity_issues]),
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_equity_load_transfer = defineRpc({
  id: "organizations.equity.load-transfer",
  title: "A share sale's context: participant, Safe, equity, buyer, the sale",
  about:
    "Registered as the internal query `organizations/equity:loadTransfer`, run by sell, transfer, approveTransfer, the " +
    "send and the follow. The sale an id names; the Organization is the input's or the sale's (neither: INVALID_INPUT). The " +
    "participant check is skipped only for the follow (`settling`) of a `sent` sale. The caller's personal Safe and signer " +
    "and their membership's email, the equity row, and the active member a buyer email names.",
  was: [`${CONVEX}:12`, `${OPS}/load-transfer.ts:11`, `${OPS}/load-transfer.ts:25`, ...TRANSFER_CONTEXT_WAS],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by the share-sale actions for the signed-in caller, and by the follow for the sale's seller.",
  input: Schema.Struct({
    authUserId: Schema.String,
    orgId: Schema.optionalKey(Schema.String),
    buyer: Schema.optionalKey(Schema.String),
    transferId: Schema.optionalKey(Schema.String),
    settling: Schema.optionalKey(Schema.Boolean),
  }),
  /** `TransferContext` (reads/transfers.ts): summarized. */
  output: Schema.Unknown,
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, ...DEFECT],
  reads: TRANSFER_CONTEXT.reads,
  writes: [],
  drives: [],
  invokes: TRANSFER_CONTEXT.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal: writes ───────────────────────────────────────────────────────────────────────

export const rpc_organizations_equity_record = defineRpc({
  id: "organizations.equity.record",
  title: "One step of an equity setup on its row",
  about:
    "Registered as the internal mutation `organizations/equity:record`, run by setup, `ensureEquityDeployed` and every " +
    "equity, rounds and sale action (`landed`). `deploy`: the signed `deployEquity` is stored before its broadcast, the " +
    "first for these terms winning; other terms replace a row whose proposal never ran (a waiting proposal or an " +
    "unresolved send is WRONG_STATE), archiving its clones in `earlier`. `reuse`: an earlier deployment for these terms " +
    "comes back. `clear`: a reverted or lost send is cleared. `deployment`: the receipt's clones, Governor and Captable. " +
    "`propose`: the Board's batch is stored as one proposal (`equity_setup`) with the row naming it; the same batch while " +
    "it waits answers it, another batch is WRONG_STATE. `landed`: what executed is noted once each and reported. Answers " +
    "the row after it and any proposal.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/record.ts:18`,
    `${OPS}/record.ts:72`,
    `${SRC}/writes.ts:80`,
    `${SRC}/writes.ts:99`,
    `${SRC}/writes.ts:115`,
    `${SRC}/writes.ts:138`,
    `${SRC}/writes.ts:175`,
    `${SRC}/writes.ts:213`,
    `${SRC}/writes.ts:269`,
    ...LANDED_WAS,
    ...PROPOSALS_RECORD_OWNER_WAS,
  ],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by the equity actions and the equity deploy.",
  input: Schema.Struct({
    orgId: Schema.String,
    record: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("deploy"),
        transactionHash: Schema.String,
        signedTransaction: Schema.String,
        chainId: Schema.Number,
        safeAddress: Schema.String,
        template: Template,
        termsDigest: Schema.String,
        capTableJson: Schema.String,
      }),
      Schema.Struct({
        kind: Schema.Literal("reuse"),
        deploymentJson: Schema.String,
        deployTxHash: Schema.String,
        governor: Schema.String,
        captable: Schema.String,
        chainId: Schema.Number,
        safeAddress: Schema.String,
        template: Template,
        termsDigest: Schema.String,
        capTableJson: Schema.String,
      }),
      Schema.Struct({ kind: Schema.Literal("clear"), transactionHash: Schema.String }),
      Schema.Struct({
        kind: Schema.Literal("deployment"),
        termsDigest: Schema.String,
        deploymentJson: Schema.String,
        deployTxHash: Schema.String,
        governor: Schema.String,
        captable: Schema.String,
      }),
      Schema.Struct({
        kind: Schema.Literal("propose"),
        termsDigest: Schema.String,
        authUserId: Schema.String,
        owner: Owner,
        calls: Schema.Array(Call),
        note: Schema.String,
        capTableJson: Schema.String,
      }),
      Schema.Struct({ kind: Schema.Literal("landed") }),
    ]),
  }),
  output: Schema.Struct({ equity: Schema.NullOr(Schema.Unknown), proposal: Schema.NullOr(SafeProposal) }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, ...DEFECT],
  reads: LANDED.reads,
  writes: union(LANDED.writes, PROPOSALS_RECORD_OWNER.writes),
  drives: [],
  invokes: [],
  emits: LANDED.emits,
  calls: [],
  chain: [],
  spans: [],
});

/** The record of a Board write and its proposal, in one transaction: the equity row read, then `recordOwnerProposalInTx`. */
const boardRecord = (table: typeof table_org_equity_issues | typeof table_org_safe_rounds | typeof table_org_option_grants) => ({
  reads: [table, table_org_safe_proposals],
  writes: [table, table_org_safe_proposals],
});

export const rpc_organizations_equity_record_issue = defineRpc({
  id: "organizations.equity.record-issue",
  title: "Store an issue of shares and the Board proposal that carries it",
  about:
    "Registered as the internal mutation `organizations/equity:recordIssue`, run by issue. An earlier issue with the same " +
    "call digest whose proposal still waits answers that proposal; else `recordOwnerProposalInTx` stores the proposal " +
    "(`equity_issue`) and the issue row is inserted with it. Refusals from the proposal store (INVALID_INPUT, WRONG_STATE).",
  was: [`${CONVEX}:8`, `${OPS}/record-issue.ts:9`, `${OPS}/record-issue.ts:34`, `${SRC}/writes/issues.ts:36`, `${SRC}/writes/issues.ts:41`, `${SRC}/writes/issues.ts:56`, `${SRC}/writes/issues.ts:68`, `${SRC}/writes/issues.ts:71`, `${SRC}/writes/issues.ts:88`, ...PROPOSALS_RECORD_OWNER_WAS],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.equity.issue.",
  input: Schema.Struct({
    orgId: Schema.String,
    authUserId: Schema.String,
    owner: Owner,
    callDigest: Schema.String,
    call: Call,
    note: Schema.String,
    classId: Schema.Number,
    className: Schema.String,
    to: Schema.String,
    email: Schema.optionalKey(Schema.String),
    shares: Schema.Number,
    reasonHash: Schema.String,
  }),
  output: SafeProposal,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, ...DEFECT],
  ...boardRecord(table_org_equity_issues),
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_equity_record_safe_round = defineRpc({
  id: "organizations.equity.record-safe-round",
  title: "Store a SAFE round and the Board proposal that opens it",
  about:
    "Registered as the internal mutation `organizations/equity:recordSafeRound`, run by createSafeRound. A waiting round " +
    "with the same call digest answers its proposal; else the proposal (`safe_round`) and the round (`sr_` id from the " +
    "digest and the count of earlier rounds) are stored together.",
  was: [`${CONVEX}:19`, `${OPS}/record-safe-round.ts:9`, `${OPS}/record-safe-round.ts:34`, `${SRC}/writes/safe-rounds.ts:38`, `${SRC}/writes/safe-rounds.ts:83`, `${SRC}/writes/safe-rounds.ts:101`, ...PROPOSALS_RECORD_OWNER_WAS],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.equity.create-safe-round.",
  input: Schema.Struct({
    orgId: Schema.String,
    authUserId: Schema.String,
    owner: Owner,
    callDigest: Schema.String,
    call: Call,
    note: Schema.String,
    token: Schema.String,
    cap: Schema.Number,
    discountPct: Schema.Number,
    raise: Schema.Number,
    closes: Schema.String,
    termsHash: Schema.String,
  }),
  output: Schema.Struct({ safeRoundId: Schema.String, proposal: SafeProposal }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, ...DEFECT],
  ...boardRecord(table_org_safe_rounds),
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_equity_record_grant = defineRpc({
  id: "organizations.equity.record-grant",
  title: "Store an option grant and the Board proposal that carries it",
  about:
    "Registered as the internal mutation `organizations/equity:recordGrant`, run by grantOptions. A waiting grant with the " +
    "same request digest answers its proposal with its original terms; else the proposal (`equity_grant`) and the grant " +
    "(`og_` id from the proposal's) are stored together.",
  was: [`${CONVEX}:23`, `${OPS}/record-grant.ts:9`, `${OPS}/record-grant.ts:33`, `${SRC}/writes/grants.ts:36`, `${SRC}/writes/grants.ts:76`, `${SRC}/writes/grants.ts:92`, `${SRC}/rules.ts:240`, ...PROPOSALS_RECORD_OWNER_WAS],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.equity.grant-options.",
  input: Schema.Struct({
    orgId: Schema.String,
    authUserId: Schema.String,
    owner: Owner,
    requestDigest: Schema.String,
    call: Call,
    note: Schema.String,
    grantee: Schema.String,
    email: Schema.optionalKey(Schema.String),
    shares: Schema.Number,
    termsJson: Schema.String,
    agreementHash: Schema.String,
  }),
  output: Schema.Struct({ proposal: SafeProposal, termsJson: Schema.String }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, ...DEFECT],
  ...boardRecord(table_org_option_grants),
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_equity_record_transfer = defineRpc({
  id: "organizations.equity.record-transfer",
  title: "Store a share sale with the approval its seller signs",
  about:
    "Registered as the internal mutation `organizations/equity:recordTransfer`, run by sell after Accounts opened the " +
    "approval. Inserts the sale born `awaiting_approval` (a birth has no transition).",
  was: [`${CONVEX}:13`, `${OPS}/record-transfer.ts:11`, `${OPS}/record-transfer.ts:34`, `${SRC}/writes/transfers.ts:38`, `${SRC}/writes/transfers.ts:120`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.equity.sell.",
  input: Schema.Struct({
    transferId: Schema.String,
    orgId: Schema.String,
    chainId: Schema.Number,
    authUserId: Schema.String,
    classId: Schema.Number,
    className: Schema.String,
    seller: SaleParty,
    buyer: SaleParty,
    shares: Schema.Number,
    price: Schema.String,
    priceUnits: Schema.String,
    token: Schema.String,
    documentHash: Schema.String,
    calls: Schema.Array(Call),
    approvalId: Schema.String,
    expiresAt: Schema.Number,
    createdAt: Schema.Number,
  }),
  output: Schema.Void,
  errors: DEFECT,
  reads: [],
  writes: [table_org_share_transfers],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_equity_record_transfer_approval = defineRpc({
  id: "organizations.equity.record-transfer-approval",
  title: "Store the Board's proposal approving a sale, reused while it waits",
  about:
    "Registered as the internal mutation `organizations/equity:recordTransferApproval`, run by approveTransfer. A sale not " +
    "this Organization's is INVALID_INPUT, one not `offered` WRONG_STATE. The sale's latest Board proposal with the same " +
    "call while it waits is answered; else `recordOwnerProposalInTx` stores a new one (`share_transfer`) and the sale's " +
    "`boardProposalId` points at it.",
  was: [`${CONVEX}:10`, `${OPS}/record-transfer-approval.ts:9`, `${OPS}/record-transfer-approval.ts:27`, `${SRC}/writes/transfer-approvals.ts:31`, `${SRC}/writes/transfer-approvals.ts:37`, `${SRC}/writes/transfer-approvals.ts:46`, `${SRC}/writes/transfer-approvals.ts:61`, `${SRC}/writes/transfer-approvals.ts:66`, ...PROPOSALS_RECORD_OWNER_WAS],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.equity.approve-transfer.",
  input: Schema.Struct({ transferId: Schema.String, authUserId: Schema.String, owner: Owner, call: Call, note: Schema.String }),
  output: SafeProposal,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, ...DEFECT],
  reads: [table_org_share_transfers, table_org_safe_proposals],
  writes: [table_org_share_transfers, table_org_safe_proposals],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_equity_record_transfer_outcome = defineRpc({
  id: "organizations.equity.record-transfer-outcome",
  title: "Note an offer's send, then what the chain answered",
  about:
    "Registered as the internal mutation `organizations/equity:recordTransferOutcome`, run by the send and `settleSentOffer`. " +
    "An unknown sale is INVALID_INPUT; an offered or failed one is left as it is. `sent` is noted once and schedules " +
    "organizations.equity.follow-transfer after 15 s of business time. `offered` stores Exits' offer id and reports " +
    "`equity_shares_transitioned` (`sale_requested`) as the seller; `failed` reports nothing.",
  was: [`${CONVEX}:14`, `${OPS}/record-transfer-outcome.ts:9`, `${OPS}/record-transfer-outcome.ts:21`, `${SRC}/writes/transfers.ts:24`, `${SRC}/writes/transfers.ts:48`, `${SRC}/writes/transfers.ts:57`, `${SRC}/writes/transfers.ts:61`, `${SRC}/writes/transfers.ts:70`, `${SRC}/writes/transfers.ts:79`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.equity.send-transfer-signed and offer settlement.",
  input: Schema.Struct({
    transferId: Schema.String,
    outcome: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("sent"), userOpHash: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("offered"), offerId: Schema.String, at: Schema.Number }),
      Schema.Struct({ kind: Schema.Literal("failed"), at: Schema.Number }),
    ]),
  }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, ...DEFECT],
  reads: [table_org_share_transfers],
  writes: [table_org_share_transfers],
  drives: [machine_org_share_transfer.t.to_sent, machine_org_share_transfer.t.to_offered, machine_org_share_transfer.t.to_failed],
  invokes: [],
  emits: [event_equity_shares_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── telemetry plumbing ─────────────────────────────────────────────────────────────────────

export const rpc_organizations_equity_emit_shares_transitioned = defineRpc({
  id: "organizations.equity.emit-shares-transitioned",
  title: "Deliver one equity_shares_transitioned event",
  about:
    "Telemetry plumbing: registered as the internal action `organizations/equity:emitSharesTransitioned`. Scheduled " +
    "(`scheduleTelemetryEmit`) by the write that noted it: an install (`equity_set_up`) or an issue (`issued`) landed, a " +
    "sale offered (`sale_requested`) or approved (`transfer_approved`). Posts the event awaited as the proposing Director " +
    "(or the seller) in their Organization, keyed `equity_shares_transitioned:<proposalId>`. It reads and writes no table.",
  was: [`${CONVEX}:6`, `${OPS}/emit-shares-transitioned.ts:10`, `${SRC}/events.ts:21`, `${SRC}/events.ts:44`, `${SRC}/events.ts:52`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by the equity writes and the proposal settlement.",
  input: Schema.Struct({
    transition: Schema.Literals(["equity_set_up", "issued", "sale_requested", "transfer_approved"]),
    organizationId: Schema.String,
    authUserId: Schema.String,
    proposalId: Schema.String,
    occurredAt: Schema.Number,
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_equity_shares_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_equity_emit_grant_transitioned = defineRpc({
  id: "organizations.equity.emit-grant-transitioned",
  title: "Deliver one equity_grant_transitioned event",
  about:
    "Telemetry plumbing: registered as the internal action `organizations/equity:emitGrantTransitioned`. Scheduled when an " +
    "option grant's Board proposal is noted executed (`granted`). Posts the event as the proposing Director, keyed " +
    "`equity_grant_transitioned:<grantId>:granted`. It reads and writes no table.",
  was: [`${CONVEX}:24`, `${OPS}/emit-grant-transitioned.ts:9`, `${SRC}/events.ts:105`, `${SRC}/events.ts:113`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by the landed-equity note.",
  input: Schema.Struct({
    transition: Schema.Literal("granted"),
    organizationId: Schema.String,
    authUserId: Schema.String,
    grantId: Schema.String,
    proposalId: Schema.String,
    occurredAt: Schema.Number,
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_equity_grant_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflow ───────────────────────────────────────────────────────────────────────────────

export const workflow_organizations_equity_follow_transfer = defineWorkflow({
  id: "organizations.equity.follow-transfer",
  title: "Follow a sent offer until Exits holds it or it fails",
  about:
    "Registered as the internal action `organizations/equity:followTransfer`, recorded as the system job " +
    "`share_transfer_follow`. organizations.equity.record-transfer-outcome schedules it 15 s of business time after it notes " +
    "`sent`. Each run loads the sale (`settling`, so a seller who lost their Seat still has it settled) and, while `sent`, " +
    "`settleSentOffer`; a PROVIDER_ERROR leaves it `sent`, another failure ends the run. Still `sent`: schedules itself in " +
    "15 s with attempt + 1, with no cap. Timeout is Convex's action limit; the code sets none.",
  was: [`${CONVEX}:11`, `${OPS}/follow-transfer.ts:36`, `${OPS}/follow-transfer.ts:43`, `${OPS}/follow-transfer.ts:44`, `${OPS}/follow-transfer.ts:51`, `${OPS}/follow-transfer.ts:62`, ...TRANSFER_CONTEXT_WAS, ...SETTLE_OFFER_WAS],
  concept: concept_organizations,
  priority: "normal",
  trigger: { after: rpc_organizations_equity_record_transfer_outcome },
  instance: { per: table_org_share_transfers },
  waits: [{ name: "receipt", for: "chain", about: "Re-reads the offer's receipt every 15 s of business time until the sale settles." }],
  steps: [
    { name: "attribute", about: "Records the run as the system job `share_transfer_follow`." },
    { name: "load", about: "Runs organizations.equity.load-transfer with `settling`; a sale not `sent` ends the run." },
    { name: "settle", about: "`settleSentOffer`, writing `offered` or `failed` through organizations.equity.record-transfer-outcome." },
    { name: "again", about: "Still `sent` (or a provider error): schedules itself in 15 s with attempt + 1." },
  ],
  reads: TRANSFER_CONTEXT.reads,
  writes: SETTLE_OFFER.writes,
  drives: SETTLE_OFFER.drives,
  invokes: TRANSFER_CONTEXT.invokes,
  emits: [event_equity_shares_transitioned],
  calls: SETTLE_OFFER.calls,
  chain: [],
  idempotency: "A sale no longer `sent` ends the run; the outcome mutation leaves an offered or failed sale as it is.",
  timeoutMs: 600_000,
  retries: { max: 0, backoff: "fixed" },
});

/** Shared with rounds.ts, whose create runs the same load, landed note and headroom read. */
export const EQUITY_FACTS = FACTS;
export const EQUITY_FACTS_WAS = FACTS_WAS;
export const EQUITY_LANDED = LANDED;
export const EQUITY_LANDED_WAS = LANDED_WAS;
export const EQUITY_HEADROOM_READS = HEADROOM_READS;
