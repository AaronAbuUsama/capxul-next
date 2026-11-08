// The as-is book of the old banking concept: the bank-details area (Bridge virtual accounts).
//
// Every operation registered at `banking/bankDetails:*` (packages/backend/convex/banking/bankDetails.ts),
// as the old code does it. Six are public rows of `bankDetails` (packages/protocol/src/banking/
// operations.ts:28); `prepare`, `finalize`, `applyLifecycle` and `load` are internal queries and
// mutations the public actions (and the Bridge inbox) run in the same call. Nothing here is
// scheduled, cron-driven or triggered after another call, so every one is an rpc.
//
// How touches are booked: an internal rpc lists what its own transaction does; a neighbour's
// in-transaction function it calls is an invoke of that neighbour's procedure. A public action holds
// no transaction: it lists what the internal rpcs it runs touch, and the Bridge calls it makes.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_bank_details_changed,
  event_bank_details_issued,
} from "../shared/vocabulary.ts";
import { integration_bridge } from "../shared/external.ts";
import { machine_bank_details, table_rail_receiving_accounts } from "./data.ts";
import { procedure_parties_read_banking_verification } from "../parties/procedures.ts";
import { procedure_accounts_require_exact_account_identity_in_tx } from "../accounts/procedures.ts";
import { procedure_organizations_require_payroll_organization_identity_in_tx } from "../organizations/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/banking/bankDetails.ts`;
const B = `${BACKEND}/src/banking`;
const BD = `${B}/bank-details`;
const OPS = `${BD}/operations`;
const ROWS = "packages/protocol/src/banking/operations.ts";
const SCHEMA = "packages/protocol/src/banking/schema.ts";
const SPAN = "packages/backend/src/platform/provider-observation.ts:54";
const CONVEX_SPAN = `${BACKEND}/src/platform/execute.ts:273`;

const S = Schema.String;
const opt = Schema.optionalKey;

// ── shared shapes and links ─────────────────────────────────────────────────────────────────

/** `ActorScopeSchema` (packages/protocol/src/parties/schema.ts): `{ kind: account }` or `{ kind: org, orgId }`. */
const Actor = opt(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("account") }),
    Schema.Struct({ kind: Schema.Literal("org"), orgId: S }),
  ]),
);
const Currency = Schema.Literals(["usd", "eur", "gbp"]);
const Token = Schema.Literals(["usdc", "eurc"]);

/** `BankDetailsSchema` (protocol/banking/schema.ts:42): masked in a list, full only from `get`. */
const BankDetails = Schema.Struct({
  receivingAccountId: S,
  currency: Currency,
  state: Schema.Literals(["requested", "active", "deactivated", "closed", "failed"]),
  visibility: Schema.Literals(["masked", "full"]),
  bankName: opt(S),
  accountHolder: opt(S),
  bankAddress: opt(S),
  paymentRails: Schema.Array(S),
  fields: Schema.Struct({
    routingNumber: opt(S),
    accountNumber: opt(S),
    iban: opt(S),
    bic: opt(S),
    sortCode: opt(S),
  }),
  destination: Schema.Struct({ chainId: Schema.Number, token: Token, address: S }),
  developerFeePercent: opt(S),
  minimumDeposit: opt(S),
  notice: opt(S),
});

/** `errors` (protocol/banking/operations.ts:16): every bank-details row. */
const READ_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_ROLE_PERMISSION_DENIED,
  error_ACCOUNT_NOT_FOUND,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_ENV_MISSING,
];
/** `bridgeWriteErrors` (protocol/banking/operations.ts:26). */
const BRIDGE_WRITE_ERRORS = [...READ_ERRORS, error_WRONG_STATE, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID];

/** `readBankingTarget` (bank-details/reads.ts:37): the caller's Party, verification and Safe. */
const TARGET_INVOKES = [
  procedure_parties_read_banking_verification,
  procedure_accounts_require_exact_account_identity_in_tx,
  procedure_organizations_require_payroll_organization_identity_in_tx,
];
const TARGET_WAS = [`${BD}/reads.ts:37`, `${BD}/reads.ts:46`, `${BD}/reads.ts:59`, `${BD}/reads.ts:65`];

/** `refreshVirtualAccount` (bank-details/external.ts:154): the account and its newest lifecycle entries. */
const READBACK_CALLS = [integration_bridge.c.readVirtualAccount, integration_bridge.c.readVirtualAccountHistory];
const READBACK_WAS = [`${BD}/external.ts:154`, `${BD}/external.ts:110`, `${BD}/external.ts:140`, `${BD}/external.ts:127`, `${BD}/rules.ts:186`, `${BD}/README.md:49`];
const READBACK_SPANS = ["bridge readVirtualAccount", "bridge readVirtualAccountHistory"];

const LIFECYCLE_DRIVES = [machine_bank_details.t.to_active, machine_bank_details.t.to_deactivated, machine_bank_details.t.to_closed];

const WHO_READ =
  "A signed-in person (`signedIn`) for their own Party, or for an Organization whose Party they may read (Parties' `requireReader`).";
const WHO_WRITE =
  "A signed-in person (`signedInAction`) for their own Party, or for an Organization whose bank details they may manage (Parties' `requireWriter`).";

// ── internal rpcs ───────────────────────────────────────────────────────────────────────────

export const rpc_banking_bank_details_load = defineRpc({
  id: "banking.bank-details.load",
  title: "Load stored bank details by Bridge account or by caller",
  about:
    "Registered as the internal query `banking/bankDetails:load` (`loadBankDetails`). With `railAccountRef` it returns the " +
    "row Bridge's account names (`by_rail_ref`), with no access check. Otherwise all of authUserId, email, currency and " +
    "write are required (else INVALID_INPUT `Bank-detail read input is incomplete`): it resolves the caller's Party, " +
    "verification and Safe (`readBankingTarget`) and returns the Party's row for the currency, or null; a row whose " +
    "destination is not that Safe is INVALID_INPUT on destination.",
  was: [`${CONVEX}:10`, `${OPS}/load.ts:22`, `${BD}/reads.ts:88`, `${BD}/reads.ts:13`, ...TARGET_WAS],
  concept: concept_banking,
  kind: "query",
  who: "internal: settle, deactivate and reactivate (by caller) and the Bridge inbox's process run (by Bridge account).",
  input: Schema.Struct({
    authUserId: opt(S),
    email: opt(S),
    actor: Actor,
    currency: opt(Currency),
    write: opt(Schema.Boolean),
    railAccountRef: opt(S),
  }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_ACCOUNT_NOT_FOUND, error_SMART_ACCOUNT_MISSING, error_WRONG_STATE, error_UNKNOWN],
  reads: [table_rail_receiving_accounts],
  writes: [],
  drives: [],
  invokes: TARGET_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_bank_details_prepare = defineRpc({
  id: "banking.bank-details.prepare",
  title: "Store the Safe-bound bank details row before Bridge is called",
  about:
    "Registered as the internal mutation `banking/bankDetails:prepare` (`prepareBankDetails`). Resolves the caller's " +
    "Party, verification and Safe for write (`readBankingTarget`); the Party must have a Bridge customer, its people " +
    "ready, the terms accepted and the currency approved, else WRONG_STATE naming the first failed condition " +
    "(`requireBankingEligibility`). Checks the route (`bridgeDestination`: Base Sepolia only; usd takes usdc, eur takes " +
    "eurc or usdc, gbp takes usdc; else INVALID_INPUT). Returns the Party's stored row for the currency (a destination " +
    "that is not the Safe is INVALID_INPUT), or inserts one: `receiving_<ulid>` as id and creation key, state " +
    "`requested`, the default token (eurc for eur, else usdc), the lowercased Safe, and the journey from the linkage.",
  was: [`${CONVEX}:7`, `${OPS}/prepare.ts:19`, `${BD}/writes.ts:38`, `${BD}/writes.ts:72`, `${BD}/rules.ts:29`, `${BD}/rules.ts:61`, ...TARGET_WAS],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: `banking.bank-details.open`, as its first step.",
  input: Schema.Struct({ authUserId: S, email: S, actor: Actor, currency: Currency }),
  output: Schema.Unknown,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_ACCOUNT_NOT_FOUND, error_SMART_ACCOUNT_MISSING, error_UNKNOWN],
  reads: [table_rail_receiving_accounts],
  writes: [table_rail_receiving_accounts],
  drives: [],
  invokes: TARGET_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_bank_details_finalize = defineRpc({
  id: "banking.bank-details.finalize",
  title: "Store Bridge's virtual account answer on the prepared row once",
  about:
    "Registered as the internal mutation `banking/bankDetails:finalize` (`finalizeBankDetails`). A missing prepared row is " +
    "INVALID_INPUT; a row already bound to another Bridge account is INVALID_INPUT; a repeat for the same account returns " +
    "the row and issues nothing (annotated `refused: DUPLICATE`). The first issue patches the Bridge account ref, bank " +
    "rail, state, state time and the public and encrypted payloads, then schedules `bank_details_issued` (receiving " +
    "account, currency, bank rail; no bank number) after the patch, attributed to the row's person and journey.",
  was: [`${CONVEX}:8`, `${OPS}/finalize.ts:22`, `${BD}/writes.ts:109`, `${BD}/writes.ts:126`, `${BD}/writes.ts:137`, `${BD}/events.ts:27`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: `banking.bank-details.open`, after Bridge answered.",
  input: Schema.Struct({
    receivingAccountId: S,
    railAccountRef: S,
    state: Schema.Literals(["requested", "active", "deactivated", "closed", "failed"]),
    stateAt: S,
    bankRail: Schema.Literals(["ach", "wire", "sepa", "faster_payments"]),
    publicPayloadJson: S,
    secretPayloadEnc: S,
  }),
  output: Schema.Unknown,
  errors: [error_INVALID_INPUT],
  reads: [table_rail_receiving_accounts],
  writes: [table_rail_receiving_accounts],
  drives: LIFECYCLE_DRIVES,
  invokes: [],
  emits: [event_bank_details_issued],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_bank_details_apply_lifecycle = defineRpc({
  id: "banking.bank-details.apply-lifecycle",
  title: "Apply one Bridge lifecycle point to stored bank details",
  about:
    "Registered as the internal mutation `banking/bankDetails:applyLifecycle` (`applyBankDetailsLifecycle`). Returns null " +
    "when no row has the Bridge account. Orders the point against the row (`compareLifecycle`: provider time, then " +
    "the same activity, then event sequence); a stale or duplicate point, or any point on a closed account, leaves the " +
    "row (annotated refused). A newer point moves the state by `transitionBankDetails` and stores its time, sequence " +
    "and activity; a point of the same activity only merges its sequence. A readback's public and encrypted payloads and " +
    "settlement token are stored whenever given, the token into `destination.token`. `background: true` (the inbox) " +
    "names the row's person on the wide event.",
  was: [`${CONVEX}:9`, `${OPS}/apply-lifecycle.ts:25`, `${BD}/writes/lifecycle.ts:29`, `${BD}/writes/lifecycle.ts:79`, `${BD}/rules.ts:101`, `${BD}/rules.ts:121`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: settle, deactivate and reactivate after their readback, and the Bridge inbox's process run.",
  input: Schema.Struct({
    railAccountRef: S,
    event: Schema.Literals(["activated", "deactivated", "closed", "failed", "updated"]),
    stateAt: S,
    stateSeq: opt(Schema.Number),
    activityRef: S,
    publicPayloadJson: opt(S),
    secretPayloadEnc: opt(S),
    token: opt(Token),
    background: opt(Schema.Boolean),
  }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [],
  reads: [table_rail_receiving_accounts],
  writes: [table_rail_receiving_accounts],
  drives: LIFECYCLE_DRIVES,
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── public rpcs ─────────────────────────────────────────────────────────────────────────────

export const rpc_banking_bank_details_list = defineRpc({
  id: "banking.bank-details.list",
  title: "List the actor's bank details, masked",
  about:
    "Row `banking.bankDetails.list`, registered as the public query `banking/bankDetails:list`. Reads the actor's Party " +
    "and verification (Parties' `readBankingVerification`, read access), then every row of the Party that Bridge has " +
    "answered for (`railAccountRef` set), ordered usd, eur, gbp, each masked (last digits only). Returns them with the " +
    "Party's per-currency verification. A stored public payload that does not decode is UNKNOWN.",
  was: [`${CONVEX}:1`, `${OPS}/list.ts:9`, `${BD}/reads.ts:26`, `${BD}/views.ts:24`, `${BD}/errors.ts:10`, `${ROWS}:29`, `${SCHEMA}:62`],
  concept: concept_banking,
  kind: "query",
  who: WHO_READ,
  input: Schema.Struct({ actor: Actor }),
  output: Schema.Struct({ accounts: Schema.Array(BankDetails), verification: Schema.Array(Schema.Unknown) }),
  errors: READ_ERRORS,
  reads: [table_rail_receiving_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_parties_read_banking_verification],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_bank_details_get = defineRpc({
  id: "banking.bank-details.get",
  title: "Read one currency's bank details in full",
  about:
    "Row `banking.bankDetails.get`, registered as the public query `banking/bankDetails:get`. The only read that reveals " +
    "full bank numbers: it reads the actor's Party (read access) and its row for the currency, null until Bridge has " +
    "answered, and decrypts the private numbers with `CAPXUL_ACCOUNT_SECRETS_KEY` (a missing key is ENV_MISSING; numbers " +
    "that cannot be read or decoded are UNKNOWN on `secretPayloadEnc`).",
  was: [`${CONVEX}:2`, `${OPS}/get.ts:10`, `${BD}/reads.ts:13`, `${BD}/external.ts:133`, `${BD}/views.ts:24`, `${BD}/errors.ts:21`, `${ROWS}:34`],
  concept: concept_banking,
  kind: "query",
  who: WHO_READ,
  input: Schema.Struct({ actor: Actor, currency: Currency }),
  output: Schema.NullOr(BankDetails),
  errors: READ_ERRORS,
  reads: [table_rail_receiving_accounts],
  writes: [],
  drives: [],
  invokes: [procedure_parties_read_banking_verification],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_bank_details_open = defineRpc({
  id: "banking.bank-details.open",
  title: "Open bank details for one currency at Bridge",
  about:
    "Row `banking.bankDetails.open`, registered as the public action `banking/bankDetails:open`. Runs the internal " +
    "mutation `prepare` (the row and its creation key exist before any Bridge call); a row Bridge already answered is " +
    "returned masked with no call. Otherwise it builds the body (`bridgeDestination`), creates the virtual account at " +
    "Bridge with the creation key as idempotency key (`createVirtualAccount`; the answer must name a bank rail, else " +
    "PROVIDER_RESPONSE_INVALID), encrypts the full numbers, adds the documented minimum deposit for the route " +
    "(`bankDetailsMetadata`), and runs `finalize`, which issues `bank_details_issued` once. Answers the masked view.",
  was: [
    `${CONVEX}:3`,
    `${OPS}/open.ts:13`,
    `${OPS}/open.ts:19`,
    `${OPS}/open.ts:27`,
    `${OPS}/open.ts:36`,
    `${OPS}/open.ts:38`,
    `${BD}/external.ts:29`,
    `${BD}/external.ts:86`,
    `${BD}/external.ts:140`,
    `${BACKEND}/src/integrations/bridge/service.ts:119`,
    `${ROWS}:39`,
    SPAN,
    CONVEX_SPAN,
  ],
  concept: concept_banking,
  kind: "action",
  who: WHO_WRITE,
  input: Schema.Struct({ actor: Actor, currency: Currency }),
  output: BankDetails,
  errors: BRIDGE_WRITE_ERRORS,
  reads: [table_rail_receiving_accounts],
  writes: [table_rail_receiving_accounts],
  drives: LIFECYCLE_DRIVES,
  invokes: TARGET_INVOKES,
  emits: [event_bank_details_issued],
  calls: [integration_bridge.c.createVirtualAccount],
  chain: [],
  spans: ["convex.mutation", "bridge createVirtualAccount"],
});

export const rpc_banking_bank_details_settle = defineRpc({
  id: "banking.bank-details.settle",
  title: "Change the settlement token of one currency's bank details",
  about:
    "Row `banking.bankDetails.settle`, registered as the public action `banking/bankDetails:settle`. Runs the internal " +
    "query `load` with write access (no opened row is INVALID_INPUT `Open bank details first`), checks the new token's " +
    "route, reads Bridge back before writing (account and newest activation, deactivation and account_update entries), " +
    "updates the account's destination at Bridge (`updateVirtualAccount`, the same Safe), reads it back again, and runs " +
    "`applyLifecycle` with the readback. A readback that fails after the write leaves Bridge ahead until the " +
    "`account_update` webhook or a retry applies it. Queues `bank_details_changed` (token and previous token, the " +
    "signed-in person) only when the stored token changed. Answers the masked view.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/settle.ts:16`,
    `${OPS}/settle.ts:22`,
    `${OPS}/settle.ts:37`,
    `${OPS}/settle.ts:39`,
    `${OPS}/settle.ts:40`,
    `${OPS}/settle.ts:47`,
    `${OPS}/settle.ts:48`,
    `${OPS}/settle.ts:62`,
    `${BD}/external.ts:39`,
    `${BD}/events.ts:80`,
    `${ROWS}:44`,
    ...READBACK_WAS,
    SPAN,
    CONVEX_SPAN,
  ],
  concept: concept_banking,
  kind: "action",
  who: WHO_WRITE,
  input: Schema.Struct({ actor: Actor, currency: Currency, token: Token }),
  output: BankDetails,
  errors: BRIDGE_WRITE_ERRORS,
  reads: [table_rail_receiving_accounts],
  writes: [table_rail_receiving_accounts],
  drives: LIFECYCLE_DRIVES,
  invokes: TARGET_INVOKES,
  emits: [event_bank_details_changed],
  calls: [...READBACK_CALLS, integration_bridge.c.updateVirtualAccount],
  chain: [],
  spans: ["convex.query", "convex.mutation", ...READBACK_SPANS, "bridge updateVirtualAccount"],
});

const lifecycleAction = (change: "deactivate" | "reactivate") =>
  ({
    about:
      `Row \`banking.bankDetails.${change}\`, registered as the public action \`banking/bankDetails:${change}\`. Runs the ` +
      "internal query `load` with write access (no opened row is INVALID_INPUT `Open bank details first`), asks Bridge to " +
      `${change} the account (\`changeVirtualAccountState\`, idempotency key \`<creationKey>:${change}:<stateActivityRef or stateAt>\`), ` +
      "reads Bridge back (account and newest lifecycle entries), and runs `applyLifecycle` with the readback (a vanished " +
      "row is INVALID_INPUT `Bank details are unavailable`). Answers the masked view.",
    was: [
      `${CONVEX}:${change === "deactivate" ? 5 : 6}`,
      `${OPS}/${change}.ts:13`,
      `${OPS}/${change}.ts:19`,
      `${OPS}/${change}.ts:31`,
      `${OPS}/${change}.ts:32`,
      `${BD}/external.ts:170`,
      `${BD}/external.ts:51`,
      `${ROWS}:${change === "deactivate" ? 49 : 54}`,
      ...READBACK_WAS,
      SPAN,
      CONVEX_SPAN,
    ],
    concept: concept_banking,
    kind: "action",
    who: WHO_WRITE,
    input: Schema.Struct({ actor: Actor, currency: Currency }),
    output: BankDetails,
    errors: BRIDGE_WRITE_ERRORS,
    reads: [table_rail_receiving_accounts],
    writes: [table_rail_receiving_accounts],
    drives: LIFECYCLE_DRIVES,
    invokes: TARGET_INVOKES,
    emits: [],
    calls: [integration_bridge.c.changeVirtualAccountState, ...READBACK_CALLS],
    chain: [],
    spans: ["convex.query", "convex.mutation", `bridge ${change}VirtualAccount`, ...READBACK_SPANS],
  }) as const;

export const rpc_banking_bank_details_deactivate = defineRpc({
  id: "banking.bank-details.deactivate",
  title: "Deactivate one currency's bank details at Bridge",
  ...lifecycleAction("deactivate"),
});

export const rpc_banking_bank_details_reactivate = defineRpc({
  id: "banking.bank-details.reactivate",
  title: "Reactivate one currency's bank details at Bridge",
  ...lifecycleAction("reactivate"),
});
