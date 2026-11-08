// The 38 frozen operations equity owns (OPERATION_OWNERS: area equity, and the shareholder votes from
// governance), each built from its frozen text. Equity was never built on the old devnet, so 23 of them
// have no frozen acceptance line; they keep none (equity.acceptance). Of the 53 lines the other 15 have,
// 23 are kept word for word and 30 are rewritten (equity.acceptance-rewrites): the lines that named old
// telemetry events (P7 sends one event per machine), storage or the old component doing a check (P1).
// "Reports" in a kept claim is read as decision equity.reports says: one landed write with its change.
// Refusals keep their frozen `when` text, from the given world (equity.worlds).
//
// Every write is one Core SDK flow (flows.ts); every read one rpc.

import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_AUTHORISED_EXCEEDED,
  error_BELOW_THRESHOLD,
  error_CLI_USAGE,
  error_CONSENT_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_FUNDS,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_NOT_VESTED,
  error_POOL_EXCEEDED,
  error_RESERVED_MATTER,
  error_ROLE_PERMISSION_DENIED,
  error_ROUND_CLOSED,
  error_SHARES_LOCKED,
  error_SMART_ACCOUNT_MISSING,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import * as f from "./flows.ts";
import { rpc_equity_grants_show } from "./grants.ts";
import { rpc_equity_holdings_cap_table, rpc_equity_holdings_list } from "./holdings.ts";
import { rpc_equity_investments_get, rpc_equity_investments_list } from "./investments.ts";
import { rpc_equity_rounds_preview, rpc_equity_rounds_show } from "./rounds.ts";
import { rpc_equity_safes_show } from "./safes.ts";
import { rpc_equity_exits_preview } from "./exits.ts";
import { rpc_equity_votes_get, rpc_equity_votes_list, rpc_equity_votes_mine } from "./votes.ts";
import * as sh from "./shapes.ts";
import { Schema } from "effect";

// ── worlds (equity.worlds) ──────────────────────────────────────────────────────────────────

export const W_SIGNED_OUT = "signed-out";
/** A devnet company with its `equity` gate turned off (`dev gates set`). */
export const W_EQUITY_OFF = "org-with-equity-off";
/** A v4 company of two founders, a 2-of-2 Board, a member who is not a Director and an outsider; no equity yet. */
export const W_NO_EQUITY = "org-without-equity";
/** Setup begun with deployEquity sent and its receipt held by the service signer's fault switch. */
export const W_DEPLOY_HELD = "org-with-equity-deploy-held";
/** The co-founders template installed: Common, founders vesting 48 months, a 1,000,000 pool. */
export const W_EQUITY = "org-with-equity";
/** An option grant offered to a member, not yet accepted. */
export const W_OPTION_OFFERED = "org-with-option-offered";
/** An option grant accepted, the clock past its cliff, part exercised. */
export const W_OPTION_ACTIVE = "org-with-option-active";
/** A priced round open (its class created by vote), one investor invited and one committed. */
export const W_ROUND_OPEN = "org-with-round-open";
/** A priced round allocated, one investor paid and one not. */
export const W_ROUND_ALLOCATED = "org-with-round-allocated";
/** A SAFE round open with an investor invited, and a closed SAFE round beside it. */
export const W_SAFE_ROUND = "org-with-safe-round";
/** A founder's sale offered and waiting for the Board, and another already approved. */
export const W_SALE_OFFERED = "org-with-sale-offered";
/** Votes in every standing: pending, active, defeated, succeeded, executed, and one lapsed unsigned. */
export const W_VOTES = "org-with-votes";
/** An approve-sale vote executed, the buyer not yet paid. */
export const W_EXIT_APPROVED = "org-with-exit-approved";

export const WORLDS = [
  W_EQUITY_OFF,
  W_NO_EQUITY,
  W_DEPLOY_HELD,
  W_EQUITY,
  W_OPTION_OFFERED,
  W_OPTION_ACTIVE,
  W_ROUND_OPEN,
  W_ROUND_ALLOCATED,
  W_SAFE_ROUND,
  W_SALE_OFFERED,
  W_VOTES,
  W_EXIT_APPROVED,
] as const;

// ── helpers ─────────────────────────────────────────────────────────────────────────────────

type Line = { readonly claim: string; readonly was: readonly string[] };

const line = (id: FrozenId, n: number): Line => {
  const l = (frozen[id].acceptance as readonly Line[])[n - 1];
  if (!l) throw new Error(`${id} has no acceptance line ${n}`);
  return l;
};

/** A frozen claim kept word for word, with its test citation. */
const keep = (id: FrozenId, n: number, observes: string) => {
  const l = line(id, n);
  return { claim: l.claim, observes, was: [...l.was] };
};

/** P1: a claim rewritten as an outcome (equity.acceptance-rewrites); the old line first in `was`. */
const rewrite = (id: FrozenId, n: number, claim: string, observes: string) => {
  const l = line(id, n);
  return { claim, observes, was: [l.claim, ...l.was] };
};

/** The frozen refusal text for a code, so `when` is never retyped. */
const when = (id: FrozenId, code: string): string => {
  const r = (frozen[id].refusals as readonly { code: string; when: string }[]).find((x) => x.code === code);
  if (!r) throw new Error(`${id} has no frozen refusal ${code}`);
  return r.when;
};

/** A refusal from the designed v4 text (P10), when the top-level list does not name the code. */
const designedWhen = (id: FrozenId, code: string): string => {
  const d = (frozen[id] as { designed: { refusals: readonly { code: string; when: string }[] } | null }).designed;
  const r = d?.refusals.find((x) => x.code === code);
  if (!r) throw new Error(`${id} has no designed refusal ${code}`);
  return `${r.when}.`;
};

const refuse = (id: FrozenId, error: { id: string; _kind: "error" }, given: string) => ({ error, given, when: when(id, error.id) });

const WRITE_BUDGET = { ...budget("chain-submit"), excludes: ["wait.person", "chain.confirm"] };
const ERRORS = [error_CLI_USAGE];

/** What a Board proposal's landing shows the observers. */
const REPORTED = (change: string) =>
  `trace: exactly one equity_write_transitioned to \`landed\` with change \`${change}\`; a rejected proposal: the write \`abandoned\`, none landed`;
const NOTHING = "world: the snapshot diff shows no equity row, no proposal, no approval and no chain change";

// ── setup and issue ─────────────────────────────────────────────────────────────────────────

const SETUP = "org.equity.setup";
export const operation_org_equity_setup = defineOperation({
  ...frozenText(SETUP),
  priority: "low",
  implementedBy: f.flow_client_org_equity_setup,
  acceptance: [
    keep(SETUP, 1, "cli `--template co-founders --json` on org-without-equity: capTable.fullyDiluted 9000000, one class Common, each founder vesting 48 months from today; a no-vesting template's founders show no vesting"),
    keep(SETUP, 2, "cli: INVALID_INPUT or AUTHORISED_EXCEEDED for each case; " + NOTHING + " (no deployEquity sent)"),
    keep(SETUP, 3, "cli: after the batch executes the same command answers `installed`; while it waits the same terms answer the same proposal and other terms exit WRONG_STATE"),
    rewrite(
      SETUP,
      4,
      "A deployment with no receipt yet holds the setup, so other terms wait until it resolves.",
      "world org-with-equity-deploy-held: other terms exit WRONG_STATE; the same terms answer `deploying`; once the receipt is released the setup goes on",
    ),
    keep(SETUP, 5, REPORTED("equity_set_up") + "; read: `org cap-table` shows the founders"),
    rewrite(
      SETUP,
      6,
      "The proposer's approval carries only the cap table asked for.",
      "chain: the batch's calldata decodes to the plan's setIssuerAllowance calls, one Vesting.grantAndIssue per founder with their shares and schedule, and Options.setPool of the pool",
    ),
    keep(SETUP, 7, "cli: the output names the template, founders, pool and reserved matters, and on a 2-of-2 Board `capxul org proposal approve <id>` for the other Director"),
  ],
  returns: sh.SetupReturns,
  errors: ERRORS,
  refusals: [
    refuse(SETUP, error_AUTHORISED_EXCEEDED, W_NO_EQUITY),
    refuse(SETUP, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
    refuse(SETUP, error_WRONG_STATE, W_EQUITY),
    refuse(SETUP, error_INVALID_INPUT, W_NO_EQUITY),
    refuse(SETUP, error_ROLE_PERMISSION_DENIED, W_NO_EQUITY),
    refuse(SETUP, error_NOT_AUTHENTICATED, W_SIGNED_OUT),
  ],
  budget: { ...WRITE_BUDGET, p95Ms: 8_000, why: "the setup waits for the service key's deployEquity receipt and its indexing, which is system time" },
});

const ISSUE = "org.equity.issue";
export const operation_org_equity_issue = defineOperation({
  ...frozenText(ISSUE),
  priority: "low",
  implementedBy: f.flow_client_org_equity_issue,
  acceptance: [
    rewrite(
      ISSUE,
      1,
      "An issue is proposed to the Board once, and the same issue asked again answers that proposal.",
      "cli: the second run prints the same proposalId; world: one proposal and one write for the two runs",
    ),
    rewrite(ISSUE, 2, "An executed issue is reported once, by its settlement, and a rejected one never.", REPORTED("issued") + "; chain: one Captable Issued"),
    rewrite(
      ISSUE,
      3,
      "The proposer's approval carries only the issue asked for.",
      "chain: the proposal's calldata decodes to one Captable.issue of exactly the class, recipient, shares and reason hash asked",
    ),
  ],
  returns: sh.IssueReturns,
  errors: ERRORS,
  refusals: [
    refuse(ISSUE, error_AUTHORISED_EXCEEDED, W_EQUITY),
    refuse(ISSUE, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
    refuse(ISSUE, error_WRONG_STATE, W_NO_EQUITY),
    refuse(ISSUE, error_INVALID_INPUT, W_EQUITY),
    refuse(ISSUE, error_ROLE_PERMISSION_DENIED, W_EQUITY),
    refuse(ISSUE, error_NOT_AUTHENTICATED, W_SIGNED_OUT),
  ],
  budget: WRITE_BUDGET,
});

const CAP = "org.cap-table";
export const operation_org_cap_table = defineOperation({
  ...frozenText(CAP),
  priority: "low",
  implementedBy: rpc_equity_holdings_cap_table,
  acceptance: [
    keep(CAP, 1, "read `org cap-table --json` on org-with-equity after an issue to a member: each founder and the recipient is one row, named by their member"),
    keep(CAP, 2, "read: rows by class and as converted; with `--fully-diluted`, `options` and `pool` equal Options.allocated and pool less allocated on chain"),
    keep(CAP, 3, "chain: shares sent to an address no Party has; read: one `Other holders` row with their sum, counted once in `total`"),
    keep(CAP, 4, "cli as the outsider of org-with-equity: ROLE_PERMISSION_DENIED"),
    rewrite(CAP, 5, "`org cap-table --org <org>` reads that Organization's own cap table.", "read: two companies' cap tables differ, each its own Captable's holders"),
  ],
  returns: sh.CapTableReturns,
  errors: ERRORS,
  refusals: [
    refuse(CAP, error_ROLE_PERMISSION_DENIED, W_EQUITY),
    refuse(CAP, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
    refuse(CAP, error_WRONG_STATE, W_NO_EQUITY),
    refuse(CAP, error_NOT_AUTHENTICATED, W_SIGNED_OUT),
  ],
  budget: budget("chain-read"),
});

// ── grants ──────────────────────────────────────────────────────────────────────────────────

const GRANT = "org.options.grant";
export const operation_org_options_grant = defineOperation({
  ...frozenText(GRANT),
  priority: "low",
  implementedBy: f.flow_client_org_options_grant,
  acceptance: [
    rewrite(
      GRANT,
      1,
      "A grant is proposed to the Board once, and the same grant again answers that proposal.",
      "cli: a second run, even on a later day, prints the same proposalId and grantId; world: one proposal",
    ),
    rewrite(
      GRANT,
      2,
      "An executed grant is reported `granted` once, by its settlement, and a rejected one never.",
      REPORTED("granted") + "; trace: one equity_grant_transitioned proposed → offered",
    ),
    keep(GRANT, 3, "cli `--json`: vesting in calendar months from today, offerExpiresAt 30 days on, expiresAt ten years after the start; chain: Options.grant carries the same dates"),
    rewrite(
      GRANT,
      4,
      "The proposer's approval carries only the grant asked for.",
      "chain: the proposal's calldata decodes to one Options.grant per grant asked, with exactly its grantee, shares, strike, schedule and agreement hash",
    ),
  ],
  returns: sh.GrantReturns,
  errors: ERRORS,
  refusals: [
    refuse(GRANT, error_POOL_EXCEEDED, W_EQUITY),
    refuse(GRANT, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
    refuse(GRANT, error_WRONG_STATE, W_NO_EQUITY),
    refuse(GRANT, error_INVALID_INPUT, W_EQUITY),
    refuse(GRANT, error_TOKEN_NOT_SUPPORTED, W_EQUITY),
    refuse(GRANT, error_ROLE_PERMISSION_DENIED, W_EQUITY),
    refuse(GRANT, error_NOT_AUTHENTICATED, W_SIGNED_OUT),
  ],
  budget: WRITE_BUDGET,
});

const END = "org.options.end";
export const operation_org_options_end = defineOperation({
  ...frozenText(END),
  priority: "low",
  implementedBy: f.flow_client_org_options_end,
  acceptance: [],
  returns: sh.EndGrantReturns,
  errors: ERRORS,
  refusals: [
    refuse(END, error_INVALID_INPUT, W_OPTION_ACTIVE),
    refuse(END, error_WRONG_STATE, W_OPTION_ACTIVE),
    refuse(END, error_ROLE_PERMISSION_DENIED, W_OPTION_ACTIVE),
  ],
  budget: WRITE_BUDGET,
});

const OSHOW = "org.options.show";
export const operation_org_options_show = defineOperation({
  ...frozenText(OSHOW),
  priority: "low",
  implementedBy: rpc_equity_grants_show,
  acceptance: [],
  returns: sh.GrantShowReturns,
  errors: ERRORS,
  refusals: [refuse(OSHOW, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF), refuse(OSHOW, error_INVALID_INPUT, W_OPTION_OFFERED)],
  budget: budget("chain-read"),
});

const ACCEPT = "shares.accept";
export const operation_shares_accept = defineOperation({
  ...frozenText(ACCEPT),
  priority: "low",
  implementedBy: f.flow_client_me_shares_accept,
  acceptance: [],
  returns: sh.AcceptReturns,
  errors: ERRORS,
  refusals: [
    refuse(ACCEPT, error_WRONG_STATE, W_OPTION_OFFERED),
    refuse(ACCEPT, error_INVALID_INPUT, W_OPTION_OFFERED),
    refuse(ACCEPT, error_ROLE_PERMISSION_DENIED, W_OPTION_OFFERED),
  ],
  budget: WRITE_BUDGET,
});

const EXERCISE = "shares.exercise";
export const operation_shares_exercise = defineOperation({
  ...frozenText(EXERCISE),
  priority: "low",
  implementedBy: f.flow_client_me_shares_exercise,
  acceptance: [],
  returns: sh.ExerciseReturns,
  errors: ERRORS,
  refusals: [
    refuse(EXERCISE, error_NOT_VESTED, W_OPTION_ACTIVE),
    refuse(EXERCISE, error_WRONG_STATE, W_OPTION_ACTIVE),
    refuse(EXERCISE, error_INSUFFICIENT_FUNDS, W_OPTION_ACTIVE),
  ],
  budget: WRITE_BUDGET,
});

// ── holdings and sales ──────────────────────────────────────────────────────────────────────

const SHARES = "shares";
export const operation_shares = defineOperation({
  ...frozenText(SHARES),
  priority: "low",
  implementedBy: rpc_equity_holdings_list,
  acceptance: [],
  returns: sh.SharesReturns,
  errors: ERRORS,
  refusals: [refuse(SHARES, error_NOT_AUTHENTICATED, W_SIGNED_OUT)],
  budget: budget("chain-read"),
});

const CONVERT = "shares.convert";
export const operation_shares_convert = defineOperation({
  ...frozenText(CONVERT),
  priority: "low",
  implementedBy: f.flow_client_me_shares_convert,
  acceptance: [],
  returns: sh.ConvertReturns,
  errors: ERRORS,
  refusals: [refuse(CONVERT, error_SHARES_LOCKED, W_ROUND_ALLOCATED), refuse(CONVERT, error_INVALID_INPUT, W_ROUND_ALLOCATED)],
  budget: WRITE_BUDGET,
});

const SELL = "shares.sell";
export const operation_shares_sell = defineOperation({
  ...frozenText(SELL),
  priority: "low",
  implementedBy: f.flow_client_me_shares_sell,
  acceptance: [
    rewrite(
      SELL,
      1,
      "A sale waits for its seller, is sent once, then offered once and is reported (`sale_requested`) once.",
      "cli `--no-wait`: `awaiting_approval`; after the seller signs, chain: one TransferConsented and one TransferOffered; " + "trace: exactly one equity_write_transitioned to `landed` with change `sale_requested` and one share_sale_transitioned requested → offered",
    ),
    keep(SELL, 2, "chain: the approval's calls decode to consentToTransfer then offerTransfer of exactly the terms asked; cli: a sale prepared with other terms exits before signing; " + NOTHING),
  ],
  returns: sh.SellReturns,
  errors: ERRORS,
  refusals: [
    refuse(SELL, error_SHARES_LOCKED, W_EQUITY),
    refuse(SELL, error_INVALID_INPUT, W_EQUITY),
    refuse(SELL, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
    refuse(SELL, error_WRONG_STATE, W_NO_EQUITY),
    refuse(SELL, error_SMART_ACCOUNT_MISSING, W_EQUITY),
    refuse(SELL, error_ROLE_PERMISSION_DENIED, W_EQUITY),
    refuse(SELL, error_NOT_AUTHENTICATED, W_SIGNED_OUT),
  ],
  budget: WRITE_BUDGET,
});

const APPROVE = "org.equity.transfer.approve";
export const operation_org_equity_transfer_approve = defineOperation({
  ...frozenText(APPROVE),
  priority: "low",
  implementedBy: f.flow_client_org_equity_transfers_approve,
  acceptance: [
    rewrite(
      APPROVE,
      1,
      "The Board's approval is proposed once, the same approval again answers it while it waits, a sale not yet offered is refused, and once the proposal executes the sale is approved and is reported (`transfer_approved`) once.",
      "cli: a second run prints the same proposalId; a `requested` sale exits WRONG_STATE; chain: TransferApproved after the proposal executes; " +
        REPORTED("transfer_approved"),
    ),
  ],
  returns: sh.TransferApproveReturns,
  errors: ERRORS,
  refusals: [
    refuse(APPROVE, error_WRONG_STATE, W_SALE_OFFERED),
    refuse(APPROVE, error_INVALID_INPUT, W_SALE_OFFERED),
    refuse(APPROVE, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
    refuse(APPROVE, error_ROLE_PERMISSION_DENIED, W_SALE_OFFERED),
    refuse(APPROVE, error_NOT_AUTHENTICATED, W_SIGNED_OUT),
  ],
  budget: WRITE_BUDGET,
});

// ── exits ───────────────────────────────────────────────────────────────────────────────────

const XPREVIEW = "org.exit.preview";
export const operation_org_exit_preview = defineOperation({
  ...frozenText(XPREVIEW),
  priority: "low",
  implementedBy: rpc_equity_exits_preview,
  acceptance: [],
  returns: sh.ExitPreviewReturns,
  errors: ERRORS,
  refusals: [refuse(XPREVIEW, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF)],
  budget: budget("chain-read"),
});

const XPAY = "org.exit.pay";
export const operation_org_exit_pay = defineOperation({
  ...frozenText(XPAY),
  priority: "low",
  implementedBy: f.flow_client_org_exits_pay,
  acceptance: [],
  returns: sh.ExitPayReturns,
  errors: ERRORS,
  refusals: [
    refuse(XPAY, error_WRONG_STATE, W_EXIT_APPROVED),
    refuse(XPAY, error_INVALID_INPUT, W_EXIT_APPROVED),
    refuse(XPAY, error_ROLE_PERMISSION_DENIED, W_EXIT_APPROVED),
  ],
  budget: WRITE_BUDGET,
});

// ── priced rounds ───────────────────────────────────────────────────────────────────────────

const RPREVIEW = "org.round.preview";
export const operation_org_round_preview = defineOperation({
  ...frozenText(RPREVIEW),
  priority: "low",
  implementedBy: rpc_equity_rounds_preview,
  acceptance: [],
  returns: sh.RoundPreviewReturns,
  errors: ERRORS,
  refusals: [refuse(RPREVIEW, error_RESERVED_MATTER, W_EQUITY), refuse(RPREVIEW, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF)],
  budget: budget("chain-read"),
});

const RCREATE = "org.round.create";
export const operation_org_round_create = defineOperation({
  ...frozenText(RCREATE),
  priority: "low",
  implementedBy: f.flow_client_org_rounds_create,
  acceptance: [
    rewrite(
      RCREATE,
      1,
      "A round is proposed to the Board once, and the same round again answers that proposal.",
      "cli: the second run prints the same proposalId and roundId; world: one proposal",
    ),
    rewrite(
      RCREATE,
      2,
      "An executed round is reported opened once, by its settlement, and a rejected one never.",
      REPORTED("opened") + "; trace: one fundraise_round_transitioned proposed → open",
    ),
    rewrite(
      RCREATE,
      3,
      "The approval opens only for the price and shares the valuation buys, both rounded down from the pre-money over the fully diluted shares.",
      "chain: Rounds.createPricedRound's price equals floor(pre-money ÷ fully diluted) and maxShares floor(raise ÷ price), from the cap table read at the time",
    ),
    rewrite(
      RCREATE,
      4,
      "The proposer's approval carries only the round asked for.",
      "chain: the proposal's calldata decodes to one Rounds.createPricedRound of exactly the class, token, pay-by day and terms hash asked",
    ),
  ],
  returns: sh.RoundCreateReturns,
  errors: ERRORS,
  refusals: [
    refuse(RCREATE, error_AUTHORISED_EXCEEDED, W_EQUITY),
    refuse(RCREATE, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
    refuse(RCREATE, error_WRONG_STATE, W_NO_EQUITY),
    refuse(RCREATE, error_INVALID_INPUT, W_EQUITY),
    refuse(RCREATE, error_ROLE_PERMISSION_DENIED, W_EQUITY),
    refuse(RCREATE, error_NOT_AUTHENTICATED, W_SIGNED_OUT),
  ],
  budget: WRITE_BUDGET,
});

const RINVITE = "org.round.invite";
export const operation_org_round_invite = defineOperation({
  ...frozenText(RINVITE),
  priority: "low",
  implementedBy: f.flow_client_org_rounds_invite,
  acceptance: [],
  returns: sh.InviteReturns,
  errors: ERRORS,
  refusals: [refuse(RINVITE, error_ROUND_CLOSED, W_ROUND_ALLOCATED), refuse(RINVITE, error_ROLE_PERMISSION_DENIED, W_ROUND_OPEN)],
  budget: WRITE_BUDGET,
});

const RALLOC = "org.round.allocate";
export const operation_org_round_allocate = defineOperation({
  ...frozenText(RALLOC),
  priority: "low",
  implementedBy: f.flow_client_org_rounds_allocate,
  acceptance: [],
  returns: sh.AllocateReturns,
  errors: ERRORS,
  refusals: [refuse(RALLOC, error_INVALID_INPUT, W_ROUND_OPEN), refuse(RALLOC, error_ROLE_PERMISSION_DENIED, W_ROUND_OPEN)],
  budget: WRITE_BUDGET,
});

const RCLOSE = "org.round.close";
export const operation_org_round_close = defineOperation({
  ...frozenText(RCLOSE),
  priority: "low",
  implementedBy: f.flow_client_org_rounds_close,
  acceptance: [],
  returns: sh.CloseReturns,
  errors: ERRORS,
  refusals: [refuse(RCLOSE, error_CONSENT_MISSING, W_ROUND_ALLOCATED), refuse(RCLOSE, error_ROLE_PERMISSION_DENIED, W_ROUND_ALLOCATED)],
  budget: WRITE_BUDGET,
});

const RCANCEL = "org.round.cancel";
export const operation_org_round_cancel = defineOperation({
  ...frozenText(RCANCEL),
  priority: "low",
  implementedBy: f.flow_client_org_rounds_cancel,
  acceptance: [],
  returns: sh.CancelReturns,
  errors: ERRORS,
  refusals: [refuse(RCANCEL, error_WRONG_STATE, W_ROUND_ALLOCATED)],
  budget: WRITE_BUDGET,
});

const RSHOW = "org.round.show";
export const operation_org_round_show = defineOperation({
  ...frozenText(RSHOW),
  priority: "low",
  implementedBy: rpc_equity_rounds_show,
  acceptance: [],
  returns: sh.RoundShowReturns,
  errors: ERRORS,
  refusals: [refuse(RSHOW, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF), refuse(RSHOW, error_INVALID_INPUT, W_ROUND_OPEN)],
  budget: budget("read"),
});

// ── SAFE rounds ─────────────────────────────────────────────────────────────────────────────

const SCREATE = "org.safe.create";
export const operation_org_safe_create = defineOperation({
  ...frozenText(SCREATE),
  priority: "low",
  implementedBy: f.flow_client_org_safes_create,
  acceptance: [
    rewrite(
      SCREATE,
      1,
      "A SAFE round is proposed to the Board once, and the same round again answers that proposal.",
      "cli: the second run prints the same proposalId and safeRoundId; world: one proposal",
    ),
    rewrite(
      SCREATE,
      2,
      "An executed round is reported (`opened`) once, and a rejected one never.",
      REPORTED("opened") + "; trace: one fundraise_round_transitioned proposed → open with kind safe",
    ),
  ],
  returns: sh.SafeCreateReturns,
  errors: ERRORS,
  refusals: [
    refuse(SCREATE, error_INVALID_INPUT, W_EQUITY),
    refuse(SCREATE, error_WRONG_STATE, W_NO_EQUITY),
    refuse(SCREATE, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
    refuse(SCREATE, error_ROLE_PERMISSION_DENIED, W_EQUITY),
    refuse(SCREATE, error_NOT_AUTHENTICATED, W_SIGNED_OUT),
  ],
  budget: WRITE_BUDGET,
});

const SINVITE = "org.safe.invite";
export const operation_org_safe_invite = defineOperation({
  ...frozenText(SINVITE),
  priority: "low",
  implementedBy: f.flow_client_org_safes_invite,
  acceptance: [],
  returns: sh.InviteReturns,
  errors: ERRORS,
  refusals: [refuse(SINVITE, error_ROUND_CLOSED, W_SAFE_ROUND), refuse(SINVITE, error_ROLE_PERMISSION_DENIED, W_SAFE_ROUND)],
  budget: WRITE_BUDGET,
});

const SCLOSE = "org.safe.close";
export const operation_org_safe_close = defineOperation({
  ...frozenText(SCLOSE),
  priority: "low",
  implementedBy: f.flow_client_org_safes_close,
  acceptance: [],
  returns: sh.SafeCloseReturns,
  errors: ERRORS,
  refusals: [refuse(SCLOSE, error_ROUND_CLOSED, W_SAFE_ROUND), refuse(SCLOSE, error_ROLE_PERMISSION_DENIED, W_SAFE_ROUND)],
  budget: WRITE_BUDGET,
});

const SSHOW = "org.safe.show";
export const operation_org_safe_show = defineOperation({
  ...frozenText(SSHOW),
  priority: "low",
  implementedBy: rpc_equity_safes_show,
  acceptance: [],
  returns: sh.SafeShowReturns,
  errors: ERRORS,
  refusals: [refuse(SSHOW, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF), refuse(SSHOW, error_INVALID_INPUT, W_SAFE_ROUND)],
  budget: budget("read"),
});

// ── investors ───────────────────────────────────────────────────────────────────────────────

const INVEST = "invest";
export const operation_invest = defineOperation({
  ...frozenText(INVEST),
  priority: "low",
  implementedBy: rpc_equity_investments_list,
  acceptance: [],
  returns: Schema.Array(sh.InvestOffer),
  errors: ERRORS,
  refusals: [refuse(INVEST, error_ROLE_PERMISSION_DENIED, W_ROUND_OPEN)],
  budget: budget("read"),
});

const ISHOW = "invest.show";
export const operation_invest_show = defineOperation({
  ...frozenText(ISHOW),
  priority: "low",
  implementedBy: rpc_equity_investments_get,
  acceptance: [],
  returns: sh.InvestShowReturns,
  errors: ERRORS,
  refusals: [refuse(ISHOW, error_ROLE_PERMISSION_DENIED, W_ROUND_OPEN)],
  budget: budget("read"),
});

const COMMIT = "invest.commit";
export const operation_invest_commit = defineOperation({
  ...frozenText(COMMIT),
  priority: "low",
  implementedBy: f.flow_client_me_invest_commit,
  acceptance: [],
  returns: sh.CommitReturns,
  errors: ERRORS,
  refusals: [refuse(COMMIT, error_INVALID_INPUT, W_ROUND_OPEN), refuse(COMMIT, error_ROUND_CLOSED, W_ROUND_ALLOCATED)],
  budget: WRITE_BUDGET,
});

const PAY = "invest.pay";
export const operation_invest_pay = defineOperation({
  ...frozenText(PAY),
  priority: "low",
  implementedBy: f.flow_client_me_invest_pay,
  acceptance: [],
  returns: sh.PayReturns,
  errors: ERRORS,
  refusals: [refuse(PAY, error_ROUND_CLOSED, W_ROUND_ALLOCATED), refuse(PAY, error_WRONG_STATE, W_ROUND_ALLOCATED)],
  budget: WRITE_BUDGET,
});

const SIGN = "invest.sign";
export const operation_invest_sign = defineOperation({
  ...frozenText(SIGN),
  priority: "low",
  implementedBy: f.flow_client_me_invest_sign,
  acceptance: [],
  returns: sh.SignReturns,
  errors: ERRORS,
  refusals: [
    refuse(SIGN, error_ROUND_CLOSED, W_SAFE_ROUND),
    refuse(SIGN, error_INVALID_INPUT, W_SAFE_ROUND),
    refuse(SIGN, error_ROLE_PERMISSION_DENIED, W_SAFE_ROUND),
  ],
  budget: WRITE_BUDGET,
});

// ── votes ───────────────────────────────────────────────────────────────────────────────────

const VCREATE = "org.vote.create";
export const operation_org_vote_create = defineOperation({
  ...frozenText(VCREATE),
  priority: "low",
  implementedBy: f.flow_client_org_votes_create,
  acceptance: [
    keep(VCREATE, 1, "chain: `authorise --class Common` proposes one Captable.setAuthorised on Common's class id; cli: an unknown class exits INVALID_INPUT naming the company's classes"),
    keep(VCREATE, 2, "cli as the member of org-with-equity who holds no shares: BELOW_THRESHOLD; " + NOTHING),
    keep(VCREATE, 3, "world org-with-votes: `org vote show` reads `lapsed` for the vote whose approval expired unsigned, and each proposed vote as Governor.state answers"),
    rewrite(
      VCREATE,
      4,
      "A landed proposal is reported `opened` once; a reverted one reports nothing.",
      "trace: exactly one equity_write_transitioned to `landed` with change `opened` and one vote_transitioned proposing → proposed; a reverted one: the write `failed`, none landed",
    ),
    rewrite(
      VCREATE,
      5,
      "The proposer signs only a propose whose description names the vote and whose proposal id is OpenZeppelin's hashProposal of its calls.",
      "chain: ProposalCreated's description names the vote id and its proposalId equals hashProposal(targets, values, calldatas, keccak256(description))",
    ),
    rewrite(
      VCREATE,
      6,
      "The proposer signs only their own vote approval, and the command reads the vote until the Governor holds it.",
      "chain: the operation's sender is the proposer's own Safe; cli: it returns once `org vote show` would read `pending`",
    ),
  ],
  returns: sh.VoteReturns,
  errors: ERRORS,
  refusals: [
    refuse(VCREATE, error_BELOW_THRESHOLD, W_EQUITY),
    refuse(VCREATE, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
    refuse(VCREATE, error_INVALID_INPUT, W_EQUITY),
    { error: error_RESERVED_MATTER, given: W_EQUITY, when: designedWhen(VCREATE, "RESERVED_MATTER") },
  ],
  budget: WRITE_BUDGET,
});

const VEXEC = "org.vote.execute";
export const operation_org_vote_execute = defineOperation({
  ...frozenText(VEXEC),
  priority: "low",
  implementedBy: f.flow_client_org_votes_execute,
  acceptance: [
    keep(VEXEC, 1, "cli on org-with-votes: the active vote exits WRONG_STATE naming when it closes, the executed one when it ran, the defeated one `defeated`"),
    rewrite(
      VEXEC,
      2,
      "A second execution of a vote is refused while one is on its way, even when both are asked at once.",
      "cli: of two executes of the succeeded vote run together, one prepares and the other exits WRONG_STATE; world: one execution write",
    ),
    rewrite(
      VEXEC,
      3,
      "An execution is sent once and followed to the chain; an executed vote is reported `executed` once.",
      "chain: one Governor.execute operation and ProposalExecuted; " + REPORTED("executed"),
    ),
    rewrite(
      VEXEC,
      4,
      "The execute signed carries the vote's calls and the hash of its description; another description is refused.",
      "chain: the operation's calldata is Governor.execute of the vote's targets, values, calldatas and keccak256(description); cli: a mismatched description exits before signing",
    ),
    rewrite(
      VEXEC,
      5,
      "The executor's own Safe signs only the execute of the vote's own calls and description, and the command reads the execution until the Governor ran it.",
      "chain: the sender is the executor's own Safe; cli: it returns `executed` with executedAt the block's time",
    ),
  ],
  returns: sh.ExecuteReturns,
  errors: ERRORS,
  refusals: [
    refuse(VEXEC, error_WRONG_STATE, W_VOTES),
    refuse(VEXEC, error_INVALID_INPUT, W_VOTES),
    refuse(VEXEC, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
  ],
  budget: WRITE_BUDGET,
});

const VLIST = "org.vote.list";
export const operation_org_vote_list = defineOperation({
  ...frozenText(VLIST),
  priority: "low",
  implementedBy: rpc_equity_votes_list,
  acceptance: [
    keep(VLIST, 1, "read on a company with 51 votes: 50 rows, newest first, none of another company's"),
    rewrite(VLIST, 2, "`org vote list --org <org>` lists only that company's votes.", "read: two companies' lists share no vote"),
  ],
  returns: sh.VotesReturns,
  errors: ERRORS,
  refusals: [refuse(VLIST, error_ROLE_PERMISSION_DENIED, W_VOTES)],
  budget: budget("chain-read"),
});

const VSHOW = "org.vote.show";
export const operation_org_vote_show = defineOperation({
  ...frozenText(VSHOW),
  priority: "low",
  implementedBy: rpc_equity_votes_get,
  acceptance: [
    keep(VSHOW, 1, "read: tally for, against and abstain equal Governor.proposalVotes for the active vote of org-with-votes"),
    keep(VSHOW, 2, "read: quorumReached is null for the pending vote, true only when for plus abstain reach Governor.quorum at the snapshot"),
  ],
  returns: sh.VoteReturns,
  errors: ERRORS,
  refusals: [refuse(VSHOW, error_INVALID_INPUT, W_VOTES)],
  budget: budget("chain-read"),
});

const VWAIT = "org.vote.wait";
export const operation_org_vote_wait = defineOperation({
  ...frozenText(VWAIT),
  priority: "low",
  implementedBy: f.flow_client_org_votes_wait,
  acceptance: [
    keep(VWAIT, 1, "cli with `dev time warp` past voteEnd: it returns the vote once it reads succeeded or defeated, never while pending or active"),
    keep(VWAIT, 2, "cli `--until executed` on the defeated vote of org-with-votes: WRONG_STATE at once"),
  ],
  returns: sh.VoteReturns,
  errors: ERRORS,
  refusals: [refuse(VWAIT, error_INVALID_INPUT, W_VOTES), refuse(VWAIT, error_WRONG_STATE, W_VOTES)],
  budget: { ...budget("chain-read"), excludes: ["wait.chain"] },
});

const CAST = "vote.cast";
export const operation_vote_cast = defineOperation({
  ...frozenText(CAST),
  priority: "low",
  implementedBy: f.flow_client_me_votes_cast,
  acceptance: [
    keep(CAST, 1, "cli: a second cast exits WRONG_STATE naming the first ballot's side; on the pending vote, WRONG_STATE saying when it opens"),
    keep(CAST, 2, "cli as a holder with no votes at the snapshot, and with a ballot on its way: WRONG_STATE; " + NOTHING),
    rewrite(
      CAST,
      3,
      "A counted ballot is sent once, followed to the chain and reported `cast` once with its side; a reverted one reports nothing.",
      "chain: one VoteCast; trace: exactly one equity_write_transitioned to `landed` with change `cast` and its support; a reverted one: the write `failed`, none landed",
    ),
    rewrite(
      CAST,
      4,
      "The ballot signed is the Governor's castVoteWithReason carrying the proposal, OpenZeppelin's support and the reason.",
      "chain: the operation's calldata decodes to Governor.castVoteWithReason(proposalId, support, reason) with support 0, 1 or 2 as asked",
    ),
    rewrite(
      CAST,
      5,
      "The voter signs only their own ballot approval, and the command reads the ballot until the Governor counted it.",
      "chain: the sender is the voter's own Safe; cli: it returns `cast` once VoteCast is indexed",
    ),
    rewrite(CAST, 6, "No operation is signed that casts another way than asked.", "chain: every signed ballot's support equals the side the command was given"),
  ],
  returns: sh.CastReturns,
  errors: ERRORS,
  refusals: [
    refuse(CAST, error_WRONG_STATE, W_VOTES),
    refuse(CAST, error_INVALID_INPUT, W_VOTES),
    refuse(CAST, error_FEATURE_NOT_AVAILABLE, W_EQUITY_OFF),
  ],
  budget: WRITE_BUDGET,
});

const DELEGATE = "vote.delegate";
export const operation_vote_delegate = defineOperation({
  ...frozenText(DELEGATE),
  priority: "low",
  implementedBy: f.flow_client_me_votes_delegate,
  acceptance: [],
  returns: sh.DelegateReturns,
  errors: ERRORS,
  refusals: [refuse(DELEGATE, error_INVALID_INPUT, W_EQUITY), refuse(DELEGATE, error_NOT_AUTHENTICATED, W_SIGNED_OUT)],
  budget: WRITE_BUDGET,
});

const VMINE = "vote.list";
export const operation_vote_list = defineOperation({
  ...frozenText(VMINE),
  priority: "low",
  implementedBy: rpc_equity_votes_mine,
  acceptance: [
    keep(VMINE, 1, "read on org-with-votes: the active vote before the pending one whose close is not yet known"),
    rewrite(
      VMINE,
      2,
      "`vote list --json` gives each open vote with the documented fields, in the order of the first line.",
      "cli: each row has voteId, org, matter, status, opensAt, closesAt, votes and voted, in the order line 1 claims",
    ),
  ],
  returns: sh.MyVotesReturns,
  errors: ERRORS,
  refusals: [refuse(VMINE, error_NOT_AUTHENTICATED, W_SIGNED_OUT)],
  budget: budget("chain-read"),
});

/** Every equity operation record, for decisions. */
export const OPERATIONS = [
  operation_org_equity_setup,
  operation_org_equity_issue,
  operation_org_cap_table,
  operation_org_options_grant,
  operation_org_options_end,
  operation_org_options_show,
  operation_shares_accept,
  operation_shares_exercise,
  operation_shares,
  operation_shares_convert,
  operation_shares_sell,
  operation_org_equity_transfer_approve,
  operation_org_exit_preview,
  operation_org_exit_pay,
  operation_org_round_preview,
  operation_org_round_create,
  operation_org_round_invite,
  operation_org_round_allocate,
  operation_org_round_close,
  operation_org_round_cancel,
  operation_org_round_show,
  operation_org_safe_create,
  operation_org_safe_invite,
  operation_org_safe_close,
  operation_org_safe_show,
  operation_invest,
  operation_invest_show,
  operation_invest_commit,
  operation_invest_pay,
  operation_invest_sign,
  operation_org_vote_create,
  operation_org_vote_execute,
  operation_org_vote_list,
  operation_org_vote_show,
  operation_org_vote_wait,
  operation_vote_cast,
  operation_vote_delegate,
  operation_vote_list,
] as const;
