// Moved out of the built book by the cut, 10 November 2026, from books/target/payments/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_payments, environment_devnet, environment_staging } from "../shared/foundation.ts";
import {
  contract_budgets,
  contract_companies_house_claimer,
  contract_escrow,
  contract_escrow_factory,
  contract_payments,
  integration_indexer,
  integration_service_signer,
} from "../shared/external.ts";
import { error_INVALID_RECIPIENT, error_PAYROLL_BUDGET_EXCEEDED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { rpc_payments_changes_cancel, rpc_payments_changes_reschedule, rpc_payments_changes_retry } from "./changes.ts";
import { rpc_payments_commands_prepare, rpc_payments_commands_propose } from "./commands.ts";
import {
  event_movement_transitioned,
  event_payment_transitioned,
  machine_movement,
  machine_payment,
  table_movements,
  table_payment_commands,
  table_payments,
} from "./data.ts";
import {
  flow_client_org_departments_pay,
  flow_client_payments_cancel,
  flow_client_payments_pay,
  flow_client_payments_reschedule,
  flow_client_payments_retry,
  flow_client_payments_subscribe,
} from "./flows.ts";
import { rpc_payments_ledger_get, rpc_payments_ledger_list, rpc_payments_ledger_watch } from "./ledger.ts";
import {
  operation_org_department_pay,
  operation_payment_cancel,
  operation_payment_get,
  operation_payment_list,
  operation_payment_reschedule,
  operation_payment_retry,
  operation_payment_send,
  operation_payment_wait,
} from "./operations.ts";
import { procedure_payments_prepare_command } from "./procedures.ts";
import { event_approval_transitioned, machine_approval } from "../approvals/data.ts";
import { procedure_approvals_withdraw } from "../approvals/procedures.ts";
import { event_proposal_transitioned, machine_proposal } from "../board/data.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { procedure_books_record_money_fact } from "../books/procedures.ts";
import {
  workflow_payments_lifecycle_payment,
  workflow_payments_movements_record,
  workflow_payments_settlement_observe,
} from "./processes.ts";
import { concept_devnet } from "../shared/foundation.ts";
import {
  procedure_organizations_add_bought_seats,
  procedure_organizations_extend_fde_hosting,
  procedure_organizations_return_bought_seats,
  procedure_organizations_return_fde_hosting,
} from "../organizations/procedures.ts";
import { rpc_payments_commands_buy_seats, rpc_payments_commands_pay_fde_hosting } from "./commands.ts";
import { flow_client_org_fde_pay, flow_client_org_seats_buy } from "./flows.ts";
import { operation_org_fde_pay, operation_org_seats_buy } from "./operations.ts";
import { CLAIM_WORLDS, operation_payment_claim } from "./operations.ts";
import { flow_client_payments_claim } from "./flows.ts";
import { rpc_accounts_setup_collect } from "../accounts/setup.ts";

export const decision_payments_fde_pay_retry = defineDecision({
  id: "payments.fde-pay-retry",
  title: "`org fde pay` observes what asking again does, as `org seats buy` does",
  question:
    "`org fde pay` came from the commands pass with four claims, and none says what asking again does, though its flow " +
    "answers a repeat under the same `--request-key` where the first approval ended (K1), and every other new money " +
    "command that takes `--request-key` observes it. Does it get that claim?",
  options: [
    {
      label: "retry-claim",
      text:
        "A fifth claim: asked twice under one request key with `--no-wait --json`, it answers the same approval and " +
        "Payment, and once signed and settled the hosting has moved by its months once. Observed from " +
        "org-with-fde-allowance by the CLI, `org fde show` and the world (one payment command).",
    },
    { label: "four", text: "Keep the four claims; the repeat stays a sentence in the flow's `about`." },
  ],
  chosen: "retry-claim",
  why:
    "A hosting payment is money paid to Capxul, and a person who lost the reply and ran the command again must not pay " +
    "a month twice. That is booked behaviour (payments.commands.pay-fde-hosting births under the request key's command, " +
    "and a repeat answers it as it stands; client.org.fde.pay), and the other new money commands that take " +
    "`--request-key` already observe it (`org seats buy` claim 3, `org payroll run pay`, `org hr expense-claim pay`), so " +
    "this was the one such money path whose retry no eval would catch. payments.claim-retry gave `payment claim` its fourth " +
    "claim for the same reason. Nothing new is designed: no flag, answer or refusal changes, and the claim reuses claim " +
    "1's world. A lapsed approval's retry stays `payment retry`'s, which this command's SUPERSEDED refusal names. It " +
    "holds on any world's clock: the eval world is restored on a frozen clock (devnet.deterministic-worlds); on a " +
    "season's running clock the repeat still answers the first command, never a second payment; and a reset restores " +
    "the unpaid world (aaron.seasons).",
  source: FIT("client.org.fde.pay ('A repeat under the same --request-key answers where the first approval ended'); payments.commands.pay-fde-hosting (K1); org.seats.buy claim 3; aaron.fde-hosted"),
  affects: [operation_org_fde_pay],
});
