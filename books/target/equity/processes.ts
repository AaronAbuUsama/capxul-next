// Equity's durable work (A3, rules.durable-processes): one process per long-lived object, each the only
// writer of its object's status after its birth and of the outcomes of the writes about it, plus one
// small process per write that changes no long-lived object. Every process follows its writes'
// carriers (an approval's end, from `approval_transitioned`; a Board proposal's, from
// `proposal_transitioned`; both through the outbox), then the transaction's indexed facts at the
// deployment's finality depth: a write lands only when they hold its own clone event, fails when the
// operation reverted or ran without it, and is abandoned when its carrier ended unsent. Timers run by
// the chain's clock. No cron: nothing here sweeps.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_equity } from "../shared/foundation.ts";
import {
  contract_captable,
  contract_installer,
  contract_options,
  contract_vesting,
  integration_chain_rpc,
  integration_indexer,
  integration_service_signer,
} from "../shared/external.ts";
import { table_approvals } from "../approvals/data.ts";
import { procedure_approvals_withdraw } from "../approvals/procedures.ts";
import { table_chain_deployments, table_chain_logs, table_equity_positions } from "../indexing/data.ts";
import {
  machine_equity_grant,
  machine_equity_install,
  machine_equity_write,
  machine_fundraise_investment,
  machine_fundraise_round,
  machine_share_sale,
  machine_vote,
  table_equity_grants,
  table_equity_installs,
  table_equity_writes,
  table_fundraise_investments,
  table_fundraise_rounds,
  table_share_sales,
  table_votes,
} from "./data.ts";
import { rpc_equity_grants_accept, rpc_equity_grants_end, rpc_equity_grants_exercise } from "./grants.ts";
import { rpc_equity_investments_commit, rpc_equity_investments_pay, rpc_equity_investments_sign } from "./investments.ts";
import {
  rpc_equity_rounds_allocate,
  rpc_equity_rounds_cancel,
  rpc_equity_rounds_close,
  rpc_equity_rounds_invite,
} from "./rounds.ts";
import { rpc_equity_safes_close, rpc_equity_safes_invite } from "./safes.ts";
import { rpc_equity_sales_approve } from "./sales.ts";
import { rpc_equity_votes_cast, rpc_equity_votes_execute } from "./votes.ts";
import { OLD } from "./guards.ts";
import { procedure_board_propose } from "../board/procedures.ts";

const MINUTE = 60_000;
const w = machine_equity_write.t;

/** The write outcomes every deciding process drives. */
const DECIDE = [w.land, w.fail, w.abandon] as const;

/** Reading a carrier's transaction at finality: the calls every deciding process makes. */
const FACTS = [integration_indexer.c.awaitBlock, integration_indexer.c.factsOf] as const;

/** How a deciding process waits on its writes' carriers. */
const CARRIER_WAITS = [
  {
    name: "carrier",
    for: "person" as const,
    about: "A holder signs or declines their approval, or the Directors approve or reject the Board proposal; approval_transitioned or proposal_transitioned, routed by opener equity and the write as subject, resumes it.",
  },
  {
    name: "executed",
    for: "chain" as const,
    about: "The carrier's operation or Safe transaction lands, reverts or is displaced, as approvals and board report it on chain proof (opener equity, the write as subject).",
  },
  {
    name: "indexed",
    for: "indexer" as const,
    timeoutMs: 10 * MINUTE,
    about: "Ponder has indexed the carrier's transaction (by chain and hash) at finality, so its clone events can be read (awaitBlock, then factsOf).",
  },
];

/** The step every deciding process takes for each of its writes. */
const DECIDE_STEP = {
  name: "decide-write",
  about:
    "On a carrier's end: factsOf its transaction; the write's own event lands it (with its PaymentSent id when it paid), a " +
    "revert or its absence fails it, an unsent end abandons it; the object moves in the same transaction.",
};

const COMPENSATION =
  "None: it writes only equity's own rows, from chain facts read at the finality depth, which Capxul never undoes. A step " +
  "that fails after its retries leaves the object where its last committed step put it, and the step runs again on resume.";

// ── installs ────────────────────────────────────────────────────────────────────────────────

export const workflow_equity_installs_setup = defineWorkflow({
  id: "equity.installs.setup",
  title: "One equity install, from its deployment to the Board's batch landing",
  about:
    "Started by the install's birth (equity-install.begin, through the outbox), one instance per install. (1) It has " +
    "Companies House's tier key send `Installer.deployEquity` with the plan's classes and Governor settings, once: the " +
    "signed bytes and their hash are recorded before broadcast, so a lost answer is looked up, never sent again, and " +
    "while it has no receipt the install stays `deploying` and other terms are refused. A reverted deployment fails the " +
    "install. (2) When EquityDeployed for the company Safe is indexed at finality (the clones in indexing's " +
    "chain-deployments), it reads the Board's batch from `Installer.buildEquity` (per founder `setIssuerAllowance` and " +
    "`Vesting.grantAndIssue`, then `setIssuerAllowance` and `Options.setPool` for the pool) and, in one transaction, " +
    "opens it through `board.propose` as the Director who began it, with the install's write (`equity_set_up`) and each " +
    "founder's vesting grant born `proposed` with its own write on the same proposal (equity-grant.propose), and moves " +
    "the install to `proposed`. (3) It decides the install's write when the proposal ends: landed is `installed`, a " +
    "failed batch `failed` (reverted, or a proposal board ended `failed`: batch_reverted), a rejected or replaced one `abandoned`. `buildEquity`'s founder calls (the Shareholders' " +
    "tree to the Governor) are not sent yet, as the designed text says. Replaces old organizations' setup action, its " +
    "record-landed mutation and the deployment it re-read on every equity answer.",
  was: [`${OLD}/equity/operations/setup.ts`, `${OLD}/equity/operations/record.ts`, `${OLD}/equity/writes/landed.ts:30`, "books/as-is/organizations/equity.ts:222"],
  concept: concept_equity,
  priority: "low",
  trigger: { transition: machine_equity_install.t.begin },
  instance: { per: table_equity_installs },
  waits: [
    { name: "deploy-receipt", for: "chain", about: "deployEquity's receipt, through the service signer's one send and its lookup." },
    { name: "deployed", for: "indexer", timeoutMs: 10 * MINUTE, about: "EquityDeployed for the company Safe, indexed at finality." },
    ...CARRIER_WAITS,
  ],
  steps: [
    { name: "deploy", about: "Sends deployEquity with the tier key once, recorded before broadcast; waits for its receipt." },
    { name: "build", about: "Reads Installer.buildEquity for the clones and the plan: the batch the Board approves." },
    { name: "propose", about: "One transaction: board.propose, the install's write, each founder's grant and its write; install.propose." },
    DECIDE_STEP,
  ],
  reads: [table_equity_installs, table_equity_writes, table_chain_deployments, table_approvals],
  writes: [table_equity_installs, table_equity_writes, table_equity_grants],
  drives: [
    machine_equity_install.t.propose,
    machine_equity_install.t.install,
    machine_equity_install.t.fail,
    machine_equity_install.t.abandon,
    machine_equity_grant.t.propose,
    w.open,
    ...DECIDE,
  ],
  invokes: [procedure_board_propose],
  emits: [],
  calls: [
    integration_service_signer.c.send,
    integration_service_signer.c.waitForReceipt,
    integration_chain_rpc.c.readContract,
    ...FACTS,
  ],
  chain: [
    contract_installer.f.deployEquity,
    contract_installer.f.buildEquity,
    contract_captable.f.setIssuerAllowance,
    contract_vesting.f.grantAndIssue,
    contract_options.f.setPool,
  ],
  idempotency:
    "One instance per install_id. deployEquity is sent once per install (its hash is recorded first); the batch is " +
    "proposed once (its write's request digest); each write is decided once, by write_id; a status the machine has left is not entered again.",
  timeoutMs: 2 * MINUTE,
  retries: { max: 5, backoff: "exponential" },
  compensation:
    "None on chain: a deployment whose batch the Board rejects leaves unused clones, which a new setup does not reuse. " +
    COMPENSATION,
  budget: { ...budget("background"), excludes: ["wait.person", "chain.confirm"] },
});

// ── grants ──────────────────────────────────────────────────────────────────────────────────

export const workflow_equity_grants_lifecycle = defineWorkflow({
  id: "equity.grants.lifecycle",
  title: "One grant's process, from its proposal to its end",
  about:
    "Started by the grant's birth (equity-grant.propose, through the outbox), one instance per grant, and the only " +
    "writer of the grant's status after its birth and of its writes' outcomes. The end, accept and exercise rpcs " +
    "signal it when they open a write. An option grant's write landing with OptionsGranted for its agreement's hash " +
    "offers it (recording the uint256 id); a founder's write in the install batch landing with Granted vests it; the " +
    "grantee's accept write lands it active with OptionsAccepted; the Board's end write ends it with OptionsEnded (or " +
    "Revoked and RevocationSettled) and records the last day and the day exercise ends; an exercise write lands with " +
    "Exercised and its PaymentSent and moves no status. Its timer at offer_expires_at lapses an offer nobody accepted. " +
    "When it lapses, ends with nothing exercisable, or is abandoned, each awaiting write's unsigned approval is withdrawn " +
    "(`approvals.withdraw`) and the write abandoned; the instance ends at the grant's expiry or once nothing more can " +
    "happen. Replaces old organizations' grant settlement and its emit action.",
  was: [`${OLD}/equity/operations/record-grant.ts`, `${OLD}/equity/operations/emit-grant-transitioned.ts`, `${OLD}/equity/writes/grants.ts`],
  concept: concept_equity,
  priority: "low",
  trigger: { transition: machine_equity_grant.t.propose },
  instance: { per: table_equity_grants },
  signals: [rpc_equity_grants_end, rpc_equity_grants_accept, rpc_equity_grants_exercise],
  waits: [
    ...CARRIER_WAITS,
    { name: "offer-expiry", for: "timer", about: "offer_expires_at, while the offer waits for its grantee." },
    { name: "expiry", for: "timer", about: "exercise_by after an end, else expires_at: when nothing more can be exercised." },
  ],
  steps: [
    DECIDE_STEP,
    { name: "lapse", about: "At offer_expires_at by the chain's clock, an offer with no landed accept: equity-grant.lapse." },
    { name: "withdraw-carriers", about: "When the grant can no longer change, unsigned approvals of its awaiting writes are withdrawn and the writes abandoned." },
    { name: "close", about: "Ends the instance at expiry, or once the grant is lapsed or abandoned and no write awaits." },
  ],
  reads: [table_equity_grants, table_equity_writes, table_approvals, table_equity_positions],
  writes: [table_equity_grants, table_equity_writes],
  drives: [
    machine_equity_grant.t.offer,
    machine_equity_grant.t.vest,
    machine_equity_grant.t.accept,
    machine_equity_grant.t.end,
    machine_equity_grant.t.lapse,
    machine_equity_grant.t.abandon,
    ...DECIDE,
  ],
  invokes: [procedure_approvals_withdraw],
  emits: [],
  calls: [...FACTS, integration_chain_rpc.c.getBlock],
  chain: [],
  idempotency:
    "One instance per grant_id. Each write is decided once, by write_id; each chain event applies once, by its log; the " +
    "lapse timer fires once per grant.",
  timeoutMs: 2 * MINUTE,
  retries: { max: 5, backoff: "exponential" },
  compensation: COMPENSATION,
  budget: { ...budget("background"), excludes: ["wait.person", "chain.confirm"] },
});

// ── rounds ──────────────────────────────────────────────────────────────────────────────────

const r = machine_fundraise_round.t;
const v = machine_fundraise_investment.t;

export const workflow_equity_rounds_lifecycle = defineWorkflow({
  id: "equity.rounds.lifecycle",
  title: "One round's process, with its investors, from its proposal to its close",
  about:
    "Started by the round's birth (fundraise-round.propose, through the outbox), one instance per round, and the only " +
    "writer of the round's status, its investors' statuses and its writes' outcomes after their births. The Board's " +
    "invite, allocate, close and cancel rpcs and the investors' commit, pay and sign rpcs signal it when they open a " +
    "write. Each landing moves what its event names: PricedRoundCreated or SafeRoundCreated opens the round (recording " +
    "its uint256 id); Invited or SafeInvited invites each investor; Committed commits one; Allocated allocates the round " +
    "and each investor; Paid pays one and SafeSigned signs one (with its note id and PaymentSent id); RoundClosed or " +
    "SafeRoundClosed closes the round (keeping its adjustments) and lapses every investor not paid or signed; " +
    "RoundCancelled cancels it and abandons its investors. Its timers, by the chain's clock, lapse a priced round's " +
    "unpaid investors at its pay-by day and a SAFE round's unsigned ones at its close day. When the round ends, each " +
    "awaiting write's unsigned approval is withdrawn (`approvals.withdraw`) and the write abandoned. Replaces old " +
    "organizations' round and SAFE-round settlement and their emit action.",
  was: [`${OLD}/rounds/operations/record-create.ts`, `${OLD}/rounds/operations/emit-round-transitioned.ts`, `${OLD}/equity/operations/record-safe-round.ts`],
  concept: concept_equity,
  priority: "low",
  trigger: { transition: r.propose },
  instance: { per: table_fundraise_rounds },
  signals: [
    rpc_equity_rounds_invite,
    rpc_equity_rounds_allocate,
    rpc_equity_rounds_close,
    rpc_equity_rounds_cancel,
    rpc_equity_safes_invite,
    rpc_equity_safes_close,
    rpc_equity_investments_commit,
    rpc_equity_investments_pay,
    rpc_equity_investments_sign,
  ],
  waits: [
    ...CARRIER_WAITS,
    { name: "pay-by", for: "timer", about: "A priced round's pay-by day: allocated investors who did not pay lapse." },
    { name: "close-day", for: "timer", about: "A SAFE round's last day to sign: invited investors who did not sign lapse." },
  ],
  steps: [
    DECIDE_STEP,
    { name: "lapse", about: "At the pay-by or close day by the chain's clock, every investor not paid or signed: fundraise-investment.lapse." },
    { name: "withdraw-carriers", about: "When the round ends, unsigned approvals of its awaiting writes are withdrawn and the writes abandoned." },
    { name: "close", about: "Ends the instance once the round is closed, cancelled or abandoned and no write awaits." },
  ],
  reads: [table_fundraise_rounds, table_fundraise_investments, table_equity_writes, table_approvals, table_equity_positions],
  writes: [table_fundraise_rounds, table_fundraise_investments, table_equity_writes],
  drives: [r.open, r.allocate, r.close, r.cancel, r.abandon, v.invite, v.commit, v.allocate, v.pay, v.sign, v.lapse, v.abandon, ...DECIDE],
  invokes: [procedure_approvals_withdraw],
  emits: [],
  calls: [...FACTS, integration_chain_rpc.c.getBlock],
  chain: [],
  idempotency:
    "One instance per round_id. Each write is decided once, by write_id; each Rounds event applies once, by its log; a " +
    "timer fires once per round and day.",
  timeoutMs: 2 * MINUTE,
  retries: { max: 5, backoff: "exponential" },
  compensation: COMPENSATION,
  budget: { ...budget("background"), excludes: ["wait.person", "chain.confirm"] },
});

// ── sales ───────────────────────────────────────────────────────────────────────────────────

const s = machine_share_sale.t;

export const workflow_equity_sales_lifecycle = defineWorkflow({
  id: "equity.sales.lifecycle",
  title: "One share sale's process, from the seller's request to the buyer's purchase",
  about:
    "Started by the sale's birth (share-sale.request, through the outbox), one instance per sale, and the only writer " +
    "of its status and its writes' outcomes. The Board's approve rpc and the buyer's pay rpc signal it. The seller's " +
    "write landing with TransferConsented and TransferOffered offers it (recording the offer's uint256 id); the Board's " +
    "write landing with TransferApproved approves it; the buyer's write landing with Bought, ForcedTransfer and its " +
    "PaymentSent buys it. A seller's write that fails or ends unsent abandons it. Its timer at expires_at lapses an " +
    "offer the buyer has not bought, withdrawing any unsigned approval of an awaiting write. Replaces old organizations' " +
    "follow-transfer workflow and its record-outcome mutations.",
  was: [`${OLD}/equity/operations/follow-transfer.ts`, `${OLD}/equity/operations/record-transfer-outcome.ts`, `${OLD}/equity/writes/transfer-settlements.ts`],
  concept: concept_equity,
  priority: "low",
  trigger: { transition: s.request },
  instance: { per: table_share_sales },
  signals: [rpc_equity_sales_approve, rpc_equity_investments_pay],
  waits: [...CARRIER_WAITS, { name: "expiry", for: "timer", about: "expires_at, while the offer waits for the Board or the buyer." }],
  steps: [
    DECIDE_STEP,
    { name: "lapse", about: "At expires_at by the chain's clock, a sale not bought: share-sale.lapse, and its unsigned carriers withdrawn." },
    { name: "close", about: "Ends the instance once the sale is bought, lapsed or abandoned and no write awaits." },
  ],
  reads: [table_share_sales, table_equity_writes, table_approvals],
  writes: [table_share_sales, table_equity_writes],
  drives: [s.offer, s.approve, s.buy, s.lapse, s.abandon, ...DECIDE],
  invokes: [procedure_approvals_withdraw],
  emits: [],
  calls: [...FACTS, integration_chain_rpc.c.getBlock],
  chain: [],
  idempotency: "One instance per sale_id. Each write is decided once, by write_id; the expiry timer fires once per sale.",
  timeoutMs: 2 * MINUTE,
  retries: { max: 5, backoff: "exponential" },
  compensation: COMPENSATION,
  budget: { ...budget("background"), excludes: ["wait.person", "chain.confirm"] },
});

// ── votes ───────────────────────────────────────────────────────────────────────────────────

export const workflow_equity_votes_lifecycle = defineWorkflow({
  id: "equity.votes.lifecycle",
  title: "One vote's process, from its proposer's approval to its execution",
  about:
    "Started by the vote's birth (vote.propose, through the outbox), one instance per vote, and the only writer of the " +
    "vote's status and of its propose, ballot and execute writes' outcomes. The cast and execute rpcs signal it. The " +
    "propose write landing with ProposalCreated for the vote's proposal id opens it (recording voteStart and voteEnd); " +
    "ending unsigned lapses it; reverting fails it. A ballot lands with its own VoteCast (support and weight); an " +
    "execution with ProposalExecuted. It also follows ProposalExecuted for its proposal whoever sent it, so a vote " +
    "executed outside Capxul reads executed, and abandons any execution still awaiting then. The Governor's standing, " +
    "tally and quorum are never copied. The instance ends once the vote is executed, lapsed or failed, or once the " +
    "Governor holds it defeated, canceled or expired and no write awaits. Replaces old organizations' vote, ballot and " +
    "execution follow workflows and their record-outcome mutations.",
  was: [`${OLD}/votes/operations/follow.ts`, `${OLD}/votes/operations/follow-ballot.ts`, `${OLD}/votes/operations/follow-execution.ts`, `${OLD}/votes/operations/record-outcome.ts`],
  concept: concept_equity,
  priority: "low",
  trigger: { transition: machine_vote.t.propose },
  instance: { per: table_votes },
  signals: [rpc_equity_votes_cast, rpc_equity_votes_execute],
  waits: [
    ...CARRIER_WAITS,
    { name: "proposal-executed", for: "chain", about: "ProposalExecuted for the vote's Governor and proposal id, from any sender." },
    { name: "vote-end", for: "timer", about: "voteEnd, by the Governor's clock: when it reads whether the vote passed and may end." },
  ],
  steps: [
    DECIDE_STEP,
    { name: "follow-execution", about: "ProposalExecuted indexed at finality: vote.execute, and an awaiting execution write abandoned unless it carried it." },
    { name: "close", about: "After voteEnd, reads Governor.state; ends once nothing more can happen to the vote." },
  ],
  reads: [table_votes, table_equity_writes, table_approvals, table_chain_logs],
  writes: [table_votes, table_equity_writes],
  drives: [machine_vote.t.open, machine_vote.t.execute, machine_vote.t.lapse, machine_vote.t.fail, ...DECIDE],
  invokes: [],
  emits: [],
  calls: [...FACTS, integration_chain_rpc.c.readContract, integration_chain_rpc.c.getBlock],
  chain: [],
  idempotency: "One instance per vote_id. Each write is decided once, by write_id; ProposalExecuted applies once, by its log.",
  timeoutMs: 2 * MINUTE,
  retries: { max: 5, backoff: "exponential" },
  compensation: COMPENSATION,
  budget: { ...budget("background"), excludes: ["wait.person", "chain.confirm"] },
});

// ── writes with no long-lived object ────────────────────────────────────────────────────────

export const workflow_equity_writes_follow = defineWorkflow({
  id: "equity.writes.follow",
  title: "One write that changes no long-lived object, until the chain decides it",
  about:
    "Started by a write's birth (equity-write.open, through the outbox), one instance per write. A write whose subject " +
    "is an install, grant, round, sale or vote is its object's process's, and this instance ends at once. The rest " +
    "(an issue, a conversion, a delegation, an exit payout) it decides alone: when its carrier ends it reads the " +
    "transaction's facts and lands the write on its own event (Issued; Converted; DelegateChanged; the payout's " +
    "PaymentSent items and Settled), fails it on a revert or its absence, and abandons it on an unsent end. Replaces " +
    "old organizations' record-issue mutation and its emit action.",
  was: [`${OLD}/equity/operations/record-issue.ts`, `${OLD}/equity/operations/emit-shares-transitioned.ts`, `${OLD}/equity/writes/issues.ts`],
  concept: concept_equity,
  priority: "low",
  trigger: { transition: w.open },
  instance: { per: table_equity_writes },
  waits: [...CARRIER_WAITS],
  steps: [
    { name: "own", about: "A write with a long-lived subject is left to its object's process; the instance ends." },
    DECIDE_STEP,
  ],
  reads: [table_equity_writes, table_approvals],
  writes: [table_equity_writes],
  drives: [...DECIDE],
  invokes: [],
  emits: [],
  calls: [...FACTS],
  chain: [],
  idempotency: "One instance per write_id; a write the machine has decided is never decided again.",
  timeoutMs: 2 * MINUTE,
  retries: { max: 5, backoff: "exponential" },
  compensation: COMPENSATION,
  budget: { ...budget("background"), excludes: ["wait.person", "chain.confirm"] },
});
