// Equity's Core SDK flows (A4): one per write command, and one for `org vote wait`. The CLI calls
// exactly the flow's SDK method; every read is one rpc and has no flow.
//
// Every write has one shape: prepare the write (one equity rpc, which opens the Board proposal or the
// holder's own approval), decode the calls its approval carries and refuse to sign anything but what
// was asked, read the approval until approvals has sponsored it, sign (an agent with its own key; a
// person on the approval page the CLI opens), give the signature to approvals, which sends it once
// (K4), wait for the person and the chain, then follow the write until its process decides it. A
// Board matter's first approval is the proposing Director's `approveHash`; on a Board of more than one
// it answers `awaiting_approvals` and names the other Directors' `capxul org proposal approve <id>`.

import { Schema } from "effect";
import { budget, defineFlow, type Rpc } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_TRANSACTION_FAILED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { rpc_approvals_signing_get, rpc_approvals_signing_sign } from "../approvals/signing.ts";
import { rpc_equity_installs_begin, rpc_equity_installs_watch } from "./installs.ts";
import { rpc_equity_issues_propose } from "./issues.ts";
import { rpc_equity_grants_accept, rpc_equity_grants_end, rpc_equity_grants_exercise, rpc_equity_grants_propose } from "./grants.ts";
import {
  rpc_equity_rounds_allocate,
  rpc_equity_rounds_cancel,
  rpc_equity_rounds_close,
  rpc_equity_rounds_create,
  rpc_equity_rounds_invite,
} from "./rounds.ts";
import { rpc_equity_safes_close, rpc_equity_safes_create, rpc_equity_safes_invite } from "./safes.ts";
import { rpc_equity_investments_commit, rpc_equity_investments_pay, rpc_equity_investments_sign } from "./investments.ts";
import { rpc_equity_holdings_convert, rpc_equity_holdings_delegate } from "./holdings.ts";
import { rpc_equity_sales_approve, rpc_equity_sales_offer } from "./sales.ts";
import { rpc_equity_exits_pay } from "./exits.ts";
import { rpc_equity_votes_cast, rpc_equity_votes_execute, rpc_equity_votes_get, rpc_equity_votes_propose } from "./votes.ts";
import { rpc_equity_writes_watch } from "./writes.ts";
import * as sh from "./shapes.ts";

const SDK = "packages/sdk/src/organizations";

/** A write's client time: the prepare rpc, the check and the reads; a person's wait and chain confirmation never count. */
const WRITE_BUDGET = { ...budget("chain-submit"), excludes: ["wait.person", "chain.confirm"] };

/** A declined approval ends the flow CANCELLED; a write the chain refused or another write beat, TRANSACTION_FAILED. */
const FLOW_ERRORS = [error_CANCELLED, error_TRANSACTION_FAILED];

const SIGNING = (calls: string) =>
  [
    {
      name: "check-calls",
      local: "build" as const,
      about: `Decodes the calls the approval carries and refuses to sign anything but ${calls}.`,
    },
    { name: "sponsored", rpc: rpc_approvals_signing_get, about: "The approval, live, until approvals has sponsored it (`pending`, with its digest) or it ends." },
    {
      name: "sign",
      local: "sign" as const,
      about: "An agent signs the digest with its own key; a person is handed the approval page (client.approvals.sign), which signs there.",
    },
    { name: "submit", rpc: rpc_approvals_signing_sign, about: "An agent's signature goes to its approval, which approvals sends once; a person's page submits its own." },
  ] as const;

const WAIT_OWN = {
  name: "wait",
  local: "wait" as const,
  about: "wait.person for the signature, then wait.chain until the operation is on chain and indexed.",
};

const WAIT_BOARD = {
  name: "wait",
  local: "wait" as const,
  about:
    "wait.person for the proposer's signature; on a Board of one it executes at once, else it returns awaiting_approvals " +
    "naming the other Directors' `org proposal approve`, unless `--wait` follows it until it executes or ends.",
};

const FOLLOW = {
  name: "follow",
  rpc: rpc_equity_writes_watch,
  about: "Subscribed until the write's process lands, fails or abandons it and its object has moved; returns what the command prints.",
};

/** A Board matter: prepare with one equity rpc, then the proposing Director's approval of the proposal's hash. */
const boardFlow = (id: string, sdk: string, prepare: Rpc, input: Schema.Top, output: Schema.Top, title: string, what: string, calls: string) =>
  defineFlow({
    id,
    title,
    about: `${what} The Board signs: one company Safe proposal that the Directors approve. ${calls} is all the proposal may hold.`,
    was: [`${SDK}/equity.ts`, "books/frozen/operations.ts (designed: Board: a Safe proposal the Directors approve)"],
    component: component_core_sdk,
    sdk,
    input,
    output,
    steps: [{ name: "prepare", rpc: prepare, about: `Runs ${prepare.id}: the checks, the write and the Board proposal.` }, ...SIGNING(calls), WAIT_BOARD, FOLLOW],
    errors: FLOW_ERRORS,
    calls: [],
    spans: [],
    budget: WRITE_BUDGET,
  });

/** A holder's own write: prepare with one equity rpc, then their own approval of exactly these calls. */
const ownFlow = (id: string, sdk: string, prepare: Rpc, input: Schema.Top, output: Schema.Top, title: string, what: string, calls: string) =>
  defineFlow({
    id,
    title,
    about: `${what} Your own Safe signs, sponsored by Capxul's paymaster: ${calls}, nothing else.`,
    was: [`${SDK}/equity.ts`, "books/frozen/operations.ts (designed: You: your own Safe signs)"],
    component: component_core_sdk,
    sdk,
    input,
    output,
    steps: [{ name: "prepare", rpc: prepare, about: `Runs ${prepare.id}: the checks, the write and its approval.` }, ...SIGNING(calls), WAIT_OWN, FOLLOW],
    errors: FLOW_ERRORS,
    calls: [],
    spans: [],
    budget: WRITE_BUDGET,
  });

// ── setup ───────────────────────────────────────────────────────────────────────────────────

export const flow_client_org_equity_setup = defineFlow({
  id: "client.org.equity.setup",
  title: "Switch equity on: plan, deploy, then sign the Board's install batch",
  about:
    "Parses the founders and the vesting, begins the install, then follows it live until its process has deployed the " +
    "clones and opened the Board's batch. It checks the batch holds only the plan's issuer allowances, one " +
    "`Vesting.grantAndIssue` per founder for exactly their shares and schedule, and the pool's allowance and " +
    "`Options.setPool`, and only then has the proposing Director sign. The CLI prints what the Board approves (the " +
    "template, the founders, the pool, the reserved matters and their vote settings) and, while it waits, the other " +
    "Director's command.",
  was: [`${SDK}/equity.ts`, "packages/sdk/src/organizations/equity-echo.ts", "books/frozen/operations.ts (org.equity.setup, designed)"],
  component: component_core_sdk,
  sdk: "client.org(orgId).equity.setup",
  input: sh.SetupInput,
  output: sh.SetupReturns,
  steps: [
    { name: "begin", rpc: rpc_equity_installs_begin, about: "Plans and begins the install, or answers the live one with the same terms." },
    { name: "until-proposed", rpc: rpc_equity_installs_watch, about: "Subscribed until the install is proposed, with its batch's approval, or fails." },
    ...SIGNING("the plan's issuer allowances, one grantAndIssue per founder for their shares and schedule, and the pool's setPool"),
    WAIT_BOARD,
    { name: "follow", rpc: rpc_equity_installs_watch, about: "Subscribed until the batch's write is decided: installed, failed or abandoned." },
  ],
  errors: FLOW_ERRORS,
  calls: [],
  spans: [],
  budget: { ...WRITE_BUDGET, p95Ms: 8_000, why: "it waits for the service key's deployEquity receipt and its indexing, which is system time" },
});

// ── the Board ───────────────────────────────────────────────────────────────────────────────

export const flow_client_org_equity_issue = boardFlow(
  "client.org.equity.issue",
  "client.org(orgId).equity.issue",
  rpc_equity_issues_propose,
  sh.IssueInput,
  sh.IssueReturns,
  "Issue shares: propose the issue and sign it",
  "Issues shares in a class within its authorised amount, with a reason hashed onto the issue.",
  "one Captable.issue of the class, recipient, shares and reason hash asked for",
);

export const flow_client_org_equity_transfers_approve = boardFlow(
  "client.org.equity.transfers.approve",
  "client.org(orgId).equity.transfers.approve",
  rpc_equity_sales_approve,
  sh.SaleRef,
  sh.TransferApproveReturns,
  "Approve a share sale: propose the approval and sign it",
  "Approves a sale a holder offered; the buyer then pays with `capxul invest pay tr_…`.",
  "one Exits.approveTransfer of the sale's own offer id",
);

export const flow_client_org_options_grant = boardFlow(
  "client.org.options.grant",
  "client.org(orgId).options.grant",
  rpc_equity_grants_propose,
  sh.GrantInput,
  sh.GrantReturns,
  "Grant options: propose the grants and sign them",
  "Grants options from the pool to one person, or to each line of a CSV, in one proposal; once it executes the grantee accepts with `capxul shares accept`.",
  "one Options.grant per grant asked for, with its grantee, shares, strike, schedule, dates and agreement hash",
);

export const flow_client_org_options_end = boardFlow(
  "client.org.options.end",
  "client.org(orgId).options.end",
  rpc_equity_grants_end,
  sh.EndGrantInput,
  sh.EndGrantReturns,
  "End a grant from a last day: propose it and sign it",
  "Ends a grant when someone leaves: unvested options return to the pool, vested stay exercisable for the window; a founder's vesting grant is revoked.",
  "one Options.end of the grant at the last day, or Vesting.revoke and settleRevocation for a founder's grant",
);

export const flow_client_org_rounds_create = boardFlow(
  "client.org.rounds.create",
  "client.org(orgId).rounds.create",
  rpc_equity_rounds_create,
  sh.RoundCreateInput,
  sh.RoundCreateReturns,
  "Open a priced round: propose it and sign it",
  "Prices the round from the pre-money valuation; the check recomputes the price and the shares the raise buys, both rounded down from the pre-money over the fully diluted shares.",
  "one Rounds.createPricedRound of the class, token, recomputed price, maximum shares, pay-by day and terms hash",
);

export const flow_client_org_rounds_invite = boardFlow(
  "client.org.rounds.invite",
  "client.org(orgId).rounds.invite",
  rpc_equity_rounds_invite,
  sh.InviteInput,
  sh.InviteReturns,
  "Invite investors to a priced round: propose it and sign it",
  "Invites each investor for at most an amount; notices emails each invitation once it is on chain.",
  "one Rounds.invite per investor asked for, at their amount",
);

export const flow_client_org_rounds_allocate = boardFlow(
  "client.org.rounds.allocate",
  "client.org(orgId).rounds.allocate",
  rpc_equity_rounds_allocate,
  sh.AllocateInput,
  sh.AllocateReturns,
  "Allocate a round: propose the allocation and sign it",
  "Allocates shares to the committed investors, converts SAFEs and tops up the pool in one proposal.",
  "Rounds.allocate per investor, the round's issuer allowance, the SAFE conversions and the pool top-up as prepared",
);

export const flow_client_org_rounds_close = boardFlow(
  "client.org.rounds.close",
  "client.org(orgId).rounds.close",
  rpc_equity_rounds_close,
  sh.RoundRef,
  sh.CloseReturns,
  "Close a priced round: propose the close and sign it",
  "Closes the round: unpaid allocations lapse and anti-dilution is applied to every earlier class priced above it.",
  "one Rounds.close of the round",
);

export const flow_client_org_rounds_cancel = boardFlow(
  "client.org.rounds.cancel",
  "client.org(orgId).rounds.cancel",
  rpc_equity_rounds_cancel,
  sh.RoundRef,
  sh.CancelReturns,
  "Cancel a priced round: propose the cancellation and sign it",
  "Cancels a round no investor has paid into.",
  "one Rounds.cancel of the round",
);

export const flow_client_org_safes_create = boardFlow(
  "client.org.safes.create",
  "client.org(orgId).safes.create",
  rpc_equity_safes_create,
  sh.SafeCreateInput,
  sh.SafeCreateReturns,
  "Open a SAFE round: propose it and sign it",
  "Opens a post-money SAFE round with its cap, discount, raise and last day to sign.",
  "one Rounds.createSafeRound of the token, cap, discount, close day and form's hash",
);

export const flow_client_org_safes_invite = boardFlow(
  "client.org.safes.invite",
  "client.org(orgId).safes.invite",
  rpc_equity_safes_invite,
  sh.InviteInput,
  sh.InviteReturns,
  "Invite investors to a SAFE round: propose it and sign it",
  "Invites each investor to sign a SAFE for at most an amount; notices emails each invitation once it is on chain.",
  "one Rounds.inviteSafe per investor asked for, at their amount",
);

export const flow_client_org_safes_close = defineFlow({
  id: "client.org.safes.close",
  title: "Close a SAFE round: at once when full, else propose and sign",
  about:
    "Prepares the close: a full round is the Director's own `Rounds.closeSafeRound` from their own Safe, which closes it " +
    "once it lands; any other is a Board proposal of the same one call, which answers the proposal's status. The check " +
    "refuses to sign anything but that one call on the round.",
  was: [`${SDK}/equity.ts`, "books/frozen/operations.ts (org.safe.create, designed: close needs no proposal for a full round)"],
  component: component_core_sdk,
  sdk: "client.org(orgId).safes.close",
  input: sh.RoundRef,
  output: sh.SafeCloseReturns,
  steps: [
    { name: "prepare", rpc: rpc_equity_safes_close, about: "Runs equity.safes.close: the checks, the write and its approval or Board proposal." },
    ...SIGNING("one Rounds.closeSafeRound of the round"),
    WAIT_BOARD,
    FOLLOW,
  ],
  errors: FLOW_ERRORS,
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
});

export const flow_client_org_exits_pay = boardFlow(
  "client.org.exits.pay",
  "client.org(orgId).exits.pay",
  rpc_equity_exits_pay,
  sh.ExitPayInput,
  sh.ExitPayReturns,
  "Pay out an exit: propose the payout and settlement and sign it",
  "After the shareholders approve the sale and the buyer pays, pays every holder in one batch and settles.",
  "one Payments.sendBatch of the waterfall's kind-8 items, then Exits.settle of the sale with its holdings",
);

// ── a holder's own writes ───────────────────────────────────────────────────────────────────

export const flow_client_me_shares_sell = defineFlow({
  id: "client.me.shares.sell",
  title: "Sell shares: offer them from your own Safe",
  about:
    "Offers shares to a buyer: the seller's own Safe consents and offers in one operation, for exactly the terms asked. " +
    "A prepared sale with other terms is refused before anything is signed. With `--no-wait` it returns once the approval " +
    "is open (`awaiting_approval`); Capxul follows the offer to the chain either way. Once offered, the Board approves it " +
    "with `org equity transfer approve`.",
  was: [`${SDK}/shares.ts`, "books/frozen/operations.ts (shares.sell)"],
  component: component_core_sdk,
  sdk: "client.me.shares.sell",
  input: sh.SellInput,
  output: sh.SellReturns,
  steps: [
    { name: "prepare", rpc: rpc_equity_sales_offer, about: "Runs equity.sales.offer: the checks, the sale, its write and its approval." },
    ...SIGNING("Captable.consentToTransfer then Exits.offerTransfer of the class, buyer, shares, price, token and agreement hash asked for"),
    { ...WAIT_OWN, about: "Unless `--no-wait`: wait.person for the signature, then wait.chain until the offer is on chain and indexed." },
    FOLLOW,
  ],
  errors: FLOW_ERRORS,
  calls: [],
  spans: [],
  budget: WRITE_BUDGET,
});

export const flow_client_me_shares_accept = ownFlow(
  "client.me.shares.accept",
  "client.me.shares.accept",
  rpc_equity_grants_accept,
  sh.GrantRef,
  sh.AcceptReturns,
  "Accept a grant's exact terms from your own Safe",
  "Accepts an option grant; vesting has already started from the grant's start date.",
  "one Options.accept of the grant with the agreement hash Capxul stored",
);

export const flow_client_me_shares_exercise = ownFlow(
  "client.me.shares.exercise",
  "client.me.shares.exercise",
  rpc_equity_grants_exercise,
  sh.ExerciseInput,
  sh.ExerciseReturns,
  "Exercise vested options from your own Safe",
  "Pays the strike to the company and receives the shares in the same transaction.",
  "the strike token's approve of Options for exactly the strike, then one Options.exercise of the grant and shares",
);

export const flow_client_me_shares_convert = ownFlow(
  "client.me.shares.convert",
  "client.me.shares.convert",
  rpc_equity_holdings_convert,
  sh.ConvertInput,
  sh.ConvertReturns,
  "Convert preferred shares into Common from your own Safe",
  "Converts at the class's current ratio.",
  "one Captable.convert of the class and shares asked for",
);

export const flow_client_me_invest_commit = ownFlow(
  "client.me.invest.commit",
  "client.me.invest.commit",
  rpc_equity_investments_commit,
  sh.CommitInput,
  sh.CommitReturns,
  "Commit to a priced round from your own Safe",
  "Commits an amount; no money moves until the Board allocates and you pay.",
  "one Rounds.commit of the round, the amount asked and the round's terms hash",
);

export const flow_client_me_invest_pay = ownFlow(
  "client.me.invest.pay",
  "client.me.invest.pay",
  rpc_equity_investments_pay,
  sh.PayInput,
  sh.PayReturns,
  "Pay for your shares from your own Safe",
  "Pays an allocation and receives the shares in the same transaction (`rd_…`), or buys an approved secondary sale (`tr_…`).",
  "the token's approve of exactly the amount, then one Rounds.pay of the round or Exits.buy of the sale",
);

export const flow_client_me_invest_sign = ownFlow(
  "client.me.invest.sign",
  "client.me.invest.sign",
  rpc_equity_investments_sign,
  sh.SignInput,
  sh.SignReturns,
  "Sign and pay a SAFE from your own Safe",
  "Signs a SAFE and pays for it in one step.",
  "USDC's approve of exactly the amount, then one Rounds.signSafe of the round, the amount and the form's hash",
);

export const flow_client_org_votes_create = ownFlow(
  "client.org.votes.create",
  "client.org(orgId).votes.create",
  rpc_equity_votes_propose,
  sh.VoteCreateInput,
  sh.VoteReturns,
  "Propose a shareholder vote from your own Safe",
  "Builds the Governor calls from the matter and its flags, then reads the vote until the Governor holds it; shareholders vote with `capxul vote cast`.",
  "one Governor.propose whose description names the vote and whose proposal id is OpenZeppelin's hashProposal of its calls",
);

export const flow_client_org_votes_execute = ownFlow(
  "client.org.votes.execute",
  "client.org(orgId).votes.execute",
  rpc_equity_votes_execute,
  sh.VoteRef,
  sh.ExecuteReturns,
  "Execute a passed vote from your own Safe",
  "Anyone may run it; it reads the execution until the Governor ran the vote's calls.",
  "one Governor.execute of the vote's own calls and the hash of its own description",
);

export const flow_client_me_votes_cast = ownFlow(
  "client.me.votes.cast",
  "client.me.votes.cast",
  rpc_equity_votes_cast,
  sh.CastInput,
  sh.CastReturns,
  "Cast your vote from your own Safe",
  "Casts for, against or abstaining, with an optional reason recorded on chain; it reads the ballot until the Governor counted it.",
  "one Governor.castVoteWithReason of the vote's proposal, the side asked (OpenZeppelin's support) and the reason",
);

export const flow_client_me_votes_delegate = ownFlow(
  "client.me.votes.delegate",
  "client.me.votes.delegate",
  rpc_equity_holdings_delegate,
  sh.DelegateInput,
  sh.DelegateReturns,
  "Delegate a class's votes from your own Safe",
  "Delegates a class's votes to someone else, or back to yourself.",
  "one ShareClass.delegate on the class token to the delegate asked",
);

// ── waiting for a vote ──────────────────────────────────────────────────────────────────────

export const flow_client_org_votes_wait = defineFlow({
  id: "client.org.votes.wait",
  title: "Wait until a vote closes or is executed",
  about:
    "Reads the vote, then follows it until it reaches `--until` (closed by default: past pending and active; or " +
    "executed). A vote that can never get there is refused WRONG_STATE at once, not waited on: one that failed or lapsed " +
    "before the Governor held it, or `--until executed` on a vote that closed without passing.",
  was: [`${SDK}/votes.ts`, "books/frozen/operations.ts (org.vote.wait)"],
  component: component_core_sdk,
  sdk: "client.org(orgId).votes.wait",
  input: sh.VoteWaitInput,
  output: sh.VoteReturns,
  steps: [
    { name: "read", rpc: rpc_equity_votes_get, about: "The vote now; refuses one that can never reach the state asked." },
    { name: "wait", local: "wait", about: "wait.chain: subscribed to the vote, by the Governor's clock and indexed votes, until the state." },
    { name: "follow", rpc: rpc_equity_votes_get, about: "The vote's last push, at the state, as `org vote show` gives it." },
  ],
  errors: [error_WRONG_STATE],
  calls: [],
  spans: [],
  budget: { ...budget("chain-read"), excludes: ["wait.chain"] },
});
