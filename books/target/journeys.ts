// The target book's journeys: the old book's 13 (apps/docs/factory/journeys/*.yaml in the old
// repository, each a key, its operations in order and its chapters), as journey records. Each step is
// the target record of a frozen operation, the system actor who takes it (shared/foundation.ts,
// system_capxul) and what proves it for the funnel: the `<machine>_transitioned` event of the machine
// whose state that operation changes, or `success`, the operation's own outcome, when it changes none
// (policy P7). The judgments, decision records at the end of this file:
//
//   journeys.onto-target     how a journey, its steps, actors and proofs map onto the target
//   journeys.variants        which old variants survive as properties of the step events
//   journeys.steps           the optional operations left out, and the four refused `org director` writes
//
// This file has one writer; it only imports the concepts' operations and events.

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
import * as payroll from "./payroll/operations.ts";
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
import { event_agreement_transitioned, event_agreement_write_transitioned } from "./payroll/data.ts";
import { event_request_transitioned, event_service_transitioned } from "./requests/data.ts";

/** A system actor of system_capxul: the compiler refuses an actor the system does not list. */
type Actor = (typeof system_capxul)["actors"][number]["id"];

/** One step: the operation, who takes it, and the event that proves it (or the operation's own success). */
const step = (operation: Ref<"operation">, as: Actor, proves: Ref<"event"> | "success") => ({ operation, as, proves });

const OLD = "apps/docs/factory/journeys";
const CATALOG = "packages/observability/src/catalog/journeys.ts";
const CONTRACTS = "packages/tools/src/modules/analytics/internal";
const LEFT_OUT = "Left out as reads and changes along the way (journeys.steps):";

// ── get started ─────────────────────────────────────────────────────────────────────────────

export const journey_get_started = defineJourney({
  id: "get_started",
  title: "Get started",
  about:
    "From an email address to a signed-in person who sees their account set up; the old finish is 'the account is ready: " +
    "the person's Safe is live'. The Safe's setup runs in the web app (accounts.setup-in-web-app), so the CLI steps end " +
    "at reading it: `account show` and `account retry` are reads. From a script `auth login` sends the code and stops " +
    "with `otp-required` (sending a code drives no transition); `auth verify` opens the session, which " +
    "`session_transitioned` proves. " + LEFT_OUT + " `waitlist join`, `waitlist status`, `auth list`, `auth switch`, " +
    "`use personal`, `auth logout`.",
  steps: [
    step(accounts.operation_auth_login, "anyone", "success"),
    step(accounts.operation_auth_verify, "anyone", event_session_transitioned),
    step(access.operation_whoami, "person", "success"),
    step(accounts.operation_account_show, "person", "success"),
    step(accounts.operation_account_retry, "person", "success"),
  ],
  was: [`${OLD}/get_started.yaml (chapters S1, S13, S14, S29)`, `${CATALOG}:34`, `${CONTRACTS}/contracts.ts:34`],
});

// ── get verified ────────────────────────────────────────────────────────────────────────────

export const journey_get_verified = defineJourney({
  id: "get_verified",
  title: "Get verified",
  about:
    "A person, or a Director for their Organization, starts identity or business verification and follows it to Bridge's " +
    "decision; the old finish is 'approved for bank transfers'. `verify start` begins (or answers) the verification, and " +
    "Bridge's later decision is the same machine's `approve` or `reject`; `verify status` is a read.",
  steps: [
    step(banking.operation_verify_start, "person", event_verification_transitioned),
    step(banking.operation_verify_status, "person", "success"),
  ],
  variants: ["subject"],
  was: [`${OLD}/get_verified.yaml (chapters S8, S29)`, `${CATALOG}:39`, `${CONTRACTS}/verification-contract.ts`],
});

// ── money in ────────────────────────────────────────────────────────────────────────────────

export const journey_money_in = defineJourney({
  id: "money_in",
  title: "Money in",
  about:
    "Money reaches a person's Safe, by bank or by test funds, and they see it; the old finish is 'the first balance above " +
    "0'. `bank details` opens the person's deposit details on first use (`bank_details_transitioned`); `dev fund` mints " +
    "test money and answers at broadcast, storing nothing, so its own success proves it; `bank match` matches a deposit " +
    "to a request or marks it as none, and the deposit's match machine moves on either answer; `bank settle` changes " +
    "where the details settle. `address`, `balance` and `bank deposits` are reads.",
  steps: [
    step(activity.operation_address, "person", "success"),
    step(banking.operation_bank_details, "person", event_bank_details_transitioned),
    step(accounts.operation_dev_fund, "person", "success"),
    step(activity.operation_balance, "person", "success"),
    step(banking.operation_bank_deposits, "person", "success"),
    step(requests.operation_bank_match, "person", event_bank_deposit_match_transitioned),
    step(banking.operation_bank_settle, "person", event_bank_details_transitioned),
  ],
  was: [`${OLD}/money_in.yaml (chapter S1)`, `${CATALOG}:44`, `${CONTRACTS}/money-in-contract.ts`],
});

// ── pay someone ─────────────────────────────────────────────────────────────────────────────

export const journey_pay_someone = defineJourney({
  id: "pay_someone",
  title: "Pay someone",
  about:
    "A person, or an Organization's budget, pays someone on chain or to a bank account; the old finish is 'the payment " +
    "settles, or the recipient claims it when they had no account'. The address book steps are the person's; `contact " +
    "add` and `contact label` change no state machine (an entry is born listed), so their success proves them. A Board " +
    "payment waits for a Director's `org proposal approve`, proved by the approval it opens. `payment retry` and `bank " +
    "accounts remove` are taken on a second payment and account the scenario's world holds. " + LEFT_OUT +
    " `contact list`, `contact get`, `payment reschedule`, `payment cancel`, `bank accounts`.",
  steps: [
    step(contacts.operation_contact_add, "person", "success"),
    step(contacts.operation_contact_label, "person", "success"),
    step(contacts.operation_contact_hide, "person", event_contact_transitioned),
    step(contacts.operation_contact_unhide, "person", event_contact_transitioned),
    step(payments.operation_payment_send, "payer", event_payment_transitioned),
    step(board.operation_org_proposal_approve, "director", event_approval_transitioned),
    step(payments.operation_payment_wait, "payer", "success"),
    step(payments.operation_payment_get, "payer", "success"),
    step(payments.operation_payment_retry, "payer", event_payment_transitioned),
    step(payments.operation_payment_list, "payer", "success"),
    step(banking.operation_bank_accounts_add, "person", event_bank_account_transitioned),
    step(banking.operation_contact_bank_add, "person", event_bank_account_transitioned),
    step(banking.operation_bank_pay, "payer", event_bank_payout_transitioned),
    step(banking.operation_bank_accounts_remove, "person", event_bank_account_transitioned),
  ],
  variants: ["owner_kind", "route"],
  was: [`${OLD}/pay_someone.yaml (chapters S1, S8, S9, S10, S11)`, `${CATALOG}:49`, `${CONTRACTS}/pay-someone-contract.ts`],
});

// ── get paid ────────────────────────────────────────────────────────────────────────────────

export const journey_get_paid = defineJourney({
  id: "get_paid",
  title: "Get paid",
  about:
    "A person or an Organization puts a service on sale, issues a request or an invoice, and the payer pays it from their " +
    "inbox; the old finish is 'the invoice or request is paid'. The service steps are its owner's, the request steps the " +
    "payee's and the inbox steps the payer's. `request cancel` and `inbox decline` are taken on other requests the " +
    "scenario's world holds, so each step still happens once. " + LEFT_OUT + " `service list`, `service get`, `request list`.",
  steps: [
    step(requests.operation_service_create, "owner", event_service_transitioned),
    step(requests.operation_service_revise, "owner", event_service_transitioned),
    step(requests.operation_request_issue, "payee", event_request_transitioned),
    step(requests.operation_request_get, "payee", "success"),
    step(requests.operation_request_cancel, "payee", event_request_transitioned),
    step(requests.operation_inbox_list, "payer", "success"),
    step(requests.operation_inbox_get, "payer", "success"),
    step(requests.operation_inbox_pay, "payer", event_request_transitioned),
    step(requests.operation_inbox_decline, "payer", event_request_transitioned),
    step(activity.operation_activity_list, "payee", "success"),
    step(requests.operation_service_deactivate, "owner", event_service_transitioned),
  ],
  variants: ["owner_kind", "payer_kind"],
  was: [`${OLD}/get_paid.yaml (chapters S8, S11)`, `${CATALOG}:54`, `${CONTRACTS}/get-paid-contract.ts`],
});

// ── run a company ───────────────────────────────────────────────────────────────────────────

export const journey_run_company = defineJourney({
  id: "run_company",
  title: "Run a company",
  about:
    "A founder sets up an Organization, brings people in, seats a second Director, gives budgets and departments their " +
    "money and holders, offers agreements and pays from a department; the old finish is 'a payroll run settles'. The " +
    "founder takes the setup steps, the People officer the invitations, the invitee their answer, the Directors the " +
    "budgets and Board proposals, the department's office holder its agreements and its payment, and the payee their " +
    "acceptance and collection. `org create` follows the setup to ready, and `org retry` on a ready setup returns it as " +
    "it is: `resume` moves only a setup that needs attention, so `org retry` changes no machine here and its own success " +
    "proves it, as `account retry` does in get_started. The old `org director add` refuses on v4, so the founder seats " +
    "the Director with `org board director add` (journeys.steps). Budget changes are Board proposals that land as `budget_change_transitioned`; " +
    "a new allowance or department is the budget machine's own birth. `org invite cancel` and `invite decline`, and " +
    "`org agreement withdraw`, are taken on second invitations and offers the scenario's world holds. Left out " +
    "(journeys.steps): the eleven optional books operations and nineteen reads and changes along the way.",
  steps: [
    step(organizations.operation_org_create, "founder", event_org_setup_transitioned),
    step(organizations.operation_org_retry, "founder", "success"),
    step(organizations.operation_org_show, "founder", "success"),
    step(budgets.operation_org_member_invite, "office-holder", event_org_invite_transitioned),
    step(organizations.operation_org_invite_resend, "office-holder", event_org_invite_transitioned),
    step(organizations.operation_org_invite_cancel, "office-holder", event_org_invite_transitioned),
    step(organizations.operation_invite_list, "invitee", "success"),
    step(banking.operation_invite_accept, "invitee", event_org_invite_transitioned),
    step(organizations.operation_invite_decline, "invitee", event_org_invite_transitioned),
    step(board.operation_org_board_director_add, "founder", event_board_change_transitioned),
    step(budgets.operation_org_allowance_create, "director", event_budget_transitioned),
    step(budgets.operation_org_allowance_change, "director", event_budget_change_transitioned),
    step(budgets.operation_org_allowance_assign, "director", event_budget_change_transitioned),
    step(budgets.operation_org_allowance_revoke, "director", event_budget_change_transitioned),
    step(board.operation_org_proposal_approve, "director", event_approval_transitioned),
    step(board.operation_org_proposal_reject, "director", event_proposal_transitioned),
    step(budgets.operation_org_department_create, "director", event_budget_transitioned),
    step(budgets.operation_org_department_holder_add, "director", event_budget_change_transitioned),
    step(payroll.operation_org_agreement_offer, "office-holder", event_agreement_transitioned),
    step(payroll.operation_org_agreement_withdraw, "office-holder", event_agreement_transitioned),
    step(payroll.operation_agreement_accept, "payee", event_agreement_transitioned),
    step(payroll.operation_agreement_collect, "payee", event_agreement_write_transitioned),
    step(payroll.operation_org_agreement_change, "office-holder", event_agreement_write_transitioned),
    step(payroll.operation_org_agreement_pause, "office-holder", event_agreement_transitioned),
    step(payroll.operation_org_agreement_resume, "office-holder", event_agreement_transitioned),
    step(payroll.operation_org_agreement_end, "office-holder", event_agreement_transitioned),
    step(budgets.operation_org_department_holder_remove, "director", event_budget_change_transitioned),
    step(budgets.operation_org_department_budget_set, "director", event_budget_change_transitioned),
    step(budgets.operation_org_department_ceiling_freeze, "director", event_budget_change_transitioned),
    step(budgets.operation_org_department_ceiling_set, "director", event_budget_change_transitioned),
    step(budgets.operation_org_department_ceiling_unfreeze, "director", event_budget_change_transitioned),
    step(payments.operation_org_department_pay, "office-holder", event_payment_transitioned),
  ],
  was: [`${OLD}/run_company.yaml (chapters S1 to S8, S11, S12)`, `${CATALOG}:59`, `${CONTRACTS}/run-company-contract.ts`],
});

// ── govern the company ──────────────────────────────────────────────────────────────────────

export const journey_govern_company = defineJourney({
  id: "govern_company",
  title: "Govern the company",
  about:
    "The members read the Board and its proposals, the founder seats, removes and hands over the Board, an elected " +
    "Director claims their seat, and the shareholders vote and execute the result; the old finish is 'a board or " +
    "shareholder decision executes'. Every Board change is a `board_change_transitioned`; a vote's birth and its " +
    "execution are the vote machine's, and a delegation or a cast ballot, which changes no vote's state, is the equity " +
    "write it lands as. The old `org director remove`, `replace` and `threshold` refuse on v4 and their `org board` " +
    "commands are steps here already, so they are left out (journeys.steps).",
  steps: [
    step(board.operation_org_director_list, "member", "success"),
    step(board.operation_org_proposal_list, "member", "success"),
    step(board.operation_org_proposal_get, "member", "success"),
    step(board.operation_org_proposal_wait, "member", "success"),
    step(board.operation_org_board_show, "member", "success"),
    step(board.operation_org_board_director_add, "founder", event_board_change_transitioned),
    step(board.operation_org_board_director_remove, "founder", event_board_change_transitioned),
    step(board.operation_org_board_threshold, "founder", event_board_change_transitioned),
    step(board.operation_org_board_handover, "founder", event_board_change_transitioned),
    step(board.operation_org_board_claim, "director", event_board_change_transitioned),
    step(board.operation_org_board_refresh, "member", event_board_change_transitioned),
    step(equity.operation_org_vote_create, "shareholder", event_vote_transitioned),
    step(equity.operation_org_vote_list, "member", "success"),
    step(equity.operation_org_vote_show, "shareholder", "success"),
    step(equity.operation_vote_list, "shareholder", "success"),
    step(equity.operation_vote_delegate, "shareholder", event_equity_write_transitioned),
    step(equity.operation_vote_cast, "shareholder", event_equity_write_transitioned),
    step(equity.operation_org_vote_wait, "shareholder", "success"),
    step(equity.operation_org_vote_execute, "shareholder", event_vote_transitioned),
  ],
  was: [`${OLD}/govern_company.yaml (chapters S1, S6, S7, S11)`, `${CATALOG}:64`, `${CONTRACTS}/govern-company-contract.ts`],
});

// ── build on Capxul ─────────────────────────────────────────────────────────────────────────

export const journey_build_on_capxul = defineJourney({
  id: "build_on_capxul",
  title: "Build on Capxul",
  about:
    "A developer checks the setup, chooses the environment, makes and rotates a publishable key and drives a local " +
    "devnet to the end of a scripted flow; the old finish is 'a developer's scripted flow runs to the end on devnet'. " +
    "Only the key changes and `dev approve` (which signs a waiting approval as the person) move a state machine; the " +
    "rest change this machine's CLI state, the devnet's clocks, prices, gates, mail and snapshots, or read, so each is " +
    "proved by its own success. `dev approve` is taken on an approval the scenario's world holds.",
  steps: [
    step(applications.operation_doctor, "developer", "success"),
    step(access.operation_schema, "developer", "success"),
    step(access.operation_config_telemetry_status, "developer", "success"),
    step(access.operation_config_telemetry_on, "developer", "success"),
    step(access.operation_config_telemetry_off, "developer", "success"),
    step(access.operation_use_env, "developer", "success"),
    step(applications.operation_key_list, "developer", "success"),
    step(applications.operation_key_create, "developer", event_app_key_transitioned),
    step(applications.operation_key_rotate, "developer", event_app_key_transitioned),
    step(applications.operation_key_revoke, "developer", event_app_key_transitioned),
    step(applications.operation_dev_key, "developer", "success"),
    step(devnet.operation_dev_time, "developer", "success"),
    step(devnet.operation_dev_time_start_at, "developer", "success"),
    step(devnet.operation_dev_time_warp, "developer", "success"),
    step(devnet.operation_dev_prices_set, "developer", "success"),
    step(devnet.operation_dev_gates_set, "developer", "success"),
    step(devnet.operation_dev_approve, "developer", event_approval_transitioned),
    step(devnet.operation_dev_jobs_run, "developer", "success"),
    step(devnet.operation_dev_mail_list, "developer", "success"),
    step(devnet.operation_dev_mail_notices, "developer", "success"),
    step(devnet.operation_dev_mail_fail, "developer", "success"),
    step(devnet.operation_dev_snapshot_save, "developer", "success"),
    step(devnet.operation_dev_snapshot_list, "developer", "success"),
    step(devnet.operation_dev_snapshot_restore, "developer", "success"),
  ],
  was: [`${OLD}/build_on_capxul.yaml (chapters S1 to S12, S14, S27 to S29)`, `${CATALOG}:69`, `${CONTRACTS}/build-on-capxul-contract.ts`],
});

// ── close the books ─────────────────────────────────────────────────────────────────────────

export const journey_close_the_books = defineJourney({
  id: "close_the_books",
  title: "Close the books",
  about:
    "A member reads the activity, gives a row its account, checks the documents behind the money, runs the reports and " +
    "exports the books for the accountant; the old finish is 'the books reconcile and the export reaches the " +
    "accountant'. Only the annotation changes state (`book_annotation_transitioned`); the reads, the reports and the " +
    "export are proved by their own success.",
  steps: [
    step(activity.operation_activity_get, "member", "success"),
    step(activity.operation_activity_events, "member", "success"),
    step(activity.operation_activity_summary, "member", "success"),
    step(books.operation_activity_annotate, "member", event_book_annotation_transitioned),
    step(documents.operation_document_get, "member", "success"),
    step(documents.operation_document_verify, "member", "success"),
    step(documents.operation_document_render, "member", "success"),
    step(documents.operation_document_export, "member", "success"),
    step(books.operation_org_books_reports_trial_balance, "member", "success"),
    step(books.operation_org_books_reports_profit_and_loss, "member", "success"),
    step(books.operation_org_books_reports_balance_sheet, "member", "success"),
    step(books.operation_org_books_reports_reconcile, "member", "success"),
    step(books.operation_org_books_export_quickbooks, "member", "success"),
  ],
  was: [`${OLD}/close_the_books.yaml (chapters S8, S20, S26)`, `${CATALOG}:74`, `${CONTRACTS}/close-the-books-contract.ts`],
});

// ── own equity ──────────────────────────────────────────────────────────────────────────────

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

// ── raise money ─────────────────────────────────────────────────────────────────────────────

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

// ── delegate to an agent ────────────────────────────────────────────────────────────────────

export const journey_delegate_to_agent = defineJourney({
  id: "delegate_to_agent",
  title: "Delegate to an agent",
  about:
    "An owner creates an agent and looks after it: reads it, rotates its key, freezes and unfreezes it, sweeps its money " +
    "back and removes it; the old finish is 'an agent pays from its own Safe within its limits'. A create, freeze, " +
    "unfreeze or removal moves the agent machine when its change lands (the agent's event says the agent journey ends at " +
    "`activate`); a key rotation and a sweep change no agent state and are the agent change's own event.",
  steps: [
    step(agents.operation_agent_create, "owner", event_agent_transitioned),
    step(agents.operation_agent_show, "owner", "success"),
    step(agents.operation_agent_list, "owner", "success"),
    step(agents.operation_agent_key_rotate, "owner", event_agent_change_transitioned),
    step(agents.operation_agent_freeze, "owner", event_agent_transitioned),
    step(agents.operation_agent_unfreeze, "owner", event_agent_transitioned),
    step(agents.operation_agent_sweep, "owner", event_agent_change_transitioned),
    step(agents.operation_agent_remove, "owner", event_agent_transitioned),
  ],
  was: [`${OLD}/delegate_to_agent.yaml (chapter S30)`, `${CATALOG}:91`, `${CONTRACTS}/delegate-to-agent-contract.ts`],
});

// ── refer someone ───────────────────────────────────────────────────────────────────────────

export const journey_refer_someone = defineJourney({
  id: "refer_someone",
  title: "Refer someone",
  about:
    "An admitted person reads their referral link and invites left, invites a friend and follows the referrals, and an " +
    "operator grants more invites; the old finish is 'a person you referred has a live Safe', which the referral process " +
    "records later as the referral's `qualify`. The invitation attributes the referral (and admits the friend); granting " +
    "invites changes a code row, not a state machine, so its own success proves it.",
  steps: [
    step(accounts.operation_referral_show, "person", "success"),
    step(accounts.operation_referral_invite, "person", event_referral_transitioned),
    step(accounts.operation_referral_list, "person", "success"),
    step(accounts.operation_waitlist_invites_grant, "operator", "success"),
  ],
  was: [`${OLD}/refer_someone.yaml (no chapters)`, `${CATALOG}:97`, `${CONTRACTS}/refer-someone-contract.ts`],
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

// ── decisions ───────────────────────────────────────────────────────────────────────────────

const by = (evidence: string) => `Claude, journeys, 8 November 2026; evidence: ${evidence}`;

export const decision_journeys_onto_target = defineDecision({
  id: "journeys.onto-target",
  title: "Each old journey is a journey of target operations, proved by machine events",
  question:
    "The old book's 13 journeys are a key, an ordered list of frozen operations and chapters; their funnels were separate " +
    "contracts over old events. A target journey step names an operation, a system actor and what proves it. How does " +
    "each old journey map onto the target, and what proves each step?",
  options: [
    {
      label: "machine-event",
      text:
        "One journey per old key, the key kept as its id. Each step is the frozen operation's target record, in the old " +
        "order, taken by the system actor its `who` (or, where the frozen page has none, its rpc's) names in the " +
        "journey's story, and proved by the event of the machine whose state that operation changes: the transition its " +
        "rpc drives, or, for a chain write its flow waits on, the one the concept's process makes when the write lands. " +
        "A step that changes no machine (a read, a local or devnet step, a change kept in a plain column) is proved by " +
        "`success`, the operation's own outcome.",
    },
    { label: "first-event", text: "Prove each step by the first event its flow sends." },
    { label: "success-only", text: "Prove every step by its operation's success." },
    { label: "old-contracts", text: "Port the old analytics contracts: one funnel step per outcome, several operations a step, drop reasons." },
  ],
  chosen: "machine-event",
  why:
    "P7 (accepted) re-points each journey step to a machine event, or to the operation's outcome where no state changes. " +
    "The first event a flow sends is mostly mechanism many steps share (an approval opened, a recipient's Party named, a " +
    "Board proposal), so it would not say which step happened; success alone loses what a process does after the call, " +
    "such as a chain write landing. The old contracts grouped operations into outcomes and kept drop reasons, which P6 and " +
    "P7 move to the wide event's error code, while a target journey is one list that is both the jrn: scenario and the " +
    "fun: funnel. Keys stay as ids (the id pattern takes underscores), so the old catalog's and PostHog's names hold. " +
    "Steps that share an event are told apart by its properties: its `transition`, or the kind of change it carries " +
    "(nine run_company steps are budget_change_transitioned, told apart by `kind`). Three pairs of them share a `kind` " +
    "too: `org allowance change` and `org department budget set` (set_amount), `org allowance assign` and `org " +
    "department holder add` (add_holder), `org allowance revoke` and `org department holder remove` (remove_holder). " +
    "The event carries no budget kind, so within each pair only its `budget_ref` (the allowance's or the department's) " +
    "tells them apart; a funnel that needs them apart needs that kind on the event, which is budgets' change. " +
    "Alternative endings the old lists keep (a cancel, a decline, a retry) stay steps: the scenario takes " +
    "each on a second object its world holds, so every step's event is still sent once, in order.",
  source: by(`${OLD}/*.yaml; ${CATALOG}; ${CONTRACTS}/*-contract.ts; docs/decisions/policy-pack.md (P7, recommendation B)`),
  affects: [...JOURNEYS],
});

export const decision_journeys_variants = defineDecision({
  id: "journeys.variants",
  title: "Old variants survive only as properties the target step events carry",
  question:
    "The old catalog gave journeys variants (entry_path, surface, subject_kind, funding_source, payer_kind, " +
    "recipient_is_capxul_account, recipient_kind, issuer_scope_kind, pay_path) as funnel breakdowns. A target variant is " +
    "a property of a step's event. Which survive?",
  options: [
    {
      label: "mapped",
      text:
        "Each old variant becomes the target event property that answers the same question, or goes: get_verified's " +
        "subject_kind is verification's `subject`; pay_someone's payer_kind is the payment's `owner_kind` and its two " +
        "recipient variants are its `route` (claim_escrow for a recipient with no account); get_paid's issuer_scope_kind " +
        "is the request's `owner_kind` and its pay_path the request's `payer_kind` (inbox, escrow or link).",
    },
    { label: "keep-all", text: "Keep every old variant name and add the properties to the target events." },
    { label: "none", text: "Book no variants." },
  ],
  chosen: "mapped",
  why:
    "A variant the step events do not carry cannot break a funnel down, and adding properties to another concept's events " +
    "is that concept's change, not this file's. `surface` is carried by no target product event (P7 keeps events to " +
    "state changes; the surface is the operation's), `entry_path` only by waitlist_entry_transitioned's `via`, which " +
    "proves no step (`waitlist join` is left out), and `funding_source` by none, so those go and money_in, get_started " +
    "and run_company book no variants. The mapped ones keep their old questions: a person or a company, a recipient " +
    "with an account or not, paid from the inbox, the escrow or the link.",
  source: by(`${CATALOG}:17 (JourneyVariant); books/target/{banking,payments,requests}/data.ts (event props)`),
  affects: [journey_get_verified, journey_pay_someone, journey_get_paid, journey_money_in, journey_get_started, journey_run_company],
});

export const decision_journeys_steps = defineDecision({
  id: "journeys.steps",
  title: "Optional operations leave the journeys; the refused `org director` writes go",
  question:
    "Four old journeys list reads and changes 'a person makes along the way', and run_company lists the books as " +
    "optional ('so no payroll step needs them'): 44 operations. And four old steps, `org director add`, `remove`, " +
    "`replace` and `threshold`, always refuse on v4. Which old operations stay steps?",
  options: [
    {
      label: "main-steps",
      text:
        "A journey's steps are its main list. The 44 optional operations are left out. Of the refused writes, " +
        "govern_company drops `remove`, `replace` and `threshold`, whose `org board director remove` and `org board " +
        "threshold` are its steps already, and run_company's `org director add` becomes `org board director add`, " +
        "taken by the founder in the same place.",
    },
    { label: "every-operation", text: "Keep every listed operation as a step, the optional ones and the refused writes too." },
    { label: "drop-alternatives", text: "As main-steps, and also drop the alternative endings (cancel, decline, retry, withdraw)." },
  ],
  chosen: "main-steps",
  why:
    "A funnel step measures who got through, so an optional step would count a person who never renames a books account " +
    "as dropped before the payroll run that ends run_company. The old book marks these as no steps, its funnels never " +
    "counted them, and each keeps every L1 eval of its own (acc, ref, evt, spn, bud), so nothing goes unchecked. A " +
    "refused write cannot be a step: jrn: needs every step's operation to succeed, and on v4 the four `org director` " +
    "writes always end WRONG_STATE naming their `org board` command (board.director-commands). run_company needs its " +
    "second Director before the Board proposals that follow, so it takes the v4 command; govern_company has them " +
    "already. The alternative endings stay: the old lists name them as steps (journeys.onto-target). Left out: get_paid " +
    "3, get_started 6, pay_someone 5, run_company 30 (11 books operations, 19 along the way).",
  source: by(`${OLD}/{get_paid,get_started,pay_someone,run_company,govern_company}.yaml; books/target/board/decisions.ts (board.director-commands)`),
  affects: [
    journey_get_paid,
    journey_get_started,
    journey_pay_someone,
    journey_run_company,
    journey_govern_company,
    board.operation_org_director_add,
    board.operation_org_director_remove,
    board.operation_org_director_replace,
    board.operation_org_director_threshold,
    board.operation_org_board_director_add,
    // get_paid
    requests.operation_service_list,
    requests.operation_service_get,
    requests.operation_request_list,
    // get_started
    accounts.operation_waitlist_join,
    accounts.operation_waitlist_status,
    access.operation_auth_list,
    access.operation_auth_switch,
    access.operation_use_personal,
    access.operation_auth_logout,
    // pay_someone
    contacts.operation_contact_list,
    banking.operation_contact_get,
    payments.operation_payment_reschedule,
    payments.operation_payment_cancel,
    banking.operation_bank_accounts,
    // run_company: the optional books operations
    books.operation_org_books_accounts_import,
    books.operation_org_books_accounts_list,
    books.operation_org_books_accounts_add,
    books.operation_org_books_accounts_rename,
    books.operation_org_books_accounts_archive,
    books.operation_org_books_accounts_review,
    books.operation_org_books_assets_add,
    books.operation_org_books_assets_list,
    books.operation_org_books_assets_remove,
    books.operation_org_books_facts_list,
    books.operation_org_books_accounts_reclassify,
    // run_company: reads and changes along the way
    organizations.operation_org_wait,
    organizations.operation_org_list,
    organizations.operation_org_me,
    organizations.operation_use_org,
    organizations.operation_org_member_list,
    organizations.operation_org_member_get,
    board.operation_org_member_grant,
    board.operation_org_member_revoke,
    organizations.operation_org_invite_list,
    budgets.operation_org_allowance_list,
    budgets.operation_org_allowance_get,
    budgets.operation_org_allowance_replace,
    budgets.operation_org_department_list,
    budgets.operation_org_department_show,
    budgets.operation_org_department_close,
    budgets.operation_org_department_reopen,
    payroll.operation_org_agreement_list,
    payroll.operation_agreement_list,
    payroll.operation_agreement_show,
  ],
});
