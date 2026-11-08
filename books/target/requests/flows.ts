// Requests' Core SDK flows (A4): one SDK method per frozen operation that composes rpcs and local
// steps; the CLI calls exactly that method. `request list`, `inbox list`, `service get` and
// `service list` are one rpc each and have no flow. Every flow takes `org` for `--org`: the SDK's
// `client.org(orgId)` scope reaches the same method. A terminal's preview and question are the
// flow's `prompt` step (the CLI passes its confirm callback); `--confirm` in a script skips it, and a
// script without `--confirm` is the CLI's CLI_USAGE before the method is called.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_PROVIDER_RESPONSE_INVALID, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { integration_openfort } from "../shared/external.ts";
import { rpc_approvals_signing_get, rpc_approvals_signing_sign } from "../approvals/signing.ts";
import { rpc_requests_checkout_get, rpc_requests_checkout_open } from "./checkout.ts";
import { rpc_requests_deposits_candidates, rpc_requests_deposits_match } from "./deposits.ts";
import { rpc_requests_inbox_decline, rpc_requests_inbox_get, rpc_requests_inbox_pay } from "./inbox.ts";
import {
  rpc_requests_issuing_cancel,
  rpc_requests_issuing_get,
  rpc_requests_issuing_issue,
  rpc_requests_issuing_list,
} from "./issuing.ts";
import {
  rpc_requests_services_create,
  rpc_requests_services_deactivate,
  rpc_requests_services_get,
  rpc_requests_services_revise,
} from "./services.ts";
import { RequestView, ServiceTerms, ServiceView } from "./shapes.ts";

const SDK = "packages/sdk/src/requests";
const ASIS = "docs/as-is/archive/requests/flows.ts";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;
const Org = opt(S);

/** A preview read then a write: the read is system time too, so these flows take two round trips. */
const PREVIEW_WRITE = {
  ...budget("write"),
  p95Ms: 2_500,
  excludes: ["sdk.step.confirm"],
  why: "a terminal's preview read then the write: two round trips; the person's answer to the prompt is excluded",
} as const;

export const flow_client_account_requests_issue = defineFlow({
  id: "client.account.requests.issue",
  title: "Issue a request, recovering an uncertain reply from the issued list",
  about:
    "Asks at a terminal for what is missing and always before it issues; a terminal decline issues nothing, even with " +
    "`confirm`. It keeps one request key for the call, so a retry of the same issue returns the same request. When the " +
    "reply is lost (a timeout or a dropped connection after sending), it reads the issued list in the same session and " +
    "returns the request that carries its key, instead of issuing again; none found is the original error.",
  was: [`${SDK}/receivables.ts:1`, "apps/cli/src/commands/request/subcommands/issue/execute.ts:1", ASIS],
  component: component_core_sdk,
  sdk: "client.account.requests.issue",
  input: Schema.Struct({
    org: Org,
    payer: opt(S),
    asset: opt(S),
    amount: S,
    reference: S,
    note: opt(S),
    expires_at: opt(N),
    invoice: opt(Schema.Unknown),
    confirm: opt(Schema.Boolean),
  }),
  output: Schema.Struct({ scope: Schema.Literals(["person", "organization"]), direction: Schema.Literal("issued"), item: RequestView }),
  steps: [
    { name: "confirm", local: "prompt", about: "At a terminal: asks for what is missing, shows the request and asks; a decline returns CANCELLED, issuing nothing." },
    { name: "key", local: "cache", about: "One request key for this call, kept through an uncertain reply." },
    { name: "issue", rpc: rpc_requests_issuing_issue, about: "Issues it under the key." },
    { name: "recover", rpc: rpc_requests_issuing_list, about: "Only after an uncertain reply: the issued list, newest first, for the request with the key." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: budget("write"),
});

export const flow_client_account_requests_get = defineFlow({
  id: "client.account.requests.get",
  title: "Show a request you issued, and with `--wait paid` follow it",
  about:
    "Reads the request this scope issued. With `wait` it reads again until the request is paid, or its deadline passes, " +
    "and then returns the last status it read (not an error); a paid request names its Payment with the `payment get` " +
    "and `payment wait` commands in the same Organization and session.",
  was: [`${SDK}/receivables.ts:1`, "apps/cli/src/commands/request/subcommands/get/execute.ts:1"],
  component: component_core_sdk,
  sdk: "client.account.requests.get",
  input: Schema.Struct({ org: Org, request_id: S, wait: opt(Schema.Literal("paid")), deadline_ms: opt(N) }),
  output: Schema.NullOr(RequestView),
  steps: [
    { name: "read", rpc: rpc_requests_issuing_get, about: "The request, or null when this scope did not issue it." },
    { name: "follow", local: "poll", about: "With `wait paid`: reads again every two seconds until paid or the deadline; the wait is not system time." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("read"),
});

export const flow_client_account_requests_cancel = defineFlow({
  id: "client.account.requests.cancel",
  title: "Cancel a request you issued, after showing it",
  about:
    "Reads the exact issued request, shows it at a terminal and asks before it cancels (a decline is CANCELLED and writes " +
    "nothing), then cancels it. A request this scope did not issue reads null, which the CLI reports as CLI_USAGE.",
  was: [`${SDK}/receivables.ts:1`, "apps/cli/src/commands/request/subcommands/cancel/execute.ts:1"],
  component: component_core_sdk,
  sdk: "client.account.requests.cancel",
  input: Schema.Struct({ org: Org, request_id: S, confirm: opt(Schema.Boolean) }),
  output: RequestView,
  steps: [
    { name: "read", rpc: rpc_requests_issuing_get, about: "The exact issued request, for the preview." },
    { name: "confirm", local: "prompt", about: "At a terminal: shows the request and asks; a decline returns CANCELLED." },
    { name: "cancel", rpc: rpc_requests_issuing_cancel, about: "Cancels it." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: PREVIEW_WRITE,
});

export const flow_client_account_inbox_get = defineFlow({
  id: "client.account.inbox.get",
  title: "Show a request addressed to you, checking it is the one asked for",
  about:
    "Reads the request in the inbox of whoever the caller acts as; null (another actor's id, or none) is the CLI's " +
    "CLI_USAGE. A returned request whose id differs from the id asked for is refused PROVIDER_RESPONSE_INVALID, never " +
    "shown.",
  was: [`${SDK}/inboxes.ts:1`, "apps/cli/src/commands/request/subcommands/get/execute.ts:1"],
  component: component_core_sdk,
  sdk: "client.account.inbox.get",
  input: Schema.Struct({ org: Org, request_id: S }),
  output: Schema.NullOr(RequestView),
  steps: [
    { name: "read", rpc: rpc_requests_inbox_get, about: "The request in this inbox, or null." },
    { name: "check", local: "build", about: "The returned id equals the id asked for, else PROVIDER_RESPONSE_INVALID." },
  ],
  errors: [error_PROVIDER_RESPONSE_INVALID],
  calls: [],
  spans: [],
  budget: budget("read"),
});

export const flow_client_account_inbox_decline = defineFlow({
  id: "client.account.inbox.decline",
  title: "Decline a request addressed to you, after showing it",
  about:
    "Reads the request in the current inbox first, so one outside it is refused before any decline; at a terminal shows " +
    "it and always asks, even with `confirm` (a decline of the question is CANCELLED); then declines it. A lost reply " +
    "tells the caller to read the request before trying again.",
  was: [`${SDK}/inboxes.ts:1`, "apps/cli/src/commands/request/subcommands/decline/execute.ts:1"],
  component: component_core_sdk,
  sdk: "client.account.inbox.decline",
  input: Schema.Struct({ org: Org, request_id: S, confirm: opt(Schema.Boolean) }),
  output: RequestView,
  steps: [
    { name: "read", rpc: rpc_requests_inbox_get, about: "The request in this inbox; null is refused before the decline." },
    { name: "confirm", local: "prompt", about: "At a terminal: shows it and asks, always; a decline of the question returns CANCELLED." },
    { name: "decline", rpc: rpc_requests_inbox_decline, about: "Declines it." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: PREVIEW_WRITE,
});

export const flow_client_account_inbox_pay = defineFlow({
  id: "client.account.inbox.pay",
  title: "Pay a request from your inbox and follow it until it settles",
  about:
    "Reads the request and its exact terms, prepares its Payment (`requests.inbox.pay`: the Payment and its approval are " +
    "born; or the live attempt is returned with `resume`), and with `json` returns `awaiting_approval` with the approval " +
    "link and the `payment wait` command at once. Otherwise the payer signs: an agent with its own key signs the " +
    "sponsored approval's digest at once and gives it to approvals (`approvals.signing.sign`, which sends it once); a " +
    "person signs on the approval page. It follows the request until it is paid: an approval that lapsed ends " +
    "WRONG_STATE, one the payer rejected ends CANCELLED, and nothing was sent in either case. Without a timeout it " +
    "follows until the approval lapses; stopping early sends nothing.",
  was: [`${SDK}/inboxes.ts:1`, "apps/cli/src/commands/request/subcommands/pay/execute.ts:1", ASIS],
  component: component_core_sdk,
  sdk: "client.account.inbox.pay",
  input: Schema.Struct({
    org: Org,
    request_id: S,
    from: opt(S),
    pay_at: opt(N),
    resume: opt(Schema.Boolean),
    json: opt(Schema.Boolean),
    timeout_seconds: opt(N),
  }),
  output: Schema.Struct({
    status: S,
    approvalId: S,
    approvalUrl: S,
    paymentIds: Schema.Array(S),
    expiresAt: Schema.NullOr(N),
    next: Schema.Struct({ argv: Schema.Array(S) }),
    request: RequestView,
  }),
  steps: [
    { name: "read", rpc: rpc_requests_inbox_get, about: "The request and its exact terms; one that is not open is refused naming `inbox get`." },
    { name: "key", local: "cache", about: "The payer's request key for this request, kept across an uncertain reply and `--resume`." },
    { name: "prepare", rpc: rpc_requests_inbox_pay, about: "Births the Payment and its approval, or returns the live attempt." },
    { name: "check", local: "build", about: "The prepared Payment pays the request's own token, raw amount, issuer Safe and document, else PROVIDER_RESPONSE_INVALID." },
    {
      name: "sponsored",
      rpc: rpc_approvals_signing_get,
      about: "Follows the approval until it is sponsored (`pending`, with its digest and window), or refused with the chain's code.",
    },
    { name: "sign", local: "sign", about: "An agent payer signs the digest with its own key at once; a person signs on the approval page instead." },
    { name: "give-signature", rpc: rpc_approvals_signing_sign, about: "An agent's signature to approvals, which sends the operation once." },
    { name: "approve", local: "wait", about: "A person approves on the approval page in their browser; their own key signs there." },
    { name: "follow", local: "poll", about: "Reads the request again until paid, or its Payment lapsed (WRONG_STATE) or was rejected (CANCELLED)." },
    { name: "read-again", rpc: rpc_requests_inbox_get, about: "The request as it ended, with its Payment." },
  ],
  errors: [error_WRONG_STATE, error_CANCELLED, error_PROVIDER_RESPONSE_INVALID],
  calls: [integration_openfort.c.signDigest],
  spans: [],
  budget: budget("chain-settle"),
});

export const flow_client_account_services_create = defineFlow({
  id: "client.account.services.create",
  title: "Create a service from its terms, after showing them",
  about:
    "Takes the terms as JSON (at most 64 KiB; a missing or extra field is the CLI's CLI_USAGE), shows them at a terminal " +
    "and always asks (a decline is CANCELLED and writes nothing), then creates the service under the caller's request key.",
  was: [`${SDK}/services.ts:1`, "apps/cli/src/commands/service/subcommands/create/execute.ts:1"],
  component: component_core_sdk,
  sdk: "client.account.services.create",
  input: Schema.Struct({ org: Org, request_key: S, terms: ServiceTerms, confirm: opt(Schema.Boolean) }),
  output: ServiceView,
  steps: [
    { name: "terms", local: "build", about: "Decodes the terms exactly: title, unitLabel, unitAmount, quantity and an optional description." },
    { name: "confirm", local: "prompt", about: "At a terminal: shows the terms and asks; a decline returns CANCELLED." },
    { name: "create", rpc: rpc_requests_services_create, about: "Creates it under the request key." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: budget("write"),
});

export const flow_client_account_services_revise = defineFlow({
  id: "client.account.services.revise",
  title: "Revise a service at the revision you read, after showing both",
  about:
    "Reads the current service, shows it with the new terms at a terminal and always asks (CANCELLED on a decline), then " +
    "revises it at exactly the expected revision the caller gave. A revision conflict is returned as it is, never retried.",
  was: [`${SDK}/services.ts:1`, "apps/cli/src/commands/service/subcommands/revise/execute.ts:1"],
  component: component_core_sdk,
  sdk: "client.account.services.revise",
  input: Schema.Struct({ org: Org, offer_id: S, expected_revision: N, terms: ServiceTerms, confirm: opt(Schema.Boolean) }),
  output: ServiceView,
  steps: [
    { name: "read", rpc: rpc_requests_services_get, about: "The current service, for the preview." },
    { name: "confirm", local: "prompt", about: "At a terminal: shows the current service and the new terms and asks; a decline returns CANCELLED." },
    { name: "revise", rpc: rpc_requests_services_revise, about: "Revises it at the expected revision; a conflict is not retried." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: PREVIEW_WRITE,
});

export const flow_client_account_services_deactivate = defineFlow({
  id: "client.account.services.deactivate",
  title: "Deactivate a service at the revision you read, after showing it",
  about:
    "Reads the service, shows it at a terminal and always asks (CANCELLED on a decline), then deactivates it at the " +
    "expected revision.",
  was: [`${SDK}/services.ts:1`, "apps/cli/src/commands/service/subcommands/deactivate/execute.ts:1"],
  component: component_core_sdk,
  sdk: "client.account.services.deactivate",
  input: Schema.Struct({ org: Org, offer_id: S, expected_revision: N, confirm: opt(Schema.Boolean) }),
  output: ServiceView,
  steps: [
    { name: "read", rpc: rpc_requests_services_get, about: "The service, for the preview." },
    { name: "confirm", local: "prompt", about: "At a terminal: shows the service and asks; a decline returns CANCELLED." },
    { name: "deactivate", rpc: rpc_requests_services_deactivate, about: "Deactivates it at the expected revision." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: PREVIEW_WRITE,
});

export const flow_client_banking_deposits_match = defineFlow({
  id: "client.banking.deposits.match",
  title: "Match a deposit to the request it paid, choosing from the live candidates",
  about:
    "Reads the deposit and the requests it could have paid. With a request, or `none`, it matches at once. Without one: " +
    "at a terminal it shows the deposit and lets the person pick (CANCELLED if they pick nothing); in a script or with " +
    "`json` it returns the live choices with no prompt, which the CLI reports as CLI_USAGE listing the request ids. An " +
    "unknown deposit reads null, the CLI's CLI_USAGE.",
  was: ["packages/sdk/src/banking/deposits.ts:1", "apps/cli/src/commands/bank/subcommands/match/execute.ts:1"],
  component: component_core_sdk,
  sdk: "client.banking.deposits.match",
  input: Schema.Struct({ org: Org, bank_deposit_id: S, request: opt(S), json: opt(Schema.Boolean) }),
  output: Schema.Struct({ bankDepositId: S, match: Schema.Unknown, status: S }),
  steps: [
    { name: "candidates", rpc: rpc_requests_deposits_candidates, about: "The deposit and the open requests it could have paid." },
    { name: "pick", local: "prompt", about: "No request given, at a terminal: the person picks one or `none`." },
    { name: "match", rpc: rpc_requests_deposits_match, about: "Matches the deposit to the request, or to none." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: PREVIEW_WRITE,
});

export const flow_client_checkouts_pay = defineFlow({
  id: "client.checkouts.pay",
  title: "Pay at a link: the checkout page's flow",
  about:
    "Serves the checkout page (the React SDK's checkout surface, not the CLI), with no sign-in. It reads the link's public " +
    "terms, asks the payer for their email (and for a service, how many), names them at the link, and shows where to pay: " +
    "the escrow address and amount to send from any wallet, or the payer's Capxul inbox. Then it follows the link until " +
    "the request reads paid, or the page is closed; the escrow pays the issuer once it holds the amount.",
  was: [`${SDK}/checkouts.ts:1`, ASIS],
  component: component_core_sdk,
  surfaces: ["react"],
  sdk: "client.checkouts.pay",
  input: Schema.Struct({ link: S, email: opt(S), quantity: opt(N) }),
  output: Schema.Struct({ requestId: S, status: S }),
  steps: [
    { name: "terms", rpc: rpc_requests_checkout_get, about: "The link's public terms; null is an unknown or inactive link." },
    { name: "payer", local: "prompt", about: "Asks the payer for their email and, for a service, the quantity." },
    { name: "key", local: "cache", about: "One request key for this checkout, so a repeated submit returns the same purchase." },
    { name: "open", rpc: rpc_requests_checkout_open, about: "Names the payer: fixes the escrow, or births the purchase." },
    { name: "fund", local: "wait", about: "The payer sends the amount to the escrow from their own wallet, outside Capxul." },
    { name: "follow", rpc: rpc_requests_checkout_get, about: "Reads the link again every few seconds until it reads paid." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: PREVIEW_WRITE,
});
