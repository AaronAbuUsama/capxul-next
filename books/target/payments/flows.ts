// Payments' Core SDK flows (A4): the one SDK method each multi-step payment command calls. A money flow is
// prepare (one payments rpc that births or changes the Payment and opens its carrier), then the signature
// (an agent signs with its own key and gives it to approvals; a person signs on the approval page, which
// the CLI opens; a Board payment is signed by each Director's own approval of the proposal), then the
// follow: payments' live watch until every Payment ends. With `--json` a flow answers the hand-over right
// after prepare, and `payment wait` follows it later. The flow owns all signing; the CLI prints.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_openfort } from "../shared/external.ts";
import { error_CANCELLED, error_SUPERSEDED, error_TRANSACTION_FAILED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import * as approvalsSigning from "../approvals/signing.ts";
import { rpc_payments_changes_cancel, rpc_payments_changes_reschedule, rpc_payments_changes_retry } from "./changes.ts";
import { Handover, SendInput, rpc_payments_commands_prepare, rpc_payments_commands_propose } from "./commands.ts";
import { Followed, PaymentView, rpc_payments_ledger_get, rpc_payments_ledger_watch } from "./ledger.ts";

const SDK = "packages/sdk/src";
const S = Schema.String;
const Null = Schema.NullOr;

/** How a money flow is followed: `--json` answers at once; otherwise it follows until the end or the timeout. */
const Follow = { timeout_seconds: Null(Schema.Int), json: Schema.Boolean };

/** What a money flow answers: the hand-over at once, or the approval as it ended with the Payments it moved. */
export const MoneyOutcome = Schema.Union([Handover, Followed]);

/** The signature: an agent's own key over the approval's digest, given to approvals; a person signs on the approval page. */
const signing = [
  {
    name: "sponsored",
    rpc: approvalsSigning.rpc_approvals_signing_get,
    about: "Follows the approval until it is sponsored (`pending`, with its digest), or refused with the chain's code.",
  },
  {
    name: "sign",
    local: "sign",
    about: "An agent signs the digest with its own key; a person signs on the approval page the CLI opens (Openfort in a browser).",
  },
  {
    name: "give-signature",
    rpc: approvalsSigning.rpc_approvals_signing_sign,
    about: "An agent's signature to approvals, which sends the operation once; the approval page gives a person's.",
  },
  {
    name: "approval",
    local: "wait",
    about: "Waits for the person on the approval page, or the Directors on a proposal, until it ends or `--timeout-seconds`.",
  },
] as const;

const following = [
  { name: "follow", rpc: rpc_payments_ledger_watch, about: "Follows the approval's Payments live until each settles, lapses or is cancelled." },
  { name: "chain", local: "wait", about: "The chain: until each Payment's PaymentSent is indexed and settles it." },
] as const;

const MONEY_ERRORS = [error_SUPERSEDED, error_CANCELLED, error_TRANSACTION_FAILED] as const;

export const flow_client_payments_pay = defineFlow({
  id: "client.payments.pay",
  title: "Send a payment and follow it",
  about:
    "`payment send`: prepares the payment (`payments.commands.prepare`, or `payments.commands.propose` with " +
    "`--as-directors`), checks before anyone signs that the calls pay exactly what was asked to whom from which budget " +
    "(the preview's payment ids), then signs and follows. An approval that expires or is displaced before it lands answers " +
    "SUPERSEDED with the `payment retry` and `payment wait` commands; one declined on the page answers CANCELLED; one the " +
    "chain's simulation refused answers its code. A repeat with the same `--request-key` answers where the first " +
    "approval ended. Its React twin serves the web app's send form with the same steps.",
  component: component_core_sdk,
  sdk: "client.payments.pay",
  input: Schema.Struct({ ...SendInput.fields, as_directors: Schema.Boolean, ...Follow }),
  output: MoneyOutcome,
  steps: [
    { name: "prepare", rpc: rpc_payments_commands_prepare, about: "Births the command, its Payments, the document and the approval." },
    { name: "propose", rpc: rpc_payments_commands_propose, about: "With `--as-directors`, in place of prepare: the Board proposal." },
    {
      name: "choose-budget",
      local: "prompt",
      about: "With `--org` and several budgets you hold in the asset, prepare names them; the CLI asks which, then prepares with `--from`.",
    },
    { name: "check", local: "build", about: "Recomputes each payment id from the preview's terms and refuses a batch that pays anything else." },
    ...signing,
    ...following,
  ],
  errors: [...MONEY_ERRORS],
  calls: [integration_openfort.c.signDigest],
  spans: [],
  budget: budget("chain-submit"),
  was: [`${SDK}/accounts/approvals.ts:106`, `${SDK}/payments/execution.ts:269`, `${SDK}/payments/command-execution.ts:226`, "apps/cli/src/commands/payment/subcommands/send/execute.ts:94"],
});

export const flow_client_org_departments_pay = defineFlow({
  id: "client.org.departments.pay",
  title: "Pay from a department's budget and follow it",
  about:
    "`org department pay`: one `Budgets.spend` of the department's top budget from the holder's own Safe, through " +
    "`payments.commands.prepare` with the `dep_` id, so it rides the same budget route as a spending allowance. The " +
    "route is checked before anyone signs: it must name the department's own active top budget, and another budget, an " +
    "unknown one or a proposed department is closed unsent. Then it signs and follows like any payment.",
  component: component_core_sdk,
  sdk: "client.org.departments.pay",
  input: Schema.Struct({ org: S, department: S, to: S, amount: S, kind: SendInput.fields.kind, document: SendInput.fields.document, ...Follow }),
  output: MoneyOutcome,
  steps: [
    { name: "prepare", rpc: rpc_payments_commands_prepare, about: "Births the department's payment, its document and the approval." },
    { name: "check", local: "build", about: "Checks the route names the department's own active top budget and the asked amount and payee." },
    ...signing,
    ...following,
  ],
  errors: [...MONEY_ERRORS],
  calls: [integration_openfort.c.signDigest],
  spans: [],
  budget: budget("chain-submit"),
  was: [`${SDK}/org/departments.ts`, "packages/sdk/src/payments/tests/department-budget-route.test.ts"],
});

export const flow_client_payments_retry = defineFlow({
  id: "client.payments.retry",
  title: "Retry a lapsed payment and follow it",
  about:
    "`payment retry`: shows the original Payment as it stands (`payments.ledger.get`, which writes nothing), then sends " +
    "the same terms again under the same payment id (`payments.changes.retry`), signs as the first send did and follows. " +
    "It refuses a malformed id before any session is restored.",
  component: component_core_sdk,
  sdk: "client.payments.retry",
  input: Schema.Struct({ payment_id: S, org: Null(S), ...Follow }),
  output: MoneyOutcome,
  steps: [
    { name: "preview", rpc: rpc_payments_ledger_get, about: "The original Payment, read without writes, for the preview." },
    { name: "retry", rpc: rpc_payments_changes_retry, about: "Opens the new carrier for the same terms." },
    ...signing,
    ...following,
  ],
  errors: [...MONEY_ERRORS],
  calls: [integration_openfort.c.signDigest],
  spans: [],
  budget: budget("chain-submit"),
  was: ["apps/cli/src/commands/payment/subcommands/retry", `${SDK}/payments/methods.ts:28`],
});

export const flow_client_payments_cancel = defineFlow({
  id: "client.payments.cancel",
  title: "Cancel a waiting payment and follow it",
  about:
    "`payment cancel`: prepares the void, `Budgets.cancel` or escrow refund (`payments.changes.cancel`), signs it (or, " +
    "with `--as-directors`, opens the Board proposal the Directors approve) and follows the Payment until it reads " +
    "`cancelled`. The void's approval ends when it is sent; the Payment may read `scheduled` a little longer, so it " +
    "follows the Payment for up to three minutes after that, then answers WRONG_STATE naming `capxul payment get`. An " +
    "expired approval answers WRONG_STATE, a declined one CANCELLED; the Payment stays held in both.",
  component: component_core_sdk,
  sdk: "client.payments.cancel",
  input: Schema.Struct({ payment_id: S, org: Null(S), as_directors: Schema.Boolean, ...Follow }),
  output: MoneyOutcome,
  steps: [{ name: "cancel", rpc: rpc_payments_changes_cancel, about: "Opens the void, cancel or refund for the Payment." }, ...signing, ...following],
  errors: [error_WRONG_STATE, error_CANCELLED, error_TRANSACTION_FAILED],
  calls: [integration_openfort.c.signDigest],
  spans: [],
  budget: budget("chain-submit"),
  was: ["apps/cli/src/commands/payment/internal/voids.ts:38", `${SDK}/accounts/approvals.ts:106`],
});

export const flow_client_payments_reschedule = defineFlow({
  id: "client.payments.reschedule",
  title: "Move a dated payment and follow it",
  about:
    "`payment reschedule`: checks the new day before anything is cancelled, then `payments.changes.reschedule`. A " +
    "budget's dated payment moves in one approval. A personal one takes two: the void first, followed until the old " +
    "Payment reads `cancelled` (else WRONG_STATE saying what it became), then the same rpc again births the new dated " +
    "Payment, signed and followed until it reads `scheduled`. With `--json` it answers the first approval at once; " +
    "running the command again picks up where it stopped.",
  component: component_core_sdk,
  sdk: "client.payments.reschedule",
  input: Schema.Struct({ payment_id: S, org: Null(S), on: S, ...Follow }),
  output: MoneyOutcome,
  steps: [
    { name: "check-day", local: "build", about: "Parses `--on` (a day is 00:00 UTC) and refuses a day that is not in the future." },
    { name: "reschedule", rpc: rpc_payments_changes_reschedule, about: "The one approval of a budget's move, or a personal payment's void." },
    ...signing,
    { name: "follow", rpc: rpc_payments_ledger_watch, about: "Follows the old Payment until it reads cancelled (a personal move's first half)." },
    { name: "new-date", rpc: rpc_payments_changes_reschedule, about: "A personal move's second half: the new dated Payment and its approval." },
    { name: "sign-new-date", local: "sign", about: "Signs the new dated operation as the first was signed." },
    { name: "follow-new-date", rpc: rpc_payments_ledger_watch, about: "Follows the new Payment until it reads scheduled." },
  ],
  errors: [error_WRONG_STATE, error_CANCELLED, error_TRANSACTION_FAILED],
  calls: [integration_openfort.c.signDigest],
  spans: [],
  budget: budget("chain-submit"),
  was: ["apps/cli/src/commands/payment/subcommands/reschedule", "apps/cli/src/commands/payment/internal/voids.ts:11"],
});

export const flow_client_payments_subscribe = defineFlow({
  id: "client.payments.subscribe",
  title: "Follow a payment or an approval until it ends",
  about:
    "`payment wait`: follows a `payment_` id, or an `approval_` id with the Payments it carries, printing each change, " +
    "until it ends, needs action or must be retried. It sends nothing. With no timeout it follows until the end; the " +
    "timeout (1 to 3600 seconds) starts once the session is restored, and at it the flow answers the last state it saw. " +
    "It closes its live read when it stops, so nothing stays subscribed.",
  component: component_core_sdk,
  sdk: "client.payments.subscribe",
  input: Schema.Struct({ id: S, org: Null(S), timeout_seconds: Null(Schema.Int) }),
  output: Schema.Union([PaymentView, Followed]),
  steps: [
    { name: "watch", rpc: rpc_payments_ledger_watch, about: "The live read of the Payment, or of the approval's Payments." },
    { name: "approval", rpc: approvalsSigning.rpc_approvals_signing_get, about: "For an `approval_` id the signer holds: the approval itself, live." },
    { name: "wait", local: "wait", about: "Until what it follows ends or the timeout passes; then it closes the live read." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("live-read"),
  was: ["apps/cli/src/commands/payment/subcommands/wait", `${SDK}/payments/methods.ts:44`],
});
