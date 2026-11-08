// The as-is book of the old organizations concept: the directors area (a v4 company's Board).
//
// Every operation registered at `organizations/directors:*` (packages/backend/convex/organizations/
// directors.ts). Seven are public actions that implement a row of `directors` (packages/protocol/src/
// organizations/director-operations.ts); the rest are internal. follow and notify are scheduled by
// organizations.directors.record-outcome, so they are workflows; emitBoardTransitioned is telemetry
// plumbing. Every Board change is the caller's own sponsored UserOperation, never a Board proposal.
//
// Touches follow proposals.ts: a public action lists what this concept's internal rpcs it runs touch;
// Accounts' accounts.approvals.openForDirectorChange, which every write runs to open the approval, is
// named in `about` and booked by Accounts. `chain` lists the contract functions read over eth_call, and
// for the send what the operation executes.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";

import { concept_organizations } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_board_seat_transitioned,
  event_board_threshold_transitioned,
} from "../shared/vocabulary.ts";
import {
  contract_hats,
  contract_hats_signer_gate,
  contract_multi_send_call_only,
  contract_safe_4337_module,
  integration_chain_rpc,
  integration_mail,
} from "../shared/external.ts";
import {
  machine_org_director_change,
  table_org_director_changes,
  table_org_equities,
  table_org_safe_proposals,
  table_orgs,
} from "./data.ts";
import { procedure_accounts_read_workspace_setup_signer_in_tx } from "../accounts/procedures.ts";
import { procedure_parties_party_by_id } from "../parties/procedures.ts";
import {
  Approval,
  PROPOSALS_PARTICIPANT_READS,
  PROPOSALS_PARTICIPANT_WAS,
  SPONSORED_BUILD,
  SPONSORED_BUILD_WAS,
  spanUnion,
  union,
} from "./proposals.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/organizations/directors.ts`;
const ORG = `${BACKEND}/src/organizations`;
const SRC = `${ORG}/directors`;
const OPS = `${SRC}/operations`;
const ROWS = "packages/protocol/src/organizations/director-operations.ts";
const SCHEMA = "packages/protocol/src/organizations/director-schema.ts";
const EVM = "packages/protocol/src/evm";

// ── errors ─────────────────────────────────────────────────────────────────────────────────

const DEFECT = [error_UNKNOWN];

/** Each Board write's row: CALL, DEFECTS, PARTICIPANT, STATE, CHAIN and its own four (director-operations.ts:32). */
const WRITE_ROW_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_UNKNOWN,
  error_ENV_MISSING,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
  error_PROVIDER_ERROR,
  error_SMART_ACCOUNT_MISSING,
  error_INSUFFICIENT_BALANCE,
  error_PROVIDER_RESPONSE_INVALID,
];

/** `get` (director-operations.ts:191): CALL, DEFECTS, PARTICIPANT, CHAIN, ENV_MISSING. */
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
 * `directorContextInTx` (reads.ts:123): the change an id names, the participant check, the Organization, the
 * caller's personal Safe and signer (Accounts), the member an email names, the stored changes for that member,
 * the threshold changes and the newest 20 Board changes, the newest change's time (the stale-plan fence), the
 * company install, the Governor once the equity setup's proposal executed, and for a refresh or claim every
 * member holding a personal Safe.
 */
const LOAD = {
  reads: union(PROPOSALS_PARTICIPANT_READS, [table_org_director_changes, table_org_equities, table_org_safe_proposals]),
  invokes: [procedure_accounts_read_workspace_setup_signer_in_tx],
};
const LOAD_WAS = [
  `${SRC}/reads.ts:58`,
  `${SRC}/reads.ts:82`,
  `${SRC}/reads.ts:102`,
  `${SRC}/reads.ts:123`,
  `${SRC}/reads.ts:129`,
  `${SRC}/reads.ts:132`,
  `${SRC}/reads.ts:136`,
  `${SRC}/reads.ts:144`,
  `${SRC}/reads.ts:149`,
  `${SRC}/reads.ts:155`,
  `${SRC}/reads.ts:174`,
  `${SRC}/reads.ts:175`,
  `${SRC}/reads.ts:187`,
  `${SRC}/reads.ts:209`,
  `${SRC}/reads.ts:228`,
  `${ORG}/equity/reads.ts:46`,
  `${ORG}/equity/reads.ts:59`,
  `${ORG}/reads/organizations.ts:73`,
  `${BACKEND}/src/accounts/reads/workspaces.ts:76`,
  ...PROPOSALS_PARTICIPANT_WAS,
];

/** The Board as each plan reads it: the company Safe's owners, the Director hat, top-hat wearing, the Gate's signers and config. */
const BOARD_READS = [
  contract_hats.f.viewHat,
  contract_hats.f.isWearerOfHat,
  contract_hats_signer_gate.f.isValidSigner,
  contract_hats_signer_gate.f.thresholdConfig,
];
const PLAN_CALLS = [integration_chain_rpc.c.fetchSafeOwners, integration_chain_rpc.c.fetchEthCall];
const PLAN_SPANS = ["chain.read eth_call"];

/**
 * `openChange` (writes.ts:216): build the sponsored operation on the change's own lane, read its sponsorship's
 * end, have Accounts open the approval (accounts.approvals.openForDirectorChange), then store the change with
 * organizations.directors.record. A stop in between leaves an approval with no change, which sends nothing.
 */
const OPEN = {
  reads: [table_org_director_changes],
  writes: [table_org_director_changes],
  calls: SPONSORED_BUILD.calls,
  chain: SPONSORED_BUILD.chain,
  spans: SPONSORED_BUILD.spans,
};
const OPEN_WAS = [
  `${SRC}/writes.ts:174`,
  `${SRC}/writes.ts:216`,
  `${SRC}/writes.ts:229`,
  `${SRC}/writes.ts:235`,
  `${SRC}/writes.ts:240`,
  `${SRC}/writes.ts:270`,
  `${SRC}/external.ts:148`,
  `${SRC}/external.ts:156`,
  `${SRC}/external.ts:162`,
  `${SRC}/guards.ts:12`,
  `${SRC}/guards.ts:18`,
  ...SPONSORED_BUILD_WAS,
];

/**
 * `recordChangeOutcome` (writes.ts:130): the send noted once (and the follow scheduled), then the chain's answer;
 * a landed change schedules its board event, a seat by `add` its notice.
 */
const OUTCOME = {
  reads: [table_org_director_changes],
  writes: [table_org_director_changes],
  drives: [
    machine_org_director_change.t.to_sent,
    machine_org_director_change.t.to_seated,
    machine_org_director_change.t.to_set,
    machine_org_director_change.t.to_removed,
    machine_org_director_change.t.to_handed_over,
    machine_org_director_change.t.to_failed,
  ],
  emits: [event_board_seat_transitioned, event_board_threshold_transitioned],
};
const OUTCOME_WAS = [
  `${SRC}/writes.ts:130`,
  `${SRC}/writes.ts:135`,
  `${SRC}/writes.ts:139`,
  `${SRC}/writes.ts:143`,
  `${SRC}/writes.ts:152`,
  `${SRC}/writes.ts:158`,
  `${SRC}/writes.ts:170`,
  `${SRC}/events.ts:66`,
  `${SRC}/events.ts:90`,
];

/**
 * `settleSent` (external/settle.ts:86): a `sent` change's receipt and its block's time; a seat by `add` also needs
 * the member's Safe to sign the company Safe now. Landed or failed (or no receipt past its sponsorship) is written
 * through organizations.directors.record-outcome; otherwise it stays `sent`.
 */
const SETTLE_SENT = {
  calls: [integration_chain_rpc.c.fetchUserOperationReceipt, integration_chain_rpc.c.fetchBlockTimestamp, ...PLAN_CALLS],
  chain: [contract_hats_signer_gate.f.isValidSigner],
  spans: ["chain.read eth_getUserOperationReceipt", "chain.read eth_getBlockByNumber", "chain.read eth_call"],
};
const SETTLE_SENT_WAS = [
  `${SRC}/external/settle.ts:22`,
  `${SRC}/external/settle.ts:50`,
  `${SRC}/external/settle.ts:63`,
  `${SRC}/external/settle.ts:86`,
  `${SRC}/external/settle.ts:243`,
];

const ACTION_SPANS = ["convex.query", "convex.mutation", "chain.attempt <upstream>"];

const Person = Schema.Struct({ name: Schema.NullOr(Schema.String), email: Schema.String, safe: Schema.String });
const LapsedPerson = Schema.Struct({ name: Schema.NullOr(Schema.String), email: Schema.NullOr(Schema.String), safe: Schema.String });
const Call = Schema.Struct({ to: Schema.String, value: Schema.String, data: Schema.String });
const Threshold = Schema.Struct({ needed: Schema.Number, of: Schema.Number });

/** `DirectorChangeSchema` (director-schema.ts:107): a Board change as callers read it; `lapsed` is read from its expiry. */
const DirectorChange = Schema.Struct({
  changeId: Schema.String,
  orgId: Schema.String,
  chainId: Schema.Number,
  safeAddress: Schema.String,
  action: Schema.Literals(["add", "remove", "threshold", "handover", "refresh", "claim"]),
  status: Schema.Literals(["awaiting_approval", "sent", "seated", "set", "removed", "handed_over", "failed", "lapsed"]),
  person: Schema.NullOr(LapsedPerson),
  removed: Schema.Array(LapsedPerson),
  signer: Schema.String,
  directors: Schema.Struct({ before: Schema.Number, after: Schema.Number }),
  threshold: Threshold,
  thresholdBefore: Threshold,
  calls: Schema.Array(Call),
  approvalId: Schema.String,
  userOpHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
});
/** `DirectorChangeOpenedSchema` (director-schema.ts:143): the change and the approval it opened. */
const DirectorChangeOpened = Schema.Struct({ ...DirectorChange.fields, approval: Approval });

/** A Board write's touches: load, plan reads, open and record. */
const WRITE = {
  reads: union(LOAD.reads, OPEN.reads),
  writes: OPEN.writes,
  invokes: LOAD.invokes,
  calls: union(PLAN_CALLS, OPEN.calls),
  spans: spanUnion(ACTION_SPANS, PLAN_SPANS, OPEN.spans),
};

const TOP_HAT = "A signed-in current Seat of a v4 company whose claimed personal Safe wears the Shareholders' top hat (the founder, before elections).";

// ── public actions ─────────────────────────────────────────────────────────────────────────

export const rpc_organizations_directors_add = defineRpc({
  id: "organizations.directors.add",
  title: "Seat a member as a Director from the Shareholders' top hat",
  about:
    "Row `organizations.directors.add`, registered as the public action `organizations/directors:add` (CAP-1150). Signed " +
    "in. organizations.directors.load reads the context with the member's email; a pre-v4 Organization is WRONG_STATE; a " +
    "caller without a personal Safe is SMART_ACCOUNT_MISSING. `readSeatChain` reads the company Safe's owners, the Director " +
    "hat, whether the caller wears the Shareholders' top hat and the member the Director hat, whether the Gate counts the " +
    "member and each owner, and the Gate's threshold config. `planSeat` refuses a caller without the top hat " +
    "(ROLE_PERMISSION_DENIED), elections deciding the Directors, a member who is not one (INVALID_INPUT), has no Safe, " +
    "already signs, or has a seat change under way (WRONG_STATE); else the calls are one more seat on the hat when every " +
    "seat is worn, the hat minted to the member's Safe, and the Gate's `claimSignerFor`. `openChange` builds and opens the " +
    "founder's approval; organizations.directors.record stores the change, refusing a clashing or stale Board change. " +
    "Nothing changes until it is signed. Answers the change with its approval.",
  was: [
    `${CONVEX}:6`,
    `${OPS}/add.ts:28`,
    `${OPS}/add.ts:33`,
    `${OPS}/add.ts:34`,
    `${OPS}/add.ts:35`,
    `${OPS}/add.ts:36`,
    `${OPS}/add.ts:44`,
    `${OPS}/add.ts:57`,
    `${ROWS}:32`,
    `${SCHEMA}:14`,
    `${SCHEMA}:143`,
    `${SRC}/external.ts:66`,
    `${SRC}/rules.ts:154`,
    `${EVM}/board-directors.ts:19`,
    ...LOAD_WAS,
    ...OPEN_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: TOP_HAT,
  input: Schema.Struct({ orgId: Schema.String, person: Schema.String }),
  output: DirectorChangeOpened,
  errors: WRITE_ROW_ERRORS,
  reads: WRITE.reads,
  writes: WRITE.writes,
  drives: [],
  invokes: WRITE.invokes,
  emits: [],
  calls: WRITE.calls,
  chain: union(BOARD_READS, OPEN.chain),
  spans: WRITE.spans,
});

export const rpc_organizations_directors_remove = defineRpc({
  id: "organizations.directors.remove",
  title: "Remove a Director from the Shareholders' top hat",
  about:
    "Row `organizations.directors.remove`, registered as `organizations/directors:remove` (CAP-1151). Signed in. Load, the " +
    "company and the caller's Safe, `readSeatChain`. `planRemove` refuses a caller without the top hat " +
    "(ROLE_PERMISSION_DENIED), elections, a person who is not a Director, the last Director, a threshold the Gate would " +
    "then require above the Directors left, or another Board change under way (WRONG_STATE). The calls rule the Director's " +
    "Safe no longer eligible on Hats (which burns the hat; their standing stays good) and have the Gate `removeSigner` it, " +
    "which recomputes the company Safe's threshold. `openChange` and organizations.directors.record as for add. Once it " +
    "lands it is `removed`, and `board_seat_transitioned` reports it.",
  was: [
    `${CONVEX}:18`,
    `${OPS}/remove.ts:30`,
    `${OPS}/remove.ts:36`,
    `${OPS}/remove.ts:38`,
    `${OPS}/remove.ts:46`,
    `${OPS}/remove.ts:59`,
    `${ROWS}:62`,
    `${SRC}/rules.ts:206`,
    ...LOAD_WAS,
    ...OPEN_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: TOP_HAT,
  input: Schema.Struct({ orgId: Schema.String, person: Schema.String }),
  output: DirectorChangeOpened,
  errors: WRITE_ROW_ERRORS,
  reads: WRITE.reads,
  writes: WRITE.writes,
  drives: [],
  invokes: WRITE.invokes,
  emits: [],
  calls: WRITE.calls,
  chain: union(BOARD_READS, OPEN.chain),
  spans: WRITE.spans,
});

export const rpc_organizations_directors_set_threshold = defineRpc({
  id: "organizations.directors.set-threshold",
  title: "Set how many Directors must sign every Board batch",
  about:
    "Row `organizations.directors.setThreshold`, registered as `organizations/directors:setThreshold` (CAP-1172). Signed in. " +
    "Load, the company and the caller's Safe. `readThresholdChain` reads the owners, how many the Gate counts, whether the " +
    "caller wears the top hat (the Gate's owner hat) and the Gate's config. `planThreshold` refuses a caller without the " +
    "top hat (ROLE_PERMISSION_DENIED), a threshold out of range, above the signers, or unchanged (INVALID_INPUT), or " +
    "another threshold change under way (WRONG_STATE). The one call is the Gate's `setThresholdConfig` with ABSOLUTE " +
    "`{min: n, target: n}`; it is never a Board proposal (the Gate refuses a threshold change the company Safe makes). " +
    "`openChange` and organizations.directors.record as for add.",
  was: [
    `${CONVEX}:20`,
    `${OPS}/set-threshold.ts:28`,
    `${OPS}/set-threshold.ts:34`,
    `${OPS}/set-threshold.ts:36`,
    `${OPS}/set-threshold.ts:43`,
    `${OPS}/set-threshold.ts:53`,
    `${ROWS}:91`,
    `${SCHEMA}:25`,
    `${SRC}/external/threshold.ts:31`,
    `${SRC}/rules.ts:260`,
    `${EVM}/company-gate.ts:15`,
    ...LOAD_WAS,
    ...OPEN_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: TOP_HAT,
  input: Schema.Struct({ orgId: Schema.String, threshold: Schema.Number }),
  output: DirectorChangeOpened,
  errors: WRITE_ROW_ERRORS,
  reads: WRITE.reads,
  writes: WRITE.writes,
  drives: [],
  invokes: WRITE.invokes,
  emits: [],
  calls: WRITE.calls,
  chain: union(
    [contract_hats.f.isWearerOfHat, contract_hats_signer_gate.f.isValidSigner, contract_hats_signer_gate.f.thresholdConfig],
    OPEN.chain,
  ),
  spans: WRITE.spans,
});

export const rpc_organizations_directors_handover = defineRpc({
  id: "organizations.directors.handover",
  title: "Hand a v4 company's Board to its shareholders' Governor",
  about:
    "Row `organizations.directors.handover`, registered as `organizations/directors:handover`. Signed in. Load (which reads " +
    "the Governor once the equity setup's Board proposal executed, from `orgEquities` and the proposal's status), the " +
    "company and the caller's Safe. `readHandoverChain` reads the threshold chain and the Director hat's eligibility. " +
    "`planHandover` refuses a caller without the top hat (ROLE_PERMISSION_DENIED), equity not installed, a Board already " +
    "handed over, or another Board change under way (WRONG_STATE). The calls are `buildEquity`'s founder calls: the " +
    "Director hat's eligibility and toggle to the Governor, then the top hat itself (`transferHat`), so votes seat " +
    "Directors from then on. `openChange` and organizations.directors.record as for add.",
  was: [
    `${CONVEX}:11`,
    `${OPS}/handover.ts:28`,
    `${OPS}/handover.ts:34`,
    `${OPS}/handover.ts:36`,
    `${OPS}/handover.ts:43`,
    `${OPS}/handover.ts:54`,
    `${ROWS}:120`,
    `${SCHEMA}:33`,
    `${SRC}/external/handover.ts:18`,
    `${SRC}/rules/handover.ts:37`,
    `${SRC}/errors/handover.ts:1`,
    `${EVM}/board-handover.ts:13`,
    ...LOAD_WAS,
    ...OPEN_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: TOP_HAT,
  input: Schema.Struct({ orgId: Schema.String }),
  output: DirectorChangeOpened,
  errors: WRITE_ROW_ERRORS,
  reads: WRITE.reads,
  writes: WRITE.writes,
  drives: [],
  invokes: WRITE.invokes,
  emits: [],
  calls: WRITE.calls,
  chain: union(BOARD_READS, OPEN.chain),
  spans: WRITE.spans,
});

export const rpc_organizations_directors_refresh = defineRpc({
  id: "organizations.directors.refresh",
  title: "Drop every Board signer whose Director hat lapsed",
  about:
    "Row `organizations.directors.refresh`, registered as `organizations/directors:refresh` (CAP-1152). Signed in; any " +
    "current Seat may, since the Gate lets anyone remove a lapsed signer. Load with the members' Safes, the company and " +
    "the caller's Safe. `readRefreshChain` reads each owner with whether the Gate still counts it, and the Gate's config. " +
    "`planRefresh` refuses nobody lapsed, every Director lapsed, or another Board change under way (WRONG_STATE). The " +
    "calls are the Gate's `removeSigner` for each lapsed owner, which recomputes the threshold; a lapsed Safe no member " +
    "holds has no name or email. `openChange` and organizations.directors.record as for add. Once it lands it is " +
    "`removed`, and `board_seat_transitioned` reports `lapsed`.",
  was: [
    `${CONVEX}:17`,
    `${OPS}/refresh.ts:28`,
    `${OPS}/refresh.ts:33`,
    `${OPS}/refresh.ts:36`,
    `${OPS}/refresh.ts:42`,
    `${OPS}/refresh.ts:52`,
    `${ROWS}:146`,
    `${SCHEMA}:41`,
    `${SRC}/external.ts:119`,
    `${SRC}/rules/refresh.ts:35`,
    `${SRC}/errors/refresh.ts:1`,
    ...LOAD_WAS,
    ...OPEN_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of a v4 company with a claimed personal Safe.",
  input: Schema.Struct({ orgId: Schema.String }),
  output: DirectorChangeOpened,
  errors: WRITE_ROW_ERRORS,
  reads: WRITE.reads,
  writes: WRITE.writes,
  drives: [],
  invokes: WRITE.invokes,
  emits: [],
  calls: WRITE.calls,
  chain: union([contract_hats_signer_gate.f.isValidSigner, contract_hats_signer_gate.f.thresholdConfig], OPEN.chain),
  spans: WRITE.spans,
});

export const rpc_organizations_directors_claim = defineRpc({
  id: "organizations.directors.claim",
  title: "An elected Director claims their Board seat",
  about:
    "Row `organizations.directors.claim`, registered as `organizations/directors:claim` (CAP-1149). Signed in. Load with " +
    "the members' Safes, the company and the caller's Safe, `readSeatChain` for the caller's own Safe. `planClaim` refuses " +
    "a Safe that does not wear the Director hat (ROLE_PERMISSION_DENIED), one that already signs, or another Board change " +
    "under way (WRONG_STATE). The one call is the Gate's `claimSigner`, which makes the Safe an owner and recomputes the " +
    "threshold. `openChange` and organizations.directors.record as for add; once the Safe signs it is `seated` and " +
    "`board_seat_transitioned` reports `claimed`.",
  was: [
    `${CONVEX}:7`,
    `${OPS}/claim.ts:26`,
    `${OPS}/claim.ts:29`,
    `${OPS}/claim.ts:33`,
    `${OPS}/claim.ts:42`,
    `${OPS}/claim.ts:52`,
    `${ROWS}:173`,
    `${SCHEMA}:51`,
    `${SRC}/rules/claim.ts:29`,
    `${SRC}/errors/claim.ts:1`,
    ...LOAD_WAS,
    ...OPEN_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of a v4 company whose claimed personal Safe wears the Director hat but does not sign the company Safe yet.",
  input: Schema.Struct({ orgId: Schema.String }),
  output: DirectorChangeOpened,
  errors: WRITE_ROW_ERRORS,
  reads: WRITE.reads,
  writes: WRITE.writes,
  drives: [],
  invokes: WRITE.invokes,
  emits: [],
  calls: WRITE.calls,
  chain: union(BOARD_READS, OPEN.chain),
  spans: WRITE.spans,
});

export const rpc_organizations_directors_get = defineRpc({
  id: "organizations.directors.get",
  title: "One Board change, its status settled from the chain",
  about:
    "Row `organizations.directors.get`, registered as `organizations/directors:get`. Signed in; any current participant. " +
    "Load with the change id; an id the Organization does not hold is INVALID_INPUT (`changeNotFound`). A `sent` change " +
    "is settled (`settleSent`): its receipt and block time, and for a seat whether the member's Safe now signs; a landed " +
    "or failed answer, or no receipt past the sponsorship, is written through organizations.directors.record-outcome (so " +
    "this read can write, and schedule the board event and the seat's notice). An unsigned change past its lapse reads " +
    "`lapsed`. A stored row without the company install or a seat without its person is a broken row (UNKNOWN).",
  was: [`${CONVEX}:10`, `${OPS}/get.ts:20`, `${OPS}/get.ts:25`, `${OPS}/get.ts:27`, `${OPS}/get.ts:29`, `${ROWS}:191`, `${SCHEMA}:58`, `${SRC}/rules.ts:144`, ...LOAD_WAS, ...SETTLE_SENT_WAS, ...OUTCOME_WAS],
  concept: concept_organizations,
  kind: "action",
  who: "A signed-in current Seat of the Organization.",
  input: Schema.Struct({ orgId: Schema.String, changeId: Schema.String }),
  output: DirectorChange,
  errors: READ_ROW_ERRORS,
  reads: LOAD.reads,
  writes: OUTCOME.writes,
  drives: OUTCOME.drives.filter((t) => t !== machine_org_director_change.t.to_sent),
  invokes: LOAD.invokes,
  emits: OUTCOME.emits,
  calls: SETTLE_SENT.calls,
  chain: SETTLE_SENT.chain,
  spans: spanUnion(ACTION_SPANS, SETTLE_SENT.spans),
});

// ── internal ───────────────────────────────────────────────────────────────────────────────

export const rpc_organizations_directors_send_signed = defineRpc({
  id: "organizations.directors.send-signed",
  title: "Send a Board change's signed operation",
  about:
    "Registered as the internal action `organizations/directors:sendSigned`. Accounts' accounts.approvals.sendApproved runs " +
    "it (`runAction`) for an approved `director_change` approval. It decodes the stored unsigned operation and loads the " +
    "change's context. The change must be the caller's, still `awaiting_approval` (or `sent`, a resend after the bundler " +
    "did not answer) and unexpired, and its signer the caller's Safe, else WRONG_STATE `staleChange`. `admitSeat`: Base " +
    "Sepolia only, exactly the change's calls from that Safe, no factory, a signature recovering to the caller's signer " +
    "(INVALID_INPUT otherwise); a resend must hash to the noted operation. A first send notes the hash through " +
    "organizations.directors.record-outcome (`sent`, which schedules the follow) before eth_sendUserOperation, which must " +
    "acknowledge that hash. No feature gate is checked." +
    " The send admits only PROVIDER_ERROR and ENV_MISSING: a bundler answer that does not parse, or a hash other than the one noted (PROVIDER_RESPONSE_INVALID), dies as a defect and reaches the caller as UNKNOWN.",
  was: [
    `${CONVEX}:19`,
    `${OPS}/send-signed.ts:45`,
    `${OPS}/send-signed.ts:59`,
    `${OPS}/send-signed.ts:60`,
    `${OPS}/send-signed.ts:64`,
    `${OPS}/send-signed.ts:72`,
    `${OPS}/send-signed.ts:74`,
    `${OPS}/send-signed.ts:86`,
    `${OPS}/send-signed.ts:90`,
    `${OPS}/send-signed.ts:97`,
    `${SRC}/external.ts:187`,
    `${SRC}/external.ts:219`,
    `${BACKEND}/src/accounts/approvals/operations/send-approved.ts:144`,
    ...LOAD_WAS,
    ...OUTCOME_WAS,
  ],
  concept: concept_organizations,
  kind: "action",
  who: "internal: run by Accounts' accounts.approvals.sendApproved once the change's approval is recorded.",
  input: Schema.Struct({
    authUserId: Schema.String,
    changeId: Schema.String,
    unsignedUserOpJson: Schema.String,
    signature: Schema.String,
  }),
  output: Schema.Struct({ userOpHash: Schema.String }),
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE, error_SMART_ACCOUNT_MISSING, error_PROVIDER_ERROR, error_ENV_MISSING, ...DEFECT],
  reads: LOAD.reads,
  writes: OUTCOME.writes,
  drives: [machine_org_director_change.t.to_sent],
  invokes: LOAD.invokes,
  emits: [],
  calls: [integration_chain_rpc.c.sendUserOperation],
  chain: [
    contract_safe_4337_module.f.executeUserOpWithErrorString,
    contract_multi_send_call_only.f.multiSend,
    contract_hats.f.mintHat,
    contract_hats.f.changeHatMaxSupply,
    contract_hats.f.setHatWearerStatus,
    contract_hats.f.changeHatEligibility,
    contract_hats.f.changeHatToggle,
    contract_hats.f.transferHat,
    contract_hats_signer_gate.f.claimSigner,
    contract_hats_signer_gate.f.claimSignerFor,
    contract_hats_signer_gate.f.removeSigner,
    contract_hats_signer_gate.f.setThresholdConfig,
  ],
  spans: spanUnion(ACTION_SPANS, ["chain.read eth_sendUserOperation"]),
});

export const rpc_organizations_directors_load = defineRpc({
  id: "organizations.directors.load",
  title: "The Board actions' context: participant, Safe, company, member, changes",
  about:
    "Registered as the internal query `organizations/directors:load`; every directors action runs it through " +
    "`readContext`. `directorContextInTx` (see LOAD): the Organization is the input's or the named change's (neither: " +
    "INVALID_INPUT); a missing Organization and a non-member are alike ROLE_PERMISSION_DENIED; a vanished Organization " +
    "row is UNKNOWN. Marks the Organization verified on the wide event.",
  was: [`${CONVEX}:12`, `${OPS}/load.ts:11`, `${OPS}/load.ts:22`, ...LOAD_WAS],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by the directors actions for the signed-in caller, and by the follow workflow for the change's author.",
  input: Schema.Struct({
    authUserId: Schema.String,
    orgId: Schema.optionalKey(Schema.String),
    person: Schema.optionalKey(Schema.String),
    changeId: Schema.optionalKey(Schema.String),
    members: Schema.optionalKey(Schema.Boolean),
  }),
  /** `DirectorContext` (reads.ts:25): too wide to transcribe; its stored rows are summarized. */
  output: Schema.Unknown,
  errors: [error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, ...DEFECT],
  reads: LOAD.reads,
  writes: [],
  drives: [],
  invokes: LOAD.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_directors_record = defineRpc({
  id: "organizations.directors.record",
  title: "Store a Board change with the approval its signer signs",
  about:
    "Registered as the internal mutation `organizations/directors:record`, run by `openChange` after the approval opened. " +
    "`insertChange` refuses, in the writing transaction, any Board-wide change (remove, refresh, claim, handover) while " +
    "another change is under way, a change when a Board-wide change was stored after the plan read the Board (`boardChanged`), " +
    "and a second change for the same member or a second threshold change under way (all WRONG_STATE). The row is born " +
    "`awaiting_approval` (a birth has no transition in the machine).",
  was: [`${CONVEX}:15`, `${OPS}/record.ts:11`, `${OPS}/record.ts:49`, `${SRC}/writes.ts:37`, `${SRC}/writes.ts:47`, `${SRC}/writes.ts:65`, `${SRC}/writes.ts:71`, `${SRC}/writes.ts:80`, `${SRC}/writes.ts:91`, `${SRC}/rules.ts:139`],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by the directors write actions.",
  input: Schema.Struct({
    changeId: Schema.String,
    orgId: Schema.String,
    chainId: Schema.Number,
    safeAddress: Schema.String,
    authUserId: Schema.String,
    action: Schema.Literals(["add", "remove", "threshold", "handover", "refresh", "claim"]),
    person: Schema.optionalKey(Person),
    removed: Schema.optionalKey(Schema.Array(LapsedPerson)),
    signer: Schema.String,
    directorsBefore: Schema.Number,
    directorsAfter: Schema.Number,
    thresholdNeeded: Schema.Number,
    thresholdBefore: Schema.optionalKey(Schema.Number),
    calls: Schema.Array(Call),
    approvalId: Schema.String,
    expiresAt: Schema.Number,
    createdAt: Schema.Number,
    boardSeenAt: Schema.optionalKey(Schema.Number),
  }),
  output: Schema.Void,
  errors: [error_WRONG_STATE, ...DEFECT],
  reads: [table_org_director_changes],
  writes: [table_org_director_changes],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_directors_record_outcome = defineRpc({
  id: "organizations.directors.record-outcome",
  title: "Note a Board change's send, then what the chain answered",
  about:
    "Registered as the internal mutation `organizations/directors:recordOutcome`, run by send-signed (`sent`) and by " +
    "`settleSent` from get and the follow workflow. An unknown change is INVALID_INPUT; a settled one is left as it is. " +
    "`sent` is noted once with the hash and schedules organizations.directors.follow after 15 s of business time. A landed " +
    "outcome is written with its time and schedules organizations.directors.emit-board-transitioned (seated, claimed, " +
    "removed, lapsed for a refresh, handed_over, or set); a seat by `add` also schedules organizations.directors.notify. " +
    "`failed` reports nothing.",
  was: [`${CONVEX}:16`, `${OPS}/record-outcome.ts:9`, `${OPS}/record-outcome.ts:29`, ...OUTCOME_WAS],
  concept: concept_organizations,
  kind: "mutation",
  who: "internal: run by organizations.directors.send-signed, organizations.directors.get and the follow workflow.",
  input: Schema.Struct({
    changeId: Schema.String,
    outcome: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("sent"), userOpHash: Schema.String }),
      Schema.Struct({ kind: Schema.Literals(["seated", "set", "removed", "handed_over", "failed"]), at: Schema.Number }),
    ]),
  }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, ...DEFECT],
  reads: OUTCOME.reads,
  writes: OUTCOME.writes,
  drives: OUTCOME.drives,
  invokes: [],
  emits: OUTCOME.emits,
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_directors_notice_facts = defineRpc({
  id: "organizations.directors.notice-facts",
  title: "What a seated Director's email is built from",
  about:
    "Registered as the internal query `organizations/directors:noticeFacts`, run by the notify workflow. Null unless the " +
    "change is `seated` and names a person; else the Organization's name, its Party's handle (or the orgId), the email, " +
    "and the Board after the seat (threshold and owners).",
  was: [`${CONVEX}:13`, `${OPS}/notice-facts.ts:12`, `${OPS}/notice-facts.ts:20`, `${SRC}/reads.ts:239`, `${SRC}/reads.ts:249`],
  concept: concept_organizations,
  kind: "query",
  who: "internal: run by the organizations.directors.notify workflow.",
  input: Schema.Struct({ changeId: Schema.String }),
  output: Schema.NullOr(
    Schema.Struct({
      orgId: Schema.String,
      organizationName: Schema.String,
      organizationHandle: Schema.String,
      email: Schema.String,
      threshold: Schema.Number,
      owners: Schema.Number,
    }),
  ),
  errors: DEFECT,
  reads: [table_org_director_changes, table_orgs],
  writes: [],
  drives: [],
  invokes: [procedure_parties_party_by_id],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_organizations_directors_emit_board_transitioned = defineRpc({
  id: "organizations.directors.emit-board-transitioned",
  title: "Deliver one landed Board change's event",
  about:
    "Telemetry plumbing: registered as the internal action `organizations/directors:emitBoardTransitioned`. " +
    "organizations.directors.record-outcome schedules it (`scheduleTelemetryEmit`) for a landed change. It posts " +
    "`board_threshold_transitioned` (`set`) or `board_seat_transitioned` (seated, claimed, removed with removed 1, lapsed " +
    "with the count removed, handed_over) as the change's author in its Organization, annotating the change id. It reads " +
    "and writes no table.",
  was: [`${CONVEX}:8`, `${OPS}/emit-board-transitioned.ts:13`, `${SRC}/events.ts:42`, `${SRC}/events.ts:90`, `${SRC}/events.ts:122`],
  concept: concept_organizations,
  kind: "action",
  who: "internal: scheduled by organizations.directors.record-outcome for a landed Board change.",
  input: Schema.Struct({
    changeId: Schema.String,
    orgId: Schema.String,
    authUserId: Schema.String,
    kind: Schema.Literals(["seated", "claimed", "removed", "lapsed", "handed_over", "set"]),
    removed: Schema.optionalKey(Schema.Number),
    directorsAfter: Schema.Number,
    thresholdBefore: Schema.optionalKey(Schema.Number),
    thresholdAfter: Schema.Number,
    occurredAt: Schema.Number,
    /** The client's observation hint (`observationContextValidator`): summarized. */
    observationContext: Schema.optionalKey(Schema.Unknown),
  }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_board_seat_transitioned, event_board_threshold_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflows ──────────────────────────────────────────────────────────────────────────────

export const workflow_organizations_directors_follow = defineWorkflow({
  id: "organizations.directors.follow",
  title: "Follow a sent Board change to the chain with no client asking",
  about:
    "Registered as the internal action `organizations/directors:follow`, recorded as the system job `director_follow`. " +
    "organizations.directors.record-outcome schedules it 15 s of business time after it notes `sent`. Each run loads the " +
    "change's context as its author (so an author who lost their Seat stops it with ROLE_PERMISSION_DENIED) and, while it " +
    "is `sent`, settles it from the chain; a PROVIDER_ERROR leaves it `sent`, any other failure ends the run. While still " +
    "`sent` it schedules itself again in 15 s with attempt + 1, with no cap: the sponsorship's end decides `failed` at the " +
    "latest. Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:9`,
    `${OPS}/follow.ts:36`,
    `${OPS}/follow.ts:43`,
    `${OPS}/follow.ts:44`,
    `${OPS}/follow.ts:48`,
    `${OPS}/follow.ts:51`,
    `${OPS}/follow.ts:57`,
    `${SRC}/writes.ts:105`,
    `${SRC}/writes.ts:143`,
    ...LOAD_WAS,
    ...SETTLE_SENT_WAS,
  ],
  concept: concept_organizations,
  priority: "normal",
  trigger: { after: rpc_organizations_directors_record_outcome },
  instance: { per: table_org_director_changes },
  waits: [{ name: "receipt", for: "chain", about: "Re-reads the operation's receipt every 15 s of business time until the change settles." }],
  steps: [
    { name: "attribute", about: "Records the run as the system job `director_follow`." },
    { name: "load", about: "Runs organizations.directors.load for the change; a change not `sent` ends the run." },
    { name: "settle", about: "`settleSent`; a landed or failed answer is written through organizations.directors.record-outcome." },
    { name: "again", about: "Still `sent` (or a provider error): schedules itself in 15 s with attempt + 1." },
  ],
  reads: LOAD.reads,
  writes: OUTCOME.writes,
  drives: OUTCOME.drives.filter((t) => t !== machine_org_director_change.t.to_sent),
  invokes: LOAD.invokes,
  emits: OUTCOME.emits,
  calls: SETTLE_SENT.calls,
  chain: SETTLE_SENT.chain,
  idempotency: "A change no longer `sent` ends the run; record-outcome keeps a settled change's end.",
  timeoutMs: 600_000,
  retries: { max: 0, backoff: "fixed" },
});

export const workflow_organizations_directors_notify = defineWorkflow({
  id: "organizations.directors.notify",
  title: "Tell a member they are now a Director",
  about:
    "Registered as the internal action `organizations/directors:notify`; the entry loads Resend. Recorded as the system job " +
    "`director_notices`. organizations.directors.record-outcome schedules it with `runAfter(0)` when a seat by `add` lands " +
    "`seated`. It runs organizations.directors.notice-facts; null sends nothing. The `owner-added` email goes to the member " +
    "through the mail owner under notice key `organizations.directors.notify:<changeId>:seated`; a recipient the provider " +
    "did not take is retried by scheduling itself again (1 min, then 4 min, three attempts in all). A failed send never " +
    "stops or repeats the seat. Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:4`,
    `${CONVEX}:14`,
    `${OPS}/notify.ts:40`,
    `${OPS}/notify.ts:51`,
    `${OPS}/notify.ts:53`,
    `${OPS}/notify.ts:60`,
    `${OPS}/notify.ts:80`,
    `${SRC}/writes.ts:168`,
    `${BACKEND}/src/integrations/mail/notices.ts:17`,
    `${BACKEND}/src/integrations/mail/notices.ts:20`,
  ],
  concept: concept_organizations,
  priority: "normal",
  trigger: { transition: machine_org_director_change.t.to_seated },
  instance: { per: table_org_director_changes },
  steps: [
    { name: "attribute", about: "Records the run as the system job `director_notices`." },
    { name: "facts", about: "Runs organizations.directors.notice-facts; null ends the run with nothing sent." },
    { name: "deliver", about: "`deliverNotices` of the `owner-added` email to the seated member." },
    { name: "retry", about: "Recipients not taken: schedules itself by business delay (1 min, then 4 min) with `only` set." },
  ],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_mail.c.deliverNotices],
  chain: [],
  idempotency: "None stops a resend: the notice key only names the delivery record, and a retry sends only to `only`.",
  timeoutMs: 600_000,
  retries: { max: 2, backoff: "exponential" },
});
