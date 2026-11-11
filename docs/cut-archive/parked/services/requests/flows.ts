// Moved out of the built book by the cut, 10 November 2026, from books/target/requests/flows.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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
