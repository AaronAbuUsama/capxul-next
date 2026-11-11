// Moved out of the built book by the cut, 10 November 2026, from books/target/journeys.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision, defineJourney, type Ref } from "../../packages/book/src/index.ts";
import type { system_capxul } from "./shared/foundation.ts";
import * as access from "./access/operations.ts";
import * as accounts from "./accounts/operations.ts";
import * as activity from "./activity/operations.ts";
import * as agents from "./agents/operations.ts";
import * as applications from "./applications/operations.ts";
import * as banking from "./banking/operations.ts";
import * as board from "./board/operations.ts";
import * as books from "./books/operations.ts";
import * as budgets from "./budgets/operations.ts";
import * as contacts from "./contacts/operations.ts";
import * as devnet from "./devnet/operations.ts";
import * as documents from "./documents/operations.ts";
import * as equity from "./equity/operations.ts";
import * as organizations from "./organizations/operations.ts";
import * as payments from "./payments/operations.ts";
import * as payroll from "./payments/agreements/operations.ts";
import * as requests from "./requests/operations.ts";
import { event_session_transitioned } from "./access/data.ts";
import { event_referral_transitioned } from "./accounts/data.ts";
import { event_agent_change_transitioned, event_agent_transitioned } from "./agents/data.ts";
import { event_app_key_transitioned } from "./applications/data.ts";
import { event_approval_transitioned } from "./approvals/data.ts";
import {
  event_bank_account_transitioned,
  event_bank_deposit_match_transitioned,
  event_bank_details_transitioned,
  event_bank_payout_transitioned,
  event_verification_transitioned,
} from "./banking/data.ts";
import { event_board_change_transitioned, event_proposal_transitioned } from "./board/data.ts";
import { event_book_annotation_transitioned } from "./books/data.ts";
import { event_budget_change_transitioned, event_budget_transitioned } from "./budgets/data.ts";
import { event_contact_transitioned } from "./contacts/data.ts";
import {
  event_equity_grant_transitioned,
  event_equity_install_transitioned,
  event_equity_write_transitioned,
  event_fundraise_investment_transitioned,
  event_fundraise_round_transitioned,
  event_share_sale_transitioned,
  event_vote_transitioned,
} from "./equity/data.ts";
import { event_org_invite_transitioned, event_org_setup_transitioned } from "./organizations/data.ts";
import { event_payment_transitioned } from "./payments/data.ts";
import { event_agreement_transitioned, event_agreement_write_transitioned } from "./payments/agreements/data.ts";
import { event_request_transitioned } from "./requests/data.ts";

export const journey_own_equity = defineJourney({
  id: "own_equity",
  title: "Own equity",
  about:
    "A Director switches equity on, issues shares and grants options; the grantee accepts and exercises; shareholders " +
    "convert and sell, a Director approves the transfer and the company pays out an exit; the old finish is 'a grantee " +
    "exercises options and holds shares on the cap table'. Each change lands as an equity write; where it moves an " +
    "object with its own machine (the install, a grant, a sale), that machine's event proves it, and where it changes " +
    "only holdings on chain (an issue, an exercise, a conversion, an exit), the equity write's own event does.",
  steps: [
    step(equity.operation_org_equity_setup, "director", event_equity_install_transitioned),
    step(equity.operation_org_cap_table, "member", "success"),
    step(equity.operation_org_equity_issue, "director", event_equity_write_transitioned),
    step(equity.operation_org_options_grant, "director", event_equity_grant_transitioned),
    step(equity.operation_org_options_show, "member", "success"),
    step(equity.operation_shares, "grantee", "success"),
    step(equity.operation_shares_accept, "grantee", event_equity_grant_transitioned),
    step(equity.operation_shares_exercise, "grantee", event_equity_write_transitioned),
    step(equity.operation_org_options_end, "director", event_equity_grant_transitioned),
    step(equity.operation_shares_convert, "shareholder", event_equity_write_transitioned),
    step(equity.operation_shares_sell, "shareholder", event_share_sale_transitioned),
    step(equity.operation_org_equity_transfer_approve, "director", event_share_sale_transitioned),
    step(equity.operation_org_exit_preview, "member", "success"),
    step(equity.operation_org_exit_pay, "director", event_equity_write_transitioned),
  ],
  was: [`${OLD}/own_equity.yaml (no chapters)`, `${CATALOG}:81`, `${CONTRACTS}/own-equity-contract.ts`],
});

export const journey_raise_money = defineJourney({
  id: "raise_money",
  title: "Raise money",
  about:
    "A Director raises on a SAFE and in a priced round: creates it, invites investors, who sign, commit and pay, " +
    "allocates and closes it; the old finish is 'investors pay and the round closes'. A SAFE or round's own steps are " +
    "the round machine's, an investor's the investment machine's. `org round cancel` is taken on a second round the " +
    "scenario's world holds, since the first one closes.",
  steps: [
    step(equity.operation_org_safe_create, "director", event_fundraise_round_transitioned),
    step(equity.operation_org_safe_invite, "director", event_fundraise_investment_transitioned),
    step(equity.operation_invest, "investor", "success"),
    step(equity.operation_invest_show, "investor", "success"),
    step(equity.operation_invest_sign, "investor", event_fundraise_investment_transitioned),
    step(equity.operation_org_safe_show, "member", "success"),
    step(equity.operation_org_safe_close, "director", event_fundraise_round_transitioned),
    step(equity.operation_org_round_preview, "member", "success"),
    step(equity.operation_org_round_create, "director", event_fundraise_round_transitioned),
    step(equity.operation_org_round_invite, "director", event_fundraise_investment_transitioned),
    step(equity.operation_org_round_show, "member", "success"),
    step(equity.operation_invest_commit, "investor", event_fundraise_investment_transitioned),
    step(equity.operation_org_round_allocate, "director", event_fundraise_round_transitioned),
    step(equity.operation_invest_pay, "investor", event_fundraise_investment_transitioned),
    step(equity.operation_org_round_close, "director", event_fundraise_round_transitioned),
    step(equity.operation_org_round_cancel, "director", event_fundraise_round_transitioned),
  ],
  was: [`${OLD}/raise_money.yaml (no chapters)`, `${CATALOG}:86`, `${CONTRACTS}/raise-money-contract.ts`],
});

const JOURNEYS = [
  journey_get_started,
  journey_get_verified,
  journey_money_in,
  journey_pay_someone,
  journey_get_paid,
  journey_run_company,
  journey_govern_company,
  journey_build_on_capxul,
  journey_close_the_books,
  journey_own_equity,
  journey_raise_money,
  journey_delegate_to_agent,
  journey_refer_someone,
];
