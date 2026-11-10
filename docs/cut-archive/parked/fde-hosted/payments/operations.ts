// Moved out of the built book by the cut, 10 November 2026, from books/target/payments/operations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_DEADLINE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_INVALID_RECIPIENT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_ROLE_PERMISSION_DENIED,
  error_SUPERSEDED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_org_departments_pay,
  flow_client_org_fde_pay,
  flow_client_org_seats_buy,
  flow_client_payments_cancel,
  flow_client_payments_pay,
  flow_client_payments_reschedule,
  flow_client_payments_retry,
  flow_client_payments_subscribe,
} from "./flows.ts";
import { rpc_payments_ledger_get, rpc_payments_ledger_list } from "./ledger.ts";
import { Outcome, PaymentStatus, Route } from "./data.ts";
import { error_CANCELLED, error_SMART_ACCOUNT_MISSING, error_TRANSACTION_FAILED } from "../shared/vocabulary.ts";
import { Collection } from "../accounts/setup.ts";
import { flow_client_payments_claim } from "./flows.ts";

export const operation_org_fde_pay = defineOperation({
  id: "org.fde.pay",
  title: "Pay months of the hosted FDE's hosting from a budget",
  about:
    "Pays `[<months>]` calendar months (1 when not given, at most 12) of the Organization's hosted Forward Deployed " +
    "Engineer, in advance, at the deployment's FDE_HOSTING_PRICE (20 USDC a month on the test USDC), from the budget " +
    "`--from` names to Capxul, as one payment with one approval the payer signs from their own Safe. The FDE's " +
    "paid-through instant moves on by the months when the payment settles, never before: from the later of the old " +
    "paid-through instant and the settlement, so a paused FDE is never charged for the time it was paused, and paying " +
    "wakes it. Budgets must admit the payer's Safe on the budget now: whoever wears its hat, or one above it, at that " +
    "moment. `org fde show` gives the paid-through instant and the price before paying.",
  area: "payments",
  command: "org fde pay",
  priority: "normal",
  implementedBy: flow_client_org_fde_pay,
  who:
    "A person with a Seat in the Organization whom Budgets.authorised admits on the `--from` budget now: a wearer of " +
    "that budget's hat or of a budget above it, as the chain reads it at the call, so whoever is swapped out of the hat " +
    "can no longer pay from it. Never an agent, so the FDE never pays for its own hosting, and never the Board, whose " +
    "payment is its own batch and cannot spend from a budget at once (payments.commands.propose).",
  changes:
    "One payment command (purpose fde_hosting), its one Payment to Capxul's receiving Safe, the payment's Invoice and " +
    "one approval. Once the Payment settles, the hosting payment is counted and the FDE's paid-through instant moves on " +
    "by the months (a paused FDE is woken and resumed); a reorg below finality takes exactly those months back until " +
    "the Payment settles again.",
  acceptance: [
    {
      claim:
        "One approval pays the months times FDE_HOSTING_PRICE from the named budget to Capxul, and the FDE's paid-through instant moves on by them when the payment settles.",
      observes:
        "cli: from org-with-fde-allowance, Dana's `org fde pay 2 --from capxul --org acme` previews 2 months at 20 USDC, 40 USDC " +
        "from `capxul` with 500 left, signs one approval and ends with its Payment settled; read: `org fde show --org acme --json` " +
        "then prints monthsPaid 2 and paidThrough two calendar months after the start-up month's end; chain: one UserOperation " +
        "from Dana's Safe whose one call is `Budgets.spend` on `capxul`'s budget id of 40 USDC to CAPXUL_RECEIVING_SAFE, and one " +
        "PaymentSent with the shown payment id.",
    },
    {
      claim: "Paying for a paused FDE wakes it, and the months run from the payment, so the pause is not charged.",
      observes:
        "cli: from org-with-fde-allowance-paused, Dana's `org fde pay --from capxul --org acme` settles; read: `org fde show " +
        "--org acme --json` prints status `resuming` or `running`, then `running`, with paidThrough one calendar month after " +
        "the settlement's time, not after the lapsed paid-through instant; `org fde ask` then reaches the FDE.",
    },
    {
      claim: "Nothing is counted before the payment settles: a hosting payment left unsigned, or declined, leaves the paid-through instant as it was.",
      observes:
        "cli: from org-with-fde-allowance, `org fde pay 1 --from capxul --org acme --no-wait --json` prints `awaiting_approval` " +
        "with an approvalId and the hosting's paidThrough; read: `org fde show` prints the same paidThrough and monthsPaid 0; " +
        "after Dana declines that approval on the approval page, `payment get <its payment> --org acme` reads cancelled and " +
        "paidThrough is unchanged; chain: no Budgets.spend from `capxul`.",
    },
    {
      claim:
        "Who may pay follows the budget's hat now: someone taken out of it cannot pay from it, and the FDE never pays for itself.",
      observes:
        "cli: from org-with-fde-allowance, after the Board revokes Dana's `capxul` (`org allowance revoke capxul --member " +
        "dana@acme.test --org acme`, approved by Dana as the one Director), Dana's `org fde pay --from capxul --org acme` exits " +
        "ROLE_PERMISSION_DENIED; the FDE's own `org fde pay --from capxul --org acme`, run through the stand-in host with no " +
        "ask (`capxul-devnet fde run acme --`, so it carries no act-for token and acts as itself), exits " +
        "ROLE_PERMISSION_DENIED before `--from` is looked up; world: no payment " +
        "command and no approval.",
    },
    {
      claim: "Asking twice under one request key pays once.",
      observes:
        "cli: from org-with-fde-allowance, Dana's `org fde pay 1 --from capxul --org acme --request-key k1 --no-wait --json` run " +
        "twice prints the same approvalId and paymentIds; read: once Dana signs it and it settles, `org fde show --org acme " +
        "--json` prints monthsPaid 1, not 2, and paidThrough one calendar month after the start-up month's end; world: one " +
        "payment command.",
    },
  ],
  returns: Schema.Union([Schema.Struct({ ...HandoverJson.fields, hosting: HostingJson }), EndedJson]),
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_NOT_AUTHENTICATED, given: W.signedOut, when: "You are not signed in." },
    {
      error: error_CLI_USAGE,
      given: FW.payer,
      when: "`--from` is missing, or `<months>` is not a whole number: nothing is sent.",
    },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W.budgets,
      when:
        "`--org` names an Organization you hold no Seat in (Olga naming Acme), Budgets does not authorise your Safe on the " +
        "`--from` budget now, or you are an agent, which never pays for hosting: nothing is written.",
    },
    {
      error: error_INVALID_INPUT,
      given: FW.payer,
      when: "`<months>` is under 1 or over 12, or `--from` names no budget of the Organization: nothing is written.",
    },
    {
      error: error_FEATURE_NOT_AVAILABLE,
      given: FW.unpriced,
      when:
        "The deployment sets no FDE_HOSTING_PRICE or no CAPXUL_RECEIVING_SAFE, or prices hosting in a token other than the " +
        "budget's: hosting is not charged, and nothing is written.",
    },
    {
      error: error_WRONG_STATE,
      given: FW.closed,
      when:
        "The Organization has no hosted FDE, or its hosting is retired (removed, or its key moved off the host), the budget " +
        "is not on chain yet, or it or a budget above it is closed (`running-costs` above `capxul`): nothing is prepared.",
    },
    {
      error: error_PAYROLL_BUDGET_EXCEEDED,
      given: FW.payer,
      when:
        "The months cost more than the budget has left this month, or the total is over the token's payout ceiling: " +
        "nothing is prepared or signed.",
    },
    {
      error: error_INSUFFICIENT_BALANCE,
      given: FW.shortSafe,
      when: "The company Safe holds 5 USDC, less than the 20 one month costs, though `capxul` has room: nothing is prepared or signed.",
    },
    {
      error: error_SUPERSEDED,
      given: FW.payer,
      when: "The approval expired or was displaced before it landed: nothing was paid, and the refusal names `payment retry` and `payment wait`.",
    },
  ],
  budget: budget("chain-submit"),
  was: ["docs/design/new-commands.md (section 5.5)", "books/target/shared/rulings.ts (aaron.fde-hosted, aaron.test-prices)"],
});
