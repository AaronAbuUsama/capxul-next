// The as-is Core SDK flows of the old banking concept: the public methods of `client.banking` and
// `client.org(orgId).banking` (packages/sdk/src/banking/) that compose more than one backend call or
// do local work. Only `details.open` does local work (it keeps one journey id per actor); every other
// method forwards one rpc and is listed in the comment at the end of this file.
//
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_NOT_IMPLEMENTED } from "../shared/vocabulary.ts";
import { rpc_banking_bank_details_open } from "./bank-details.ts";

const SDK = "packages/sdk/src/banking";

/** `InvocationControls` (packages/sdk/src/platform/actor/controls.ts): a signal, limits and ids, not data. */
const Controls = Schema.optionalKey(
  Schema.Struct({
    signal: Schema.optionalKey(Schema.Unknown),
    timeoutMs: Schema.optionalKey(Schema.Number),
    deadlineMs: Schema.optionalKey(Schema.Number),
    correlation_id: Schema.optionalKey(Schema.String),
    journey_id: Schema.optionalKey(Schema.String),
  }),
);
const Currency = Schema.Literals(["usd", "eur", "gbp"]);

const JOURNEY_ABOUT =
  "Keeps one journey per actor across opens: the caller's `journey_id`, else the last one this client kept for the same " +
  "actor, else the invocation's own, else `bank_details_<uuid>`; captures the attempt context while observation is active.";

const OPEN_WAS = [
  `${SDK}/bank-details.ts:72`,
  `${SDK}/bank-details.ts:79`,
  `${SDK}/bank-details.ts:81`,
  `${SDK}/bank-details.ts:85`,
  `${SDK}/bank-details.ts:95`,
  `${SDK}/bank-details.ts:130`,
  "packages/sdk/src/platform/capxul-effect.ts:166",
  "packages/protocol/src/banking/operations.ts:39",
];

export const flow_client_banking_details_open = defineFlow({
  id: "client.banking.details.open",
  title: "Open bank details for one currency, in the person's journey",
  about:
    "client.banking.details.open(currency) for the signed-in person's own Party. The banking methods are built once per " +
    "client (platform/client/scopes.ts:22), so the journey id they keep lives as long as the client. It forwards " +
    "`banking.bankDetails.open` with the currency and the invocation's observation, under one SDK span named after the " +
    "row. Output: the masked BankDetails, Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.banking.details.open",
  input: Schema.Struct({ currency: Currency, options: Controls }),
  output: Schema.Unknown,
  steps: [
    { name: "journey", local: "cache", about: JOURNEY_ABOUT },
    { name: "open", rpc: rpc_banking_bank_details_open, about: "Calls the row with `{ currency }` and the journey on the invocation." },
  ],
  errors: [],
  calls: [],
  spans: ["banking.bankDetails.open"],
  was: [...OPEN_WAS, "packages/sdk/src/platform/client/scopes.ts:22"],
});

export const flow_client_org_banking_details_open = defineFlow({
  id: "client.org.banking.details.open",
  title: "Open an Organization's bank details for one currency",
  about:
    "client.org(orgId).banking.details.open(currency): the same method bound to `{ kind: org, orgId }` " +
    "(platform/client/scopes.ts:29), cached per orgId in the Organization scope (organizations/scope.ts:198). A client " +
    "composed without the banking port answers NOT_IMPLEMENTED (`banking`, `executionComposition`) for every banking " +
    "method (`makeUnavailableBankingMethods`). Output: the masked BankDetails, Schema.Unknown.",
  component: component_core_sdk,
  sdk: "client.org(orgId).banking.details.open",
  input: Schema.Struct({ orgId: Schema.String, currency: Currency, options: Controls }),
  output: Schema.Unknown,
  steps: [
    { name: "journey", local: "cache", about: JOURNEY_ABOUT },
    { name: "open", rpc: rpc_banking_bank_details_open, about: "Calls the row with `{ actor: { kind: org, orgId }, currency }`." },
  ],
  errors: [error_NOT_IMPLEMENTED],
  calls: [],
  spans: ["banking.bankDetails.open"],
  was: [
    ...OPEN_WAS,
    "packages/sdk/src/platform/client/scopes.ts:29",
    "packages/sdk/src/organizations/scope.ts:204",
    `${SDK}/bank-details.ts:66`,
    `${SDK}/bank-details.ts:195`,
  ],
});

// ── Methods that forward one rpc: no flow; the operation names the rpc ───────────────────────
//
// client.banking.details.list        → banking.bank-details.list (bank-details.ts:103)
// client.banking.details.get         → banking.bank-details.get, { currency } (bank-details.ts:115)
// client.banking.details.settle      → banking.bank-details.settle, { currency, token } (bank-details.ts:145)
// client.banking.details.deactivate  → banking.bank-details.deactivate, { currency } (bank-details.ts:161)
// client.banking.details.reactivate  → banking.bank-details.reactivate, { currency } (bank-details.ts:176)
// client.banking.deposits.list       → banking.deposits.list, { cursor?, unmatched? } (deposits.ts:64)
// client.banking.deposits.get        → banking.deposits.get, { bankDepositId } (deposits.ts:80)
// client.banking.deposits.candidates → banking.deposits.candidates, { bankDepositId, cursor? } (deposits.ts:95)
// client.banking.deposits.match      → banking.deposits.match, { bankDepositId, requestId } (deposits.ts:111)
// client.org(orgId).banking.*        → the same rows with `actor: { kind: org, orgId }` (platform/client/scopes.ts:29);
//                                       a client without the banking port answers NOT_IMPLEMENTED for each.
//
// The payout quote is not a banking SDK method: client.payments.quote forwards payments.quotes.quote, which banking
// implements (booked in payouts.ts); the payments flows list it.
