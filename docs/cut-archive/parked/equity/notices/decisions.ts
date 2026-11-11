// Moved out of the built book by the cut, 10 November 2026, from books/target/notices/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_budgets, concept_devnet, concept_notices, concept_payments } from "../shared/foundation.ts";
import { machine_payment } from "../payments/data.ts";
import { machine_org_setup } from "../organizations/data.ts";
import { machine_proposal } from "../board/data.ts";
import { machine_agreement_write } from "../payments/agreements/data.ts";
import { integration_chain_rpc, integration_mail } from "../shared/external.ts";
import {
  event_balance_alert_transitioned,
  event_notice_transitioned,
  machine_balance_alert,
  machine_notice,
  table_balance_alerts,
  table_notices,
} from "./data.ts";
import {
  workflow_notices_accounts_account_ready,
  workflow_notices_accounts_welcome,
  workflow_notices_accounts_welcome_unlisted,
} from "./accounts.ts";
import {
  workflow_notices_organizations_fde_due,
  workflow_notices_organizations_fde_paused,
  workflow_notices_organizations_fde_ready,
  workflow_notices_organizations_invitation_opened,
  workflow_notices_organizations_invitation_resent,
  workflow_notices_organizations_invitation_sent,
} from "./organizations.ts";
import { workflow_notices_budgets_office_changed } from "./budgets.ts";
import {
  workflow_notices_board_director_removed,
  workflow_notices_board_director_seated,
  workflow_notices_board_officer_granted,
  workflow_notices_board_proposal_waiting,
  workflow_notices_board_threshold_changed,
} from "./board.ts";
import {
  workflow_notices_payments_cancelled,
  workflow_notices_payments_failed,
  workflow_notices_payments_money_reminders,
  workflow_notices_payments_money_taken_back,
  workflow_notices_payments_money_waiting,
  workflow_notices_payments_scheduled,
  workflow_notices_payments_sent,
  workflow_notices_payments_short,
} from "./payments.ts";
import {
  workflow_notices_payroll_agreement_ended,
  workflow_notices_payroll_collection_refused,
  workflow_notices_payroll_write_landed,
} from "./payroll.ts";
import {
  workflow_notices_banking_payout_delivered,
  workflow_notices_banking_payout_returned,
  workflow_notices_banking_payout_sent,
  workflow_notices_banking_person_invited,
  workflow_notices_banking_verified,
} from "./banking.ts";
import {
  workflow_notices_requests_declined,
  workflow_notices_requests_issued,
  workflow_notices_requests_matched,
  workflow_notices_requests_paid,
} from "./requests.ts";
import { workflow_notices_equity_round_invitation } from "./equity.ts";
import { workflow_notices_delivery_retry, workflow_notices_payroll_daily } from "./processes.ts";

/** Every outbox workflow that makes a notice's first attempt. */
const OUTBOX = [
  workflow_notices_accounts_welcome,
  workflow_notices_accounts_welcome_unlisted,
  workflow_notices_accounts_account_ready,
  workflow_notices_organizations_invitation_sent,
  workflow_notices_organizations_invitation_opened,
  workflow_notices_organizations_invitation_resent,
  workflow_notices_organizations_fde_ready,
  workflow_notices_organizations_fde_due,
  workflow_notices_organizations_fde_paused,
  workflow_notices_budgets_office_changed,
  workflow_notices_board_director_seated,
  workflow_notices_board_director_removed,
  workflow_notices_board_threshold_changed,
  workflow_notices_board_proposal_waiting,
  workflow_notices_board_officer_granted,
  workflow_notices_payments_scheduled,
  workflow_notices_payments_short,
  workflow_notices_payments_failed,
  workflow_notices_payments_sent,
  workflow_notices_payments_cancelled,
  workflow_notices_payments_money_waiting,
  workflow_notices_payments_money_taken_back,
  workflow_notices_payroll_write_landed,
  workflow_notices_payroll_collection_refused,
  workflow_notices_payroll_agreement_ended,
  workflow_notices_banking_person_invited,
  workflow_notices_banking_verified,
  workflow_notices_banking_payout_sent,
  workflow_notices_banking_payout_delivered,
  workflow_notices_banking_payout_returned,
  workflow_notices_requests_issued,
  workflow_notices_requests_paid,
  workflow_notices_requests_matched,
  workflow_notices_requests_declined,
  workflow_notices_equity_round_invitation,
] as const;

export const decision_notices_round_invitation = defineDecision({
  id: "notices.round-invitation",
  title: "An investor invited to a round or SAFE is emailed, at low priority",
  question: "Equity's design says notices reacts to an investor's `invite`. Old Capxul sent no such email. Send one?",
  options: [
    { label: "send", text: "Send `round-invitation` on `fundraise-investment.invite`, low priority like equity." },
    { label: "none", text: "Send nothing, as before: the investor finds it with `capxul invest`." },
  ],
  chosen: "send",
  why:
    "concepts.notices and dependencies.of-notices both name 'a round or SAFE invitation', and the equity designer " +
    "built the transition for it. An invited investor is often outside the company and has no other way to learn of " +
    "it. Equity is low priority (CONVENTIONS rule 4), so this workflow is too.",
  source: by("books/target/equity/data.ts (fundraise_investment_transitioned); concepts.notices; dependencies.of-notices"),
  affects: [workflow_notices_equity_round_invitation],
});
