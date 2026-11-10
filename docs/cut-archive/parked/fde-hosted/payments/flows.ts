// Moved out of the built book by the cut, 10 November 2026, from books/target/payments/flows.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_openfort } from "../shared/external.ts";
import { error_CANCELLED, error_SUPERSEDED, error_TRANSACTION_FAILED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import * as approvalsSigning from "../approvals/signing.ts";
import { rpc_books_annotations_save } from "../books/annotations.ts";
import { rpc_payments_changes_cancel, rpc_payments_changes_reschedule, rpc_payments_changes_retry } from "./changes.ts";
import {
  BuySeatsInput,
  FdeHostingHandover,
  Handover,
  PayFdeInput,
  SeatsHandover,
  SendInput,
  rpc_payments_commands_buy_seats,
  rpc_payments_commands_pay_fde_hosting,
  rpc_payments_commands_prepare,
  rpc_payments_commands_propose,
} from "./commands.ts";
import { Followed, PaymentView, rpc_payments_ledger_get, rpc_payments_ledger_watch } from "./ledger.ts";
import { Collection, rpc_accounts_setup_collect } from "../accounts/setup.ts";

export const flow_client_org_fde_pay = defineFlow({
  id: "client.org.fde.pay",
  title: "Pay months of the FDE's hosting from a budget and follow the payment",
  about:
    "`org fde pay [<months>] --from <budget>` (aaron.fde-hosted): prepares the hosting payment " +
    "(`payments.commands.pay-fde-hosting`), checks before anyone signs that the one call is `Budgets.spend` on the named " +
    "budget paying exactly the months times FDE_HOSTING_PRICE to Capxul's receiving Safe under the shown payment id, then " +
    "signs and follows like any payment. The FDE's paid-through instant moves on in the transaction that settles the " +
    "Payment (`organizations.extend-fde-hosting`), and a paused FDE is woken there, so a followed run ends with the " +
    "hosting paid; with `--no-wait` it answers the hand-over at once and `payment wait` follows it later. An approval " +
    "that lapses answers SUPERSEDED with the `payment retry` and `payment wait` commands; one declined on the page " +
    "answers CANCELLED and pays nothing. A repeat under the same `--request-key` answers where the first approval ended.",
  component: component_core_sdk,
  sdk: "client.org(orgId).fde.pay",
  /** As `org seats buy`: `--no-wait` alone hands over at once, and `--json` only prints (payments.seat-hand-over). */
  input: Schema.Struct({ ...PayFdeInput.fields, timeout_seconds: Follow.timeout_seconds, no_wait: Schema.Boolean }),
  output: Schema.Union([FdeHostingHandover, Followed]),
  steps: [
    { name: "prepare", rpc: rpc_payments_commands_pay_fde_hosting, about: "Births the hosting payment's command, its Payment, its Invoice and the approval." },
    {
      name: "check",
      local: "build",
      about:
        "Recomputes the payment id from the preview's terms and refuses an operation whose call is anything but that one " +
        "`Budgets.spend` of the months times the unit price to the receiving Safe from the named budget.",
    },
    ...signing,
    ...following,
  ],
  errors: [...MONEY_ERRORS],
  calls: [integration_openfort.c.signDigest],
  spans: [],
  budget: budget("chain-submit"),
  was: ["docs/design/new-commands.md (section 5.5)", "books/target/payments/flows.ts (client.org.seats.buy, the pattern)"],
});
