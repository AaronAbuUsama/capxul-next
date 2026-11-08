// What the rebuilt Capxul talks to outside itself: integrations as Effect services, and the
// Protocol v4 contracts (P9: nothing pre-v4).
//
// Integrations. Each call has a timeout per attempt, a retry policy, a p95 and every way it fails
// mapped to a target error. The numbers come from policy P5's hop table (one eth_call 80-150 ms p50
// and 400 ms p95; a vendor call 300-600 ms p50 and 2 s p95; the bundler's three calls about 450 ms
// p50; Ponder polling every 2 s), so a call fits inside the budget class of the rpc or workflow that
// makes it. The old 30 s per-attempt timeouts are gone: a user read could not meet its class with
// them. A call that moves money is never retried blindly: it is looked up first (K4).
//
// Contracts. The 15 Capxul contracts of the v4 address book, plus the third-party contracts the v4
// install wires and the product calls (Safe, Safe4337Module, MultiSendCallOnly, EntryPoint v0.7,
// Zodiac Roles 2.1, Hats, the Hats Signer Gate v2, Hats Elections, ERC-20 tokens). Functions and events are the ones
// the frozen book's designed calls name, or that a concept must read to follow them. Addresses are
// the devnet deployment; staging gets a fresh deployment (P9), recorded when it exists.

import { defineContract, defineIntegration } from "../../../packages/book/src/index.ts";
import { component_backend, component_core_sdk } from "./foundation.ts";
import {
  error_AMOUNT_BELOW_USE,
  error_CANCELLED,
  error_CHILDREN_EXCEED_PARENT,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_TRANSACTION_FAILED,
  error_VERIFICATION_REQUIRED,
  error_WORK_DIED,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "./vocabulary.ts";

const OLD = "packages/backend/src/integrations";
const V4 = "packages/contracts/v4/src";
const ADDR = "packages/protocol/src/evm/protocol-v4-addresses.ts";
const SAFE = "packages/protocol/src/evm/safe-contracts.ts";

const unavailable = (who: string) =>
  ({ when: `${who} timed out, was down or throttled on every attempt (mode timeout, upstream-down or rate-limited)`, error: error_PROVIDER_ERROR }) as const;
const unusable = (who: string) =>
  ({ when: `${who} answered something that does not decode as the expected shape`, error: error_PROVIDER_RESPONSE_INVALID }) as const;

// ── chain-rpc ───────────────────────────────────────────────────────────────────────────────

/** One node read: 1.5 s an attempt, then the next configured node, at most three in all. */
const NODE_READ = { timeoutMs: 1_500, retries: { max: 2, backoff: "none" }, p95Ms: 400 } as const;

export const integration_chain_rpc = defineIntegration({
  id: "chain-rpc",
  title: "Chain JSON-RPC: Base nodes",
  about:
    "Reads from the chain's JSON-RPC nodes, behind the Effect service `ChainRpc`: the configured node list in order, moving " +
    "to the next node on a transport failure, a throttle or an internal error; a JSON-RPC verdict on the request is final. " +
    "It serves the reads Ponder cannot: contract state as of now, where Ponder holds it late or not at all, before a write " +
    "is built (a budget's `leftOf`, a Safe's owners, an allowance, a token's metadata), for a show a person waits on (what " +
    "an agreement has released, a vote's tally) and when a notice is sent (its figures, and a company's Directors from the " +
    "Safe's owners); an agent's sign-in proof; and the window reads of the added-token scan. Chain facts that have " +
    "happened are read from Ponder's tables (indexing), never from here (integrations.chain-rpc-live-reads). Every call " +
    "carries `chain.<method>` as its span (P6).",
  component: component_backend,
  system: "evm-json-rpc",
  service: "ChainRpc",
  calls: {
    readContract: {
      about: "eth_call of one view function at `latest` or a named block; `0x` from a contract that should answer is unusable.",
      ...NODE_READ,
      failures: [
        unavailable("Every configured node"),
        { when: "The call reverted, or the address has no code, where the caller expects an answer", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    getCode: {
      about: "eth_getCode at `latest`: whether a Safe or module is deployed, and which mastercopy a proxy points at.",
      ...NODE_READ,
      failures: [unavailable("Every configured node"), unusable("The node")],
    },
    getBlock: {
      about: "eth_getBlockByNumber: the chain head's number, time and base fee (a deadline the chain judges, fee estimates, the drift watch's lag).",
      ...NODE_READ,
      failures: [unavailable("Every configured node"), unusable("The node")],
    },
    getTransactionReceipt: {
      about: "eth_getTransactionReceipt of one transaction hash; null while it is not mined.",
      ...NODE_READ,
      failures: [unavailable("Every configured node"), unusable("The node")],
    },
    getLogs: {
      about:
        "eth_getLogs over one block window, for books' added-token scan only: at most 2,000 blocks per call, on the " +
        "nodes that take wide log reads.",
      timeoutMs: 5_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 1_500,
      failures: [
        unavailable("Every node that takes wide log reads"),
        { when: "A log lies outside the requested window, or does not decode as the event asked for", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
  },
  fake:
    "The devnet's Anvil node is the only node, so fallback between nodes cannot be shown; a node outage is shown with the " +
    "layer's fault switch. Anvil answers in 2-10 ms, so devnet runs beat the p95 by design.",
  secrets: ["BASE_SEPOLIA_RPC_URLS"],
  was: [`${OLD}/chain-rpc/service.ts:57`, `${OLD}/chain-rpc/internal/upstreams.ts:38`, "docs/decisions/policy-pack.md#p5"],
});

// ── bundler and paymaster ───────────────────────────────────────────────────────────────────

export const integration_bundler = defineIntegration({
  id: "bundler",
  title: "Bundler and paymaster: sponsor, send, follow",
  about:
    "ERC-4337 sending and ERC-7677 sponsorship through the one gateway URL, behind the Effect service `Bundler`. Approvals " +
    "is its only caller: it sponsors an approval's UserOperation (stub data, gas estimate, final paymaster data with the " +
    "sponsorship window), sends it once after the owner signs, and looks it up. A send is never repeated: when its answer " +
    "is lost, the operation is looked up by hash (K4). The simulation inside sponsorship is where the chain's authority " +
    "refusals surface before anyone signs, so they map to the codes the frozen refusals give them: a budget's shortfall " +
    "or the payout ceiling is a budget refusal, any other Roles, Budgets or Gate refusal an authority refusal (K18, " +
    "integrations.sponsor-refusals).",
  component: component_backend,
  system: "aa-gateway (alto behind the verifying paymaster)",
  service: "Bundler",
  calls: {
    sponsor: {
      about: "pm_getPaymasterStubData, eth_estimateUserOperationGas, then pm_getPaymasterData with the window: one sponsored, signable operation.",
      timeoutMs: 4_000,
      retries: { max: 1, backoff: "exponential" },
      p95Ms: 1_200,
      failures: [
        unavailable("The gateway"),
        { when: "The simulation reverts with the token's ERC20InsufficientBalance: the paying Safe holds too little", error: error_INSUFFICIENT_BALANCE },
        {
          when: "The simulation reverts with Budgets' OverBudget, or a Zodiac Roles ConditionViolation whose status is AllowanceExceeded (the payout ceiling)",
          error: error_PAYROLL_BUDGET_EXCEEDED,
        },
        { when: "The simulation reverts with Budgets' ChildrenExceedParent: the parent has less left to give", error: error_CHILDREN_EXCEED_PARENT },
        { when: "The simulation reverts with Budgets' AmountBelowUse: below what the budget already uses", error: error_AMOUNT_BELOW_USE },
        { when: "The simulation reverts with Budgets' BudgetIsClosed: the budget or one above it is closed", error: error_WRONG_STATE },
        {
          when: "The simulation reverts in Zodiac Roles (any other ConditionViolation, NoMembership), Budgets (NotAuthorised) or the Gate",
          error: error_ROLE_PERMISSION_DENIED,
        },
        { when: "The simulation reverts for any other reason: the chain would refuse the operation as it stands", error: error_TRANSACTION_FAILED },
        { when: "The paymaster answer has no paymaster data, or a window that is zero or already past", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    send: {
      about: "eth_sendUserOperation of the signed operation, once; returns its UserOperation hash, which must equal the one signed.",
      timeoutMs: 5_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 600,
      failures: [
        { when: "The gateway did not answer: the operation may be held, so it is looked up, never sent again", error: error_PROVIDER_ERROR },
        { when: "The bundler rejected the operation in validation (bad signature, nonce used, window closed)", error: error_TRANSACTION_FAILED },
        { when: "The bundler answered a hash that is not the signed operation's", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    lookup: {
      about: "eth_getUserOperationByHash and eth_getUserOperationReceipt: whether the bundler holds the operation, and its receipt once mined.",
      timeoutMs: 2_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 400,
      failures: [unavailable("The gateway"), unusable("The gateway")],
    },
  },
  fake:
    "alto behind the mock paymaster on the devnet: it sponsors every operation, so it cannot show the gateway's token " +
    "refusal or its sponsorship policy; the policy has its own conformance suite against the staging gateway.",
  secrets: ["BUNDLER_RPC_URL"],
  was: [`${OLD}/chain-rpc/README.md:59`, "packages/aa-gateway/README.md:12", "docs/as-is/payments.md"],
});

// ── indexer ─────────────────────────────────────────────────────────────────────────────────

export const integration_indexer = defineIntegration({
  id: "indexer",
  title: "Indexer: Ponder's progress and a transaction's facts",
  about:
    "Ponder's read model in the same Postgres, behind the Effect service `Indexer`. A plain read of indexed rows is a table " +
    "read of indexing's views. What depends on Ponder's own progress is a call, with a timeout and a failure: how far it " +
    "has indexed, waiting until it has indexed a block, and reading every fact of one transaction at a finality depth (the " +
    "one settlement path: PaymentSent, its Transfer and the UserOperationEvent, checked together). Ponder can lag, " +
    "reindex or be rebuilt; a caller that needs a fact it has not indexed yet waits for it or is told so, never answered " +
    "with nothing. This replaces old chain-evidence's receipt path and old ponder's HTTP reader.",
  component: component_backend,
  system: "ponder (same Postgres)",
  service: "Indexer",
  calls: {
    head: {
      about: "The block Ponder has indexed and the chain head it last saw, so a reader can say how far behind the chain it is.",
      timeoutMs: 500,
      retries: { max: 0, backoff: "none" },
      p95Ms: 20,
      failures: [unavailable("Postgres"), unusable("Ponder's checkpoint")],
    },
    awaitBlock: {
      about: "Waits until Ponder has indexed a block (the block of a receipt) before its facts are read; one poll a second.",
      timeoutMs: 10_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 3_000,
      failures: [{ when: "Ponder did not reach the block in time, or is reindexing and its views are not ready", error: error_PROVIDER_ERROR }],
    },
    factsOf: {
      about: "Every indexed fact of one transaction, at the deployment's finality depth: payment, transfer, user operation and v4 events.",
      timeoutMs: 1_000,
      retries: { max: 1, backoff: "fixed" },
      p95Ms: 50,
      failures: [unavailable("Postgres"), { when: "A fact does not decode as its event, or two facts claim the same log", error: error_PROVIDER_RESPONSE_INVALID }],
    },
  },
  fake: "None: the devnet runs real Ponder over Anvil. Anvil's instant blocks cannot show a deep reorg unless a test scripts one.",
  secrets: [],
  was: [`${OLD}/ponder/service.ts:45`, `${OLD}/chain-evidence/service.ts:76`, "apps/indexer/ponder.config.ts:106"],
});

// ── bridge ──────────────────────────────────────────────────────────────────────────────────

const BRIDGE_CALL = { timeoutMs: 10_000, retries: { max: 2, backoff: "exponential" }, p95Ms: 2_000 } as const;
const bridgeFailures = [
  unavailable("Bridge"),
  { when: "Bridge refused the request with a status the caller cannot fix (mode refused)", error: error_PROVIDER_ERROR },
  { when: "Bridge answered 429 and the retries ran out", error: error_RATE_LIMITED },
  unusable("Bridge"),
] as const;

export const integration_bridge = defineIntegration({
  id: "bridge",
  title: "Bridge: verification, bank details, deposits and payouts",
  about:
    "Bridge's API, behind the Effect service `Bridge`, called only by banking. Every write carries an Idempotency-Key from " +
    "the banking record it serves, so a retry is safe. Bridge's own events reach Capxul through the signed webhook route " +
    "and a catch-up read (P3 keeps the Bridge catch-up cron), never by polling a transfer in a request.",
  component: component_backend,
  system: "bridge",
  service: "Bridge",
  calls: {
    submitVerification: {
      about: "Creates or continues a customer's KYC or KYB with the answers and documents; returns the next step and any hosted link.",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures, { when: "Bridge rejected an answer or a document as malformed", error: error_INVALID_INPUT }],
    },
    getVerification: {
      about: "A customer's verification status and what it still needs, per currency.",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
    openBankDetails: {
      about: "Creates the virtual account for a Party and currency, paying into its Safe in the chosen token; full details once.",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures, { when: "The customer is not verified for that currency", error: error_VERIFICATION_REQUIRED }],
    },
    readBankDetails: {
      about:
        "Reads one virtual account as Bridge holds it now: its status, the token its deposits become and its details, so " +
        "a change is checked before it is written and read back after.",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
    setDepositToken: {
      about: "Changes the token a virtual account's deposits become (USDC or EURC).",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures, { when: "Bridge does not offer that token for the currency", error: error_INVALID_INPUT }],
    },
    addBankAccount: {
      about: "Saves an external bank account (yours or a contact's) for payouts; the fields depend on the currency.",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures, { when: "Bridge rejected the account fields", error: error_INVALID_INPUT }],
    },
    quotePayout: {
      about: "Creates a payout transfer to a saved bank account and returns its deposit address, token and amounts for the quote.",
      ...BRIDGE_CALL,
      failures: [
        ...bridgeFailures,
        { when: "The customer is not verified for the currency", error: error_VERIFICATION_REQUIRED },
        { when: "The amount is outside Bridge's limits for the rail", error: error_INVALID_INPUT },
      ],
    },
    listEvents: {
      about: "Bridge's events since a cursor, for the catch-up of webhook deliveries Capxul missed.",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
  },
  fake:
    "Bridge's sandbox, or the devnet's local Bridge stand-in, which answers every call and posts signed events but cannot " +
    "run liveness checks or a real verification decision. For a sandbox deposit the fake itself (the devnet stand-in, or " +
    "staging's sandbox harness) sends the test tokens to the receiving Safe and names that transaction in its event, so " +
    "banking credits it on the one path it uses everywhere (banking.sandbox-deposits).",
  secrets: ["BRIDGE_API_KEY", "BRIDGE_WEBHOOK_PUBLIC_KEY"],
  was: ["packages/backend/src/banking/README.md:3", "packages/backend/convex/http.ts:113"],
});

// ── mail ────────────────────────────────────────────────────────────────────────────────────

export const integration_mail = defineIntegration({
  id: "mail",
  title: "Email through Resend",
  about:
    "Transactional email, behind the Effect service `Mail`. Notices' workflows send every notice, and retry durably (three " +
    "tries, a minute then four apart); access sends the sign-in code inside its own rpc. The call itself never retries: a " +
    "retry belongs to the workflow, which records each attempt.",
  component: component_backend,
  system: "resend",
  service: "Mail",
  calls: {
    send: {
      about: "Sends one message to one recipient with an idempotency key from the notice; returns the provider's message id.",
      timeoutMs: 10_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 2_000,
      failures: [
        unavailable("Resend"),
        { when: "Resend refused the recipient address", error: error_INVALID_INPUT },
        { when: "Resend answered 429", error: error_RATE_LIMITED },
      ],
    },
  },
  fake: "The devnet's mail sink (devnet's tables): every message is kept and nothing is sent; `dev mail fail` makes the next sends refuse.",
  secrets: ["RESEND_API_KEY"],
  was: [`${OLD}/mail/service.ts:125`, `${OLD}/mail/notices.ts:17`],
});

// ── openfort (the person's signer, in the Core SDK) ─────────────────────────────────────────

export const integration_openfort = defineIntegration({
  id: "openfort",
  title: "Openfort embedded signer in the Core SDK",
  about:
    "The person's signer in a browser, behind the Core SDK's `Signer` service (A4: the SDK owns all signing). It reads the " +
    "embedded wallet's address and signs an approval's digest (the SafeOp hash) without a message prefix, then checks the " +
    "signature recovers that address. An agent's own key and the devnet's dev signer implement the same service locally " +
    "and are not outside systems. The person's wait while signing is the flow's `wait` step, never system time.",
  component: component_core_sdk,
  system: "openfort",
  service: "Signer",
  calls: {
    getAddress: {
      about: "The embedded wallet's address, after the readiness cycle; heals a stale cached Openfort user once.",
      timeoutMs: 10_000,
      retries: { max: 1, backoff: "none" },
      p95Ms: 2_000,
      failures: [unavailable("Openfort"), unusable("The embedded wallet")],
    },
    signDigest: {
      about: "A 65-byte signature over a 32-byte digest; when the signer is not ready, one fresh readiness cycle, then one more try.",
      timeoutMs: 60_000,
      retries: { max: 1, backoff: "none" },
      p95Ms: 2_000,
      failures: [
        { when: "The person declined, or cancelled the passkey prompt; never retried", error: error_CANCELLED },
        { when: "The signer was still not ready after the one recovery", error: error_PROVIDER_ERROR },
        { when: "The signature has the wrong length or does not recover the wallet's address", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
  },
  fake: "None: a devnet browser run uses a real Openfort test project. CLI and Node hosts sign with a local key and never call Openfort.",
  secrets: ["OPENFORT_PUBLISHABLE_KEY", "SHIELD_PUBLISHABLE_KEY"],
  was: ["packages/sdk/src/signing/signer.ts:47", "packages/sdk/src/signing/openfort-embedded.ts:46"],
});

export const integration_openfort_shield = defineIntegration({
  id: "openfort-shield",
  title: "Openfort Shield: the wallet's recovery session",
  about:
    "The backend's one Openfort call, behind the Effect service `Shield`: an encryption session that lets the person's " +
    "embedded wallet recover its key share in a new browser. Access serves it to a signed-in person. The old CLI fetched " +
    "it itself; in the target only the Core SDK asks, through an access rpc.",
  component: component_backend,
  system: "openfort-shield",
  service: "Shield",
  calls: {
    createEncryptionSession: {
      about: "One encryption session for the signed-in person's wallet.",
      timeoutMs: 5_000,
      retries: { max: 1, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [unavailable("Shield"), unusable("Shield")],
    },
  },
  fake: "None: devnet browser runs use a real Openfort test project; Node hosts never need it.",
  secrets: ["SHIELD_SECRET_KEY", "SHIELD_ENCRYPTION_SHARE"],
  was: ["apps/cli/src/signer/bridge-upstream.ts:124"],
});

// ── chainlink prices ────────────────────────────────────────────────────────────────────────

export const integration_chainlink = defineIntegration({
  id: "chainlink",
  title: "Chainlink price feeds",
  about:
    "USD rates for the books, behind the Effect service `Prices`: `latestRoundData` and `decimals` of a pair's feed on the " +
    "chain, read through chain-rpc. Books' price workflow keeps the rate history (P3 keeps the price sync cron); a money fact " +
    "takes the rate in force at its block.",
  component: component_backend,
  system: "chainlink",
  service: "Prices",
  calls: {
    usdRate: {
      about: "The pair's latest answer, its decimals and when it was updated.",
      ...NODE_READ,
      failures: [
        unavailable("Every configured node"),
        { when: "The answer is not positive, or older than the feed's heartbeat", error: error_PROVIDER_RESPONSE_INVALID },
        { when: "The pair has no feed on this network", error: error_INVALID_INPUT },
      ],
    },
  },
  fake:
    "The devnet's scripted rates (`dev prices set`, devnet's `scripted-prices`), dated when they took effect; without a " +
    "script, the frozen default rates (USDC and USDT 1.00, EURC 1.08, WETH 3,000, WBTC 60,000).",
  secrets: [],
  was: ["packages/backend/src/platform/jobs.ts:57", "docs/decisions/policy-pack.md#p3"],
});

// ── posthog ─────────────────────────────────────────────────────────────────────────────────

export const integration_posthog = defineIntegration({
  id: "posthog",
  title: "PostHog through the connector gateway",
  about:
    "Product analytics and telemetry, behind the Effect service `Analytics`, reached through the connector gateway, which " +
    "holds the PostHog key (Y4). The runtime's outbox relay sends each transition's `<machine>_transitioned` event once " +
    "(P7); the runtime exports the required spans and logs (P6); access' gates workflow reads the feature flags (P3 keeps " +
    "the flag sync). No request ever waits on PostHog.",
  component: component_backend,
  system: "posthog (through the connector gateway)",
  service: "Analytics",
  calls: {
    capture: {
      about: "One batch of product events from the outbox, each with its delivery id, so a repeat is dropped by PostHog.",
      timeoutMs: 5_000,
      retries: { max: 5, backoff: "exponential" },
      p95Ms: 1_000,
      failures: [unavailable("The gateway"), { when: "The gateway or PostHog refused the batch (mode refused)", error: error_PROVIDER_ERROR }],
    },
    exportTelemetry: {
      about: "One OTLP export of spans and logs.",
      timeoutMs: 5_000,
      retries: { max: 3, backoff: "exponential" },
      p95Ms: 1_000,
      failures: [unavailable("The gateway")],
    },
    flags: {
      about: "The feature flag definitions and their rollouts, for the gates sync.",
      timeoutMs: 5_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 1_000,
      failures: [unavailable("The gateway"), unusable("PostHog's flag list")],
    },
  },
  fake:
    "The eval harness's local OTLP collector and capture sink, which `observed(traceId)` reads; flags from the devnet's " +
    "gates table. Evals never reach PostHog.",
  secrets: ["CONNECTOR_GATEWAY_TOKEN"],
  was: ["packages/backend/src/platform/observation/telemetry.ts:66", "docs/spec/00-overview.md"],
});

// ── service-signer ──────────────────────────────────────────────────────────────────────────

export const integration_service_signer = defineIntegration({
  id: "service-signer",
  title: "Capxul's service keys: signed chain transactions",
  about:
    "The few chain writes Capxul makes with its own keys, as plain transactions, behind the Effect service `ServiceSigner`: " +
    "Companies House's claim role (a person's Safe claim) and tier key (a company Safe mint, `Installer.deployMoney`), " +
    "Budgets' executor (`Budgets.execute` of a dated payment), the escrow relayer (deploying and paying out a funded " +
    "escrow) and the testnet faucet. One send in flight per key; the signed bytes are recorded before they are broadcast, so " +
    "a lost answer is looked up by hash and never sent twice (CAP-1097). Each key can do only its one job on chain.",
  component: component_backend,
  system: "capxul service keys",
  service: "ServiceSigner",
  calls: {
    send: {
      about: "Prepares (nonce, fees, simulation, gas), signs with the named key and broadcasts one transaction; returns its hash.",
      timeoutMs: 10_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 1_500,
      failures: [
        { when: "The nodes did not answer: the signed bytes are kept and looked up, never re-signed", error: error_PROVIDER_ERROR },
        { when: "The simulation reverted: the chain would refuse the transaction as it stands", error: error_TRANSACTION_FAILED },
      ],
    },
    waitForReceipt: {
      about: "Polls the receipt once a second until it is mined or 60 s pass; a failed poll does not end the wait (old R7).",
      timeoutMs: 60_000,
      retries: { max: 3, backoff: "fixed" },
      p95Ms: 4_000,
      failures: [
        { when: "No receipt by the deadline: the transaction may still land, so the caller looks it up later", error: error_PROVIDER_ERROR },
        { when: "The transaction reverted", error: error_TRANSACTION_FAILED },
      ],
    },
  },
  fake: "Anvil with fixed devnet keys, funded at boot; Companies House's devnet tier is the stand-in Companies House.",
  secrets: ["COMPANIES_HOUSE_CLAIM_KEY", "COMPANIES_HOUSE_TIER_KEY", "BUDGETS_EXECUTOR_KEY", "ESCROW_RELAYER_KEY", "FAUCET_KEY"],
  was: ["packages/backend/src/payments/schedules/external/budget-executor.ts:74", `${OLD}/chain-rpc/internal/transactions.ts:58`],
});

// ── devnet-control ──────────────────────────────────────────────────────────────────────────

const CONTROL = { retries: { max: 0, backoff: "none" } } as const;
const controlFailures = [
  {
    when: "This machine runs no devnet: there is no control handoff (the supervisor's address and token), or it is not this user's",
    error: error_WRONG_ENVIRONMENT,
  },
  { when: "The supervisor did not answer in time", error: error_PROVIDER_ERROR },
] as const;
/** A barrier that could not settle: the clock stays at the last stop that did (decision devnet.warp-barrier). */
const unsettled = {
  when: "At a stop the devnet did not settle in time: a follower stayed busy or did not acknowledge. The clock stays at the last stop that settled, and the refusal names the stop and the followers",
  error: error_WORK_DIED,
} as const;
/** One move of the clock runs at a time (decision devnet.warp-barrier); reads and watches always answer. */
const busy = {
  when: "Another move of the clock (a warp, step, settle, start-at, freeze or resume) is running; the refusal names it",
  error: error_WRONG_STATE,
} as const;
/** A clock call is local and immediate: one read or one state change of the time authority. */
const CLOCK_CALL = { timeoutMs: 2_000, ...CONTROL, p95Ms: 100 } as const;
/** A barrier call waits for every follower to settle at every stop, so a month takes seconds and a year minutes; a
 * caller's ten-minute patience bounds one call, so a long story is driven in steps or day-sized warps. */
const BARRIER = { timeoutMs: 600_000, ...CONTROL } as const;

export const integration_devnet_control = defineIntegration({
  id: "devnet-control",
  title: "The devnet supervisor's control protocol: the clock and the worlds",
  about:
    "The devnet supervisor's public control protocol, `capxul.devnet/1`: HTTP JSON on loopback, with the bearer token " +
    "the supervisor writes to an owner-only handoff file, and the same requests on its owner-only Unix socket without " +
    "one. Its time part is the one clock's interface for people building on Capxul (decision devnet.time-protocol): read " +
    "now, start the story at a date, warp, step, settle, freeze and resume, watch the clock's events and follow it as a " +
    "follower the barrier waits for. Its world part saves, lists and restores named worlds (the chain, Postgres and " +
    "Ponder together, with the clock). The Core SDK's Node-only devnet entry is its typed client, behind the Effect " +
    "service `DevnetControl`; the CLI's `dev time` and `dev snapshot` commands and the supervisor's own `capxul-devnet " +
    "time` commands are thin clients of it, and an outside program may speak the HTTP directly. Only devnet records use it.",
  component: component_core_sdk,
  system: "capxul-devnet supervisor",
  service: "DevnetControl",
  calls: {
    snapshotSave: {
      about: "Saves the whole world under a name, with its clock and the backend code it was saved with; `replace` replaces a world of that name.",
      timeoutMs: 60_000,
      ...CONTROL,
      p95Ms: 10_000,
      failures: [
        ...controlFailures,
        { when: "A world has that name and `replace` was not asked", error: error_WRONG_STATE },
        { when: "The name is not lowercase letters, digits and hyphens, up to 40 characters", error: error_INVALID_INPUT },
      ],
    },
    snapshotRestore: {
      about: "Restores a named world, its clock frozen at the world's now during the restore, then in the mode it was saved in.",
      timeoutMs: 60_000,
      ...CONTROL,
      p95Ms: 10_000,
      failures: [
        ...controlFailures,
        { when: "No world has that name; the refusal lists the worlds saved here", error: error_INVALID_INPUT },
        { when: "The world was saved with other backend code, so its data may not match it", error: error_WRONG_STATE },
      ],
    },
    snapshotList: { about: "The saved worlds, newest first.", timeoutMs: 2_000, ...CONTROL, p95Ms: 100, failures: [...controlFailures] },
    timeRead: {
      about:
        "GET /v1/time: the clock (now and its realAt, mode, version, world epoch, whether it moved), the chain head, the " +
        "backend's now, Ponder's position, each follower's acknowledged version and next due instant, and whether they agree.",
      ...CLOCK_CALL,
      failures: [...controlFailures],
    },
    timeWarp: {
      about:
        "POST /v1/time/warp: moves now forward by a span or to an instant, stopping at every due second on the way, and " +
        "returns when the chain has a block at the target and everything due by then has run and settled. A warp whose " +
        "caller goes away stops at its next settled stop.",
      ...BARRIER,
      p95Ms: 5_000,
      failures: [...controlFailures, { when: "The target is not later than now", error: error_INVALID_INPUT }, busy, unsettled],
    },
    timeStartAt: {
      about: "POST /v1/time/start-at: sets a fresh world's story at an earlier instant, mines a block there and settles.",
      timeoutMs: 30_000,
      ...CONTROL,
      p95Ms: 5_000,
      failures: [
        ...controlFailures,
        { when: "The date is not earlier than now", error: error_INVALID_INPUT },
        { when: "The clock already moved: the world is not fresh, or another move of the clock is running", error: error_WRONG_STATE },
        unsettled,
      ],
    },
    timeStep: {
      about: "POST /v1/time/step: moves now to the next instant anything is due (a timer, a cron run, a follower's next due), not past a limit, and settles.",
      ...BARRIER,
      p95Ms: 3_000,
      failures: [...controlFailures, { when: "The limit is not later than now", error: error_INVALID_INPUT }, busy, unsettled],
    },
    timeSettle: {
      about: "POST /v1/time/settle: waits until everything due at now has run and every follower is idle, without moving now.",
      ...BARRIER,
      p95Ms: 2_000,
      failures: [...controlFailures, busy, unsettled],
    },
    timeFreeze: {
      about: "POST /v1/time/freeze: holds now still, at the next whole second, until a warp, step or resume moves it.",
      ...CLOCK_CALL,
      failures: [...controlFailures, busy],
    },
    timeResume: {
      about: "POST /v1/time/resume: lets now run on from where it stands, at the real rate.",
      ...CLOCK_CALL,
      failures: [...controlFailures, busy],
    },
    timeWatch: {
      about: "GET /v1/time/events: the clock's events as server-sent events, each with its version, now and realAt, mode, world and reason.",
      ...CLOCK_CALL,
      failures: [...controlFailures],
    },
    timeFollow: {
      about:
        "POST /v1/followers, then its event stream and its acknowledgements: a follower the barrier waits for at every " +
        "stop, idle or busy, with its own next due instant, which the warp then stops at.",
      ...CLOCK_CALL,
      failures: [...controlFailures, { when: "A follower of that name is already following", error: error_WRONG_STATE }],
    },
  },
  fake: "None: it exists only on a devnet machine. Its conformance suite is the protocol's own, run against the supervisor.",
  secrets: [],
  was: ["packages/sdk/src/devnet/index.ts:5", "packages/protocol/src/devnet/control.ts:107", "packages/devnet/src/modules/guardian/standing-config.ts:20"],
});

// ── frappe-head ─────────────────────────────────────────────────────────────────────────────

/** A head call is a vendor call to one Frappe site: 2 s p95, retried only where the call is idempotent by version. */
const headUnavailable = unavailable("The Frappe head");
const headRefusedKey = {
  when: "The head answered 401 or 403: the API key the head connection holds is wrong, revoked, or its user lacks a role the Capxul app needs",
  error: error_ROLE_PERMISSION_DENIED,
} as const;
const headThrottled = { when: "The head answered 429 and the retries ran out", error: error_RATE_LIMITED } as const;
const headUnusable = unusable("The Frappe head");

export const integration_frappe_head = defineIntegration({
  id: "frappe-head",
  title: "A connected Frappe head: the Organization's Frappe site and its host",
  about:
    "An Organization's Frappe site (the head, aaron.frappe-head), reached over HTTPS with the API key and secret its head " +
    "connection holds under record-bound encryption, behind the Effect service `FrappeHead`. Capxul always calls; the head " +
    "only rings Capxul's doorbell, with no data. Every call goes to the Capxul app for Frappe's whitelisted methods (component frappe-app), so " +
    "Capxul depends on one versioned contract, not on ERPNext's internals. Each concept that holds a fundamental app's " +
    "records syncs them itself: it pushes its changes in its own change order and pulls the head's, by the rules of " +
    "organizations.head-ownership. Dates cross in the Organization's time zone, which the head's System Settings must " +
    "share; instants cross as UTC. Nothing that moves money goes through the head: a head asks for money only through " +
    "Capxul's commands. Installing an app is the head's host's: Frappe Cloud's site API when the head is hosted there, " +
    "with the Frappe Cloud team's own API token (a site's key cannot install apps), which the connection seals beside " +
    "the site's key.",
  component: component_backend,
  system: "frappe",
  service: "FrappeHead",
  calls: {
    readSite: {
      about:
        "The site as it stands: Frappe's version, the installed apps and their versions, the System Settings time zone, the " +
        "Capxul app's version and its Custom Fields, and the Company carrying the Organization's id, with its currency.",
      timeoutMs: 5_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [
        headUnavailable,
        headRefusedKey,
        { when: "The site has no Capxul app, or one older than the contract Capxul speaks (its method is missing)", error: error_WRONG_STATE },
        headThrottled,
        headUnusable,
      ],
    },
    upsertDocs: {
      about:
        "Writes documents in change order by `capxul_id` (insert, update, submit, cancel, amend), each with its version and " +
        "the last head change Capxul read, over which it writes; answers written, unchanged, conflict (a newer head change " +
        "Capxul has not read) or refused, with its head name.",
      timeoutMs: 15_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 3_000,
      failures: [headUnavailable, headRefusedKey, headThrottled, headUnusable],
    },
    listChanges: {
      about:
        "The head's own changes to the synced DocTypes after a change id, oldest first: DocType, head name, `capxul_id` (null " +
        "for a document born in the head), the version it was based on, its fields, docstatus, the head user and its time.",
      timeoutMs: 10_000,
      retries: { max: 2, backoff: "exponential" },
      p95Ms: 2_000,
      failures: [headUnavailable, headRefusedKey, headThrottled, headUnusable],
    },
    installApp: {
      about:
        "Asks the head's host to install an app the site's bench group has (Frappe Cloud's site API, with the team's " +
        "token); answers when the job is queued. The app appears in readSite once it is installed.",
      timeoutMs: 10_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 2_000,
      failures: [
        headUnavailable,
        headRefusedKey,
        { when: "The head's host cannot install apps for Capxul (a self-hosted bench): its owner runs `bench install-app` instead", error: error_WRONG_STATE },
        {
          when: "The host knows no such app, or not for the site's Frappe version, or the site's bench group lacks it (its owner adds it there first)",
          error: error_INVALID_INPUT,
        },
        headUnusable,
      ],
    },
  },
  fake:
    "The devnet's stand-in head (devnet.head-stand-in): the supervisor serves it on loopback, speaking the Capxul app's " +
    "methods, and keeps its state in devnet's tables: sites (`head-sites`), documents by DocType and `capxul_id` " +
    "(`head-documents`) and its scripted edits as listChanges rows that ring `organizations.heads.ring` " +
    "(`head-changes`). It installs any app at once, follows the one clock as a follower, and has a fault switch (down, " +
    "key refused, conflict on the next write, refuse the next document, replay, clear). It runs none of Frappe's validations, reports or " +
    "scheduled jobs. A head eval that needs real Frappe boots a bench with ERPNext, Frappe HR, Frappe CRM and the Capxul " +
    "app instead, also as a follower.",
  secrets: [],
  was: ["docs/vision/erp.md (sections 1, 5 and 7)"],
});

// ── contracts: Capxul's Protocol v4 ─────────────────────────────────────────────────────────

const DEV = "devnet" as const;
const PAYMENT_ITEM =
  "(bytes32 paymentId, address recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash, bytes32 jobNonce, address executor)";

export const contract_companies_house_claimer = defineContract({
  id: "companies-house-claimer",
  title: "CompaniesHouseClaimer: a person's Safe claimed",
  about:
    "One shared, stateless contract. Companies House's claim role calls `claim` through Roles to deploy (if needed) a " +
    "person's email-derived Safe and swap its signer in; `safeAddressFor` is the pure address function the whole system " +
    "uses for a person's Safe.",
  addresses: { [DEV]: "0xd8e60BeB4C15a31E804D76878941ce569D0bCcA8" },
  functions: {
    claim: { signature: "claim(string namespace, string email, address signer) returns (address safe)", about: "Deploys and claims a person's Safe for their signer." },
    safeAddressFor: { signature: "safeAddressFor(address owner, string namespace, string email) pure returns (address)", about: "A person's Safe address from their email." },
  },
  events: {
    CapxulSafeClaimed: { signature: "CapxulSafeClaimed(address indexed safe, address indexed signer, bool deployed)", about: "A person's Safe is live with their signer: setup done, referral credit earned." },
  },
  was: [`${V4}/interfaces/ICompaniesHouseClaimer.sol:17`, `${ADDR}:44`],
});

export const contract_company_safe_minter = defineContract({
  id: "company-safe-minter",
  title: "CompanySafeMinter: a company Safe minted",
  about: "Companies House's company-Safe role mints an Organization's Safe, owned by the founder's personal Safe, at a predictable address.",
  addresses: { [DEV]: "0xCB2658277FD101424aa82344B7B4a473F6D01831" },
  functions: {
    mint: { signature: "mint(string namespace, string company, address founderSafe) returns (address safe)", about: "Mints the company Safe." },
    companySafeAddressFor: {
      signature: "companySafeAddressFor(address owner, string namespace, string company, address founderSafe) pure returns (address)",
      about: "The company Safe's address before it exists, for the Organization's Party at birth.",
    },
  },
  events: {
    CompanySafeMinted: { signature: "CompanySafeMinted(address indexed safe, address indexed founderSafe, string company, bool deployed)", about: "The company Safe exists." },
  },
  was: [`${V4}/companies-house/CompanySafeMinter.sol:59`, `${ADDR}:45`],
});

export const contract_installer = defineContract({
  id: "installer",
  title: "Installer: an Organization's hats, Roles and Gate",
  about:
    "One shared contract. `deployMoney` (anyone, sent by the tier key) deploys a company's hat trees, Roles and Signer Gate; " +
    "`buildMoney`, `buildAddToken`, `buildSetCeiling` and `buildEquity` return the batches the company Safe signs. It never " +
    "holds funds or authority after.",
  addresses: { [DEV]: "0xec0cB53F65B0F0BE3fD11ACB9B6005F6c9203E2F" },
  functions: {
    deployMoney: { signature: "deployMoney(MoneyDeploy p) returns (MoneyDeployment d)", about: "Deploys hats (Board, Director, officers), Roles and the Gate." },
    buildMoney: { signature: "buildMoney(MoneyInstall p) view returns (Call[] calls)", about: "The install batch the founder approves." },
    buildAddToken: { signature: "buildAddToken(AddToken p) view returns (Call[] calls)", about: "The batch that budgets a new token." },
    buildSetCeiling: { signature: "buildSetCeiling(SetCeiling p) view returns (Call[] calls)", about: "The batch that sets, freezes or unfreezes a payout ceiling." },
    deployEquity: { signature: "deployEquity(EquityDeploy p) returns (EquityDeployment d)", about: "Deploys the equity clones (low priority)." },
    buildEquity: { signature: "buildEquity(EquityInstall p) view returns (Call[] safeCalls, Call[] founderCalls)", about: "The equity install batches." },
    deployElections: {
      signature: "deployElections(ElectionsDeploy p) returns (address elections)",
      about: "Creates a seat group's Hats Elections clone at its predicted address, with its first term (anyone may send it).",
    },
    buildElections: {
      signature: "buildElections(ElectionsInstall p) view returns (Call[] governorCalls)",
      about: "The Governor's batch that attaches Elections to the Director hat: elect, eligibility, unseat the unelected, seats, mint, threshold.",
    },
  },
  events: {
    MoneyDeployed: { signature: "MoneyDeployed(address indexed safe, address indexed founderSafe, MoneyDeployment deployment)", about: "An Organization's deployment: its hat ids, Roles and Gate." },
    EquityDeployed: { signature: "EquityDeployed(address indexed safe, EquityDeployment deployment)", about: "The equity clones of a company." },
    ElectionsDeployed: {
      signature: "ElectionsDeployed(address indexed safe, address elections, uint256 directorHat, uint128 firstTermEnd)",
      about: "A seat group's Elections clone exists, with its first term.",
    },
  },
  was: [`${V4}/interfaces/IInstaller.sol:222`, `${V4}/interfaces/IInstaller.sol:288`, `${ADDR}:57`],
});

export const contract_payments = defineContract({
  id: "payments",
  title: "Payments: the one way money leaves",
  about:
    "One shared contract: an exact transfer of one token amount from the caller to a fixed recipient, identified by a hash " +
    "of every term, consumed once, stamped with a kind and a document hash. Every movement of money in v4 ends in a " +
    "`PaymentSent`, which is what settles a Payment.",
  addresses: { [DEV]: "0xe9cCC7E3b3cbf670ca0a23f338f10b266A2d9301" },
  functions: {
    send: { signature: `send(${PAYMENT_ITEM} item)`, about: "One exact payment from the calling Safe." },
    sendBatch: { signature: `sendBatch(${PAYMENT_ITEM}[] items)`, about: "Several payments, atomically." },
    paymentId: { signature: `paymentId(${PAYMENT_ITEM} item) view returns (bytes32)`, about: "The id of an item, known before it is signed." },
    paid: { signature: "paid(bytes32 id) view returns (bool)", about: "Whether a payment id has been consumed." },
  },
  events: {
    PaymentSent: {
      signature:
        "PaymentSent(bytes32 indexed paymentId, address indexed sender, address indexed recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash)",
      about: "A payment was made: the fact a Payment settles from, or is born from when Capxul did not prepare it.",
    },
  },
  was: [`${V4}/interfaces/IPayments.sol:23`, `${ADDR}:46`],
});

export const contract_budgets = defineContract({
  id: "budgets",
  title: "Budgets: money authority under hats",
  about:
    "One shared contract keyed by company Safe: a tree of budgets per token and period, each naming a hat; a wearer of the " +
    "hat or of any hat above may spend, schedule or open a child; Budgets pays from the company Safe through its Roles " +
    "payout role and Payments. Anyone may `execute` a scheduled payment at or after its date.",
  addresses: { [DEV]: "0xC8670A227f9b8621aDA65E1746fA135271e62d9f" },
  functions: {
    createTopBudget: { signature: "createTopBudget(address token, uint8 period, uint128 amount, uint256 hat) returns (uint256 id)", about: "A top budget, by the Board." },
    createChildBudget: { signature: "createChildBudget(uint256 parent, uint128 amount, uint256 hat) returns (uint256 id)", about: "A department, team or allowance." },
    setAmount: { signature: "setAmount(uint256 id, uint128 amount)", about: "A budget's amount per period." },
    setHat: { signature: "setHat(uint256 id, uint256 hat)", about: "A budget's office hat." },
    close: { signature: "close(uint256 id)", about: "Closes a budget." },
    reopen: { signature: "reopen(uint256 id)", about: "Reopens a closed budget." },
    spend: {
      signature: "spend(uint256 id, address recipient, uint128 amount, uint16 kind, bytes32 documentHash, bytes32 jobNonce) returns (bytes32 paymentId)",
      about: "Pays now from a budget.",
    },
    schedule: {
      signature: "schedule(uint256 id, address to, uint128 amount, uint16 kind, uint64 payAt, bytes32 documentHash, bytes32 jobNonce) returns (uint256 scheduledId)",
      about: "Reserves a dated payment.",
    },
    cancel: { signature: "cancel(uint256 scheduledId)", about: "Releases a dated payment before it is paid." },
    execute: { signature: "execute(uint256 scheduledId) returns (bytes32 paymentId)", about: "Pays a due dated payment; sent by the executor key." },
    leftOf: { signature: "leftOf(uint256 id) view returns (uint128)", about: "What a budget has left this period, read before a spend is built." },
    budgetOf: { signature: "budgetOf(uint256 id) view returns (Budget)", about: "A budget's token, period, amount, hat and parent." },
    childrenOf: { signature: "childrenOf(uint256 id) view returns (uint256[])", about: "A budget's children, for `org department show`." },
    authorised: { signature: "authorised(uint256 id, address who) view returns (bool)", about: "Whether a Safe may act on a budget." },
    scheduledOf: { signature: "scheduledOf(uint256 id) view returns (Scheduled)", about: "A dated payment's state and date." },
  },
  events: {
    BudgetCreated: {
      signature: "BudgetCreated(address indexed safe, uint256 indexed id, uint256 indexed parent, address token, uint8 period, uint128 amount, uint256 hat)",
      about: "A budget exists.",
    },
    BudgetAmountSet: { signature: "BudgetAmountSet(address indexed safe, uint256 indexed id, uint128 amount)", about: "A budget's amount changed." },
    BudgetHatSet: { signature: "BudgetHatSet(address indexed safe, uint256 indexed id, uint256 hat)", about: "A budget's office hat changed." },
    BudgetClosed: { signature: "BudgetClosed(address indexed safe, uint256 indexed id)", about: "A budget closed." },
    BudgetReopened: { signature: "BudgetReopened(address indexed safe, uint256 indexed id)", about: "A budget reopened." },
    Spent: {
      signature: "Spent(address indexed safe, uint256 indexed id, address indexed recipient, uint128 amount, uint16 kind, bytes32 documentHash, bytes32 paymentId)",
      about: "A budget spend, beside its PaymentSent.",
    },
    PaymentScheduled: {
      signature:
        "PaymentScheduled(address indexed safe, uint256 indexed budgetId, uint256 indexed scheduledId, address to, uint128 amount, uint16 kind, uint64 payAt, bytes32 documentHash, bytes32 jobNonce)",
      about: "A dated payment reserved.",
    },
    ScheduleCancelled: { signature: "ScheduleCancelled(address indexed safe, uint256 indexed budgetId, uint256 indexed scheduledId)", about: "A dated payment released." },
    ScheduledPaid: { signature: "ScheduledPaid(address indexed safe, uint256 indexed budgetId, uint256 indexed scheduledId, bytes32 paymentId)", about: "A dated payment paid." },
    Committed: { signature: "Committed(address indexed safe, uint256 indexed id, uint128 amount)", about: "Budget reserved for an agreement." },
    Released: { signature: "Released(address indexed safe, uint256 indexed id, uint128 amount)", about: "A reservation released." },
  },
  was: [`${V4}/interfaces/IBudgets.sol:56`, `${ADDR}:47`],
});

export const contract_agreements = defineContract({
  id: "agreements",
  title: "Agreements: pay agreements from a budget",
  about:
    "One shared contract keyed by company Safe: an office holder offers a salary, stream or retainer from a budget (which " +
    "reserves it in Budgets), the payee accepts at the exact terms, and collects what is released (paid through " +
    "`Budgets.payReserved`, kind 4).",
  addresses: { [DEV]: "0x9122a17335e8aa9f1d3661a04458b963bb39302C" },
  functions: {
    offer: {
      signature:
        "offer(uint256 budgetId, address payee, uint128 rate, uint8 period, uint64 startsAt, uint64 endsAt, uint64 step, uint64 offerExpiresAt, bytes32 documentHash) returns (uint256 id)",
      about: "Offers an agreement and reserves its figure.",
    },
    withdrawOffer: { signature: "withdrawOffer(uint256 id)", about: "Withdraws an unaccepted offer." },
    changeRate: { signature: "changeRate(uint256 id, uint128 newRate, uint64 effectiveAt)", about: "Changes the rate from a date." },
    cancelChange: { signature: "cancelChange(uint256 id)", about: "Cancels a pending rate change." },
    pause: { signature: "pause(uint256 id)", about: "Pauses releases." },
    resume: { signature: "resume(uint256 id)", about: "Resumes releases." },
    end: { signature: "end(uint256 id, uint64 endsAt)", about: "Ends an agreement at a date." },
    accept: { signature: "accept(uint256 id, bytes32 termsHash)", about: "The payee accepts the exact terms." },
    collect: { signature: "collect(uint256 id, uint128 amount)", about: "The payee collects what is released." },
    agreementOf: { signature: "agreementOf(uint256 id) view returns (Agreement)", about: "An agreement's terms and state." },
    availableOf: { signature: "availableOf(uint256 id) view returns (uint128)", about: "What the payee can collect now." },
  },
  events: {
    AgreementOffered: {
      signature:
        "AgreementOffered(address indexed safe, uint256 indexed budgetId, uint256 indexed id, address token, address payee, uint128 rate, uint8 period, uint64 startsAt, uint64 step, uint64 offerExpiresAt, bytes32 documentHash)",
      about: "An offer is on chain.",
    },
    AgreementAccepted: { signature: "AgreementAccepted(address indexed safe, uint256 indexed id, address indexed payee, uint64 startsAt)", about: "Accepted." },
    OfferWithdrawn: { signature: "OfferWithdrawn(address indexed safe, uint256 indexed id)", about: "Withdrawn." },
    RateChanged: { signature: "RateChanged(address indexed safe, uint256 indexed id, uint128 rate, uint64 effectiveAt)", about: "A rate change." },
    RateChangeCancelled: { signature: "RateChangeCancelled(address indexed safe, uint256 indexed id)", about: "A rate change cancelled." },
    AgreementPaused: { signature: "AgreementPaused(address indexed safe, uint256 indexed id)", about: "Paused." },
    AgreementResumed: { signature: "AgreementResumed(address indexed safe, uint256 indexed id)", about: "Resumed." },
    AgreementEnded: { signature: "AgreementEnded(address indexed safe, uint256 indexed id, uint64 endsAt)", about: "Ended." },
    Collected: {
      signature: "Collected(address indexed safe, uint256 indexed id, address indexed payee, address token, uint128 amount, bytes32 paymentId)",
      about: "A collection, beside its PaymentSent.",
    },
  },
  was: [`${V4}/interfaces/IAgreements.sol:37`, `${ADDR}:48`],
});

export const contract_escrow_factory = defineContract({
  id: "escrow-factory",
  title: "EscrowFactory: escrows at predictable addresses",
  about:
    "Deploys each escrow at a CREATE2 address known before it exists, so a payer can fund it first: an invoice escrow for " +
    "checkout, a claim escrow for an email with no account yet. The address binds every term (owner, payee, token, amount, " +
    "job nonce, kind, document, condition) and the chain's Payments and Companies House, so another deploy at it can only " +
    "be the same escrow; `deploy` is idempotent and anyone may send it.",
  addresses: { [DEV]: "0x012aD00897a439A966Aa1396144b71E2f669082f" },
  functions: {
    deploy: { signature: "deploy(Terms terms, bytes32 salt) returns (address escrow)", about: "Deploys the escrow for its terms, or returns the one there." },
    predictAddress: { signature: "predictAddress(Terms terms, bytes32 salt) view returns (address)", about: "The escrow's address before it exists." },
    predictPaymentId: { signature: "predictPaymentId(Terms terms, bytes32 salt) view returns (bytes32)", about: "The payment id its payout will carry." },
  },
  events: {
    EscrowDeployed: { signature: "EscrowDeployed(address indexed escrow, address indexed ownerSafe, address indexed payeeSafe, bytes32 paymentId, bytes32 salt)", about: "An escrow exists." },
  },
  was: [`${V4}/interfaces/IEscrowFactory.sol:11`, `${ADDR}:49`],
});

export const contract_escrow = defineContract({
  id: "escrow",
  title: "Escrow: one escrow's money",
  about:
    "One contract per escrow, deployed by EscrowFactory, so it has no fixed address; its terms are immutable. It pays its " +
    "payee through Payments when its condition is met (the invoice amount reached, or the payee's Safe claimed), and " +
    "refunds its owner otherwise. A claim escrow's payee is bound at send time to a predicted address: the personal Safe " +
    "CompaniesHouseClaimer derives from the payee's email, which Companies House owns until the person claims it. Only " +
    "that Safe can `collect`, and only once Companies House is no longer one of its owners (D11, failing closed); only " +
    "the owner can `refund`, and only to itself, at any time until the payee collects, even after the claim (D12); " +
    "`payout` is refused for it. It has no expiry: it holds the money until one of the two happens (decision " +
    "payments.claim-escrow-fit).",
  functions: {
    payout: { signature: "payout()", about: "Pays an invoice escrow's payee once it holds the amount; anyone may call it. A claim escrow refuses it." },
    collect: { signature: "collect()", about: "The payee's Safe collects a claim escrow, once the Safe is claimed and the escrow holds the amount; no one else can." },
    refund: {
      signature: "refund()",
      about:
        "The owner takes the escrow's balance back to itself: an invoice escrow while short of the amount, a claim escrow at " +
        "any time until it is collected; once paid or refunded it only returns a later deposit to the owner.",
    },
    state: { signature: "state() view returns (State)", about: "Open, paid or refunded." },
  },
  events: {
    EscrowCreated: {
      signature: "EscrowCreated(address indexed ownerSafe, address indexed payeeSafe, bytes32 indexed paymentId, address token, uint256 amount, uint16 kind, bytes32 documentHash, uint8 condition)",
      about: "An escrow's terms.",
    },
    EscrowPaid: { signature: "EscrowPaid(address indexed ownerSafe, address indexed payeeSafe, bytes32 indexed paymentId, uint256 amount)", about: "Paid out." },
    EscrowRefunded: { signature: "EscrowRefunded(address indexed ownerSafe, bytes32 indexed paymentId, uint256 amount, State state)", about: "Refunded." },
  },
  was: [`${V4}/interfaces/IEscrow.sol:30`],
});

export const contract_agent_owner = defineContract({
  id: "agent-owner",
  title: "AgentOwner: an agent's Safe under its owner",
  about:
    "One shared module and guard: deploys an agent's Safe with the agent's key as its one signer and the owner's Safe in " +
    "control, so the owner can freeze it, swap its key, sweep it and remove it, and the agent's key can never switch that off.",
  addresses: { [DEV]: "0x6C4d321fB1Bc33BcE283a255a8fA20d0fFEfd8bE" },
  functions: {
    create: { signature: "create(address signer, address owner) returns (address safe)", about: "Deploys the agent's Safe." },
    freeze: { signature: "freeze(address safe)", about: "Freezes the agent." },
    unfreeze: { signature: "unfreeze(address safe)", about: "Unfreezes it." },
    swapSigner: { signature: "swapSigner(address safe, address oldSigner, address newSigner)", about: "Rotates the agent's key." },
    sweep: { signature: "sweep(address safe, address to, address token) returns (uint256 amount)", about: "Takes back what the agent holds (kind 9)." },
    remove: { signature: "remove(address safe, address[] tokens)", about: "Sweeps and removes the agent." },
    agentOf: { signature: "agentOf(address safe) view returns (Agent)", about: "An agent's owner, signer and frozen flag: the proof an agent's sign-in checks." },
    safeAddressFor: { signature: "safeAddressFor(address signer, address owner) view returns (address)", about: "The agent's Safe before it exists." },
  },
  events: {
    AgentCreated: { signature: "AgentCreated(address indexed safe, address indexed owner, address indexed signer)", about: "An agent exists." },
    AgentFrozen: { signature: "AgentFrozen(address indexed safe)", about: "Frozen." },
    AgentUnfrozen: { signature: "AgentUnfrozen(address indexed safe)", about: "Unfrozen." },
    AgentSignerSwapped: { signature: "AgentSignerSwapped(address indexed safe, address oldSigner, address newSigner)", about: "Key rotated." },
    AgentSwept: { signature: "AgentSwept(address indexed safe, address indexed to, address indexed token, uint256 amount)", about: "Swept." },
    AgentRemoved: { signature: "AgentRemoved(address indexed safe)", about: "Removed." },
  },
  was: [`${V4}/agents/AgentOwner.sol:123`, `${ADDR}:58`],
});

// ── contracts: equity (low priority) ────────────────────────────────────────────────────────

export const contract_captable = defineContract({
  id: "captable",
  title: "Captable: share classes and issues",
  about: "One clone per company: share classes, their authorised amounts, issues, conversions and transfer consent. The address is the implementation.",
  addresses: { [DEV]: "0xC0e3Ac47f0e59AD627ED36F9146D6F366e47eeC1" },
  functions: {
    createClass: { signature: "createClass(ClassParams p) returns (uint8 classId)", about: "A new share class." },
    setAuthorised: { signature: "setAuthorised(uint8 classId, uint128 amount)", about: "A class's authorised amount." },
    issue: { signature: "issue(uint8 classId, address to, uint128 amount, bytes32 reason)", about: "Issues shares." },
    convert: { signature: "convert(uint8 classId, uint128 amount)", about: "A shareholder converts shares." },
    consentToTransfer: { signature: "consentToTransfer(uint8 classId, address to, uint128 amount, bytes32 reason)", about: "Consents to a transfer." },
    setIssuerAllowance: { signature: "setIssuerAllowance(address module, uint8 classId, uint128 amount)", about: "Lets Rounds or Options issue up to an amount of a class (Board)." },
    getClass: { signature: "getClass(uint8 classId) view returns (Class)", about: "A class's token, weight and terms, for the cap table." },
    setTransferRule: { signature: "setTransferRule(uint8 classId, TransferRule rule, address customRule)", about: "A class's transfer rule (the company Governor: `transfer-rule` vote)." },
    freeze: { signature: "freeze(uint8 classId)", about: "Freezes a class's terms for good (the company Governor: `freeze-class` vote)." },
    convertibleReserved: { signature: "convertibleReserved(uint8 classId) view returns (uint256)", about: "Shares of a class reserved for conversions, for an issue's headroom." },
    closedForExit: { signature: "closedForExit() view returns (bool)", about: "Whether the company was sold and the Captable closed." },
  },
  events: {
    ClassCreated: { signature: "ClassCreated(uint8 indexed classId, address indexed token, ClassParams params)", about: "A class exists." },
    Issued: { signature: "Issued(uint8 indexed classId, address indexed to, uint128 amount, bytes32 reason)", about: "Shares issued." },
    Converted: {
      signature: "Converted(address indexed shareholder, uint8 indexed fromClassId, uint8 indexed toClassId, uint128 amount, uint128 minted)",
      about: "Shares converted.",
    },
  },
  was: [`${V4}/interfaces/ICaptable.sol:77`, `${ADDR}:51`],
});

export const contract_share_class = defineContract({
  id: "share-class",
  title: "ShareClass: one class's shares and votes",
  about: "One ERC20Votes clone per class. The address is the implementation.",
  addresses: { [DEV]: "0x620703c74ea59fdAcc275363cdab122930bE4022" },
  functions: {
    delegate: { signature: "delegate(address delegatee)", about: "Delegates a shareholder's votes." },
    balanceOf: { signature: "balanceOf(address account) view returns (uint256)", about: "A shareholder's shares." },
  },
  events: {
    Transfer: { signature: "Transfer(address indexed from, address indexed to, uint256 value)", about: "Shares moved." },
    DelegateChanged: { signature: "DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate)", about: "Votes delegated." },
  },
  was: [`${V4}/interfaces/IShareClass.sol:25`, `${ADDR}:52`],
});

export const contract_vesting = defineContract({
  id: "vesting",
  title: "Vesting: share grants",
  about: "One shared contract: vesting grants offered, accepted, revoked and released.",
  addresses: { [DEV]: "0x5E032cc2B9757585B15cC029ACEC5AE46fF5Ec1a" },
  functions: {
    offerGrant: {
      signature:
        "offerGrant(address captable, uint8 classId, address shareholder, uint128 amount, uint64 start, uint64 cliff, uint64 end, uint64 offerExpiresAt, bool accelerateOnExit, bytes32 documentHash) returns (uint256 id)",
      about: "Offers a vesting grant.",
    },
    acceptGrant: { signature: "acceptGrant(uint256 id, bytes32 termsHash)", about: "Accepts it." },
    revoke: { signature: "revoke(uint256 id, uint64 effectiveAt)", about: "Revokes it." },
    grantAndIssue: {
      signature:
        "grantAndIssue(address captable, uint8 classId, address shareholder, uint128 amount, uint64 start, uint64 cliff, uint64 end, bool accelerateOnExit, bytes32 documentHash) returns (uint256 id)",
      about: "Issues a founder's shares under vesting at the equity install.",
    },
    settleRevocation: { signature: "settleRevocation(uint256 id)", about: "Returns the unvested shares of a revoked grant." },
    lockedOf: { signature: "lockedOf(address captable, uint8 classId, address account, uint64 t) view returns (uint128)", about: "A holder's unvested shares at a time, for `shares`." },
  },
  events: {
    GrantOffered: { signature: "GrantOffered(address indexed safe, uint256 indexed id, address indexed shareholder, Grant grant)", about: "Offered." },
    GrantAccepted: { signature: "GrantAccepted(address indexed safe, uint256 indexed id)", about: "Accepted." },
    Granted: {
      signature: "Granted(address indexed safe, uint256 indexed id, address indexed shareholder, Grant grant)",
      about: "A live grant made with its shares issued in the same call (a founder's vesting at the install).",
    },
    Revoked: { signature: "Revoked(address indexed safe, uint256 indexed id, uint64 effectiveAt)", about: "A grant revoked, effective at a time." },
  },
  was: [`${V4}/interfaces/IVesting.sol:30`, `${ADDR}:50`],
});

export const contract_options = defineContract({
  id: "options",
  title: "Options: option grants and exercises",
  about: "One clone per company: the option pool, grants, acceptance, exercise (the strike paid through Payments, kind 7) and ends. The address is the implementation.",
  addresses: { [DEV]: "0x48C9BF7b1993e1E4Dc0FEE06a402B2193428A0bA" },
  functions: {
    grant: {
      signature:
        "grant(address grantee, uint128 shares, address strikeToken, uint128 strikePrice, uint64 start, uint64 cliff, uint64 end, uint64 offerExpiresAt, uint64 expiresAt, uint32 exerciseWindowDays, bytes32 documentHash) returns (uint256 id)",
      about: "Grants options.",
    },
    accept: { signature: "accept(uint256 id, bytes32 termsHash)", about: "The grantee accepts." },
    exercise: { signature: "exercise(uint256 id, uint128 shares)", about: "The grantee exercises." },
    end: { signature: "end(uint256 id, uint64 endedAt)", about: "Ends a grant." },
    setPool: { signature: "setPool(uint128 amount)", about: "Sets the option pool (Board)." },
    pool: { signature: "pool() view returns (uint128)", about: "The option pool, for the cap table." },
    allocated: { signature: "allocated() view returns (uint128)", about: "The pool already granted." },
    vestedOf: { signature: "vestedOf(uint256 id, uint64 t) view returns (uint128)", about: "A grant's vested options at a time, for show, accept and exercise." },
  },
  events: {
    OptionsGranted: { signature: "OptionsGranted(uint256 indexed id, address indexed grantee, OptionGrant grant)", about: "Granted." },
    OptionsAccepted: { signature: "OptionsAccepted(uint256 indexed id, address indexed grantee)", about: "The grantee accepted the grant's terms." },
    Exercised: { signature: "Exercised(uint256 indexed id, uint128 shares, uint256 paid, bytes32 paymentId)", about: "Exercised." },
    OptionsEnded: { signature: "OptionsEnded(uint256 indexed id, uint64 endedAt, uint128 returned)", about: "Ended." },
  },
  was: [`${V4}/interfaces/IOptions.sol:35`, `${ADDR}:53`],
});

export const contract_rounds = defineContract({
  id: "rounds",
  title: "Rounds: priced rounds and SAFEs",
  about: "One clone per company: SAFE rounds and priced rounds, invitations, commitments, allocations, payments (kinds 5 and 6) and closes. The address is the implementation.",
  addresses: { [DEV]: "0xBADe818Cc6527e27Ad073cE7f82429ceC0605e02" },
  functions: {
    createSafeRound: {
      signature: "createSafeRound(address token, uint128 valuationCap, uint16 discountBps, uint64 closesAt, bytes32 documentHash) returns (uint256 roundId)",
      about: "A SAFE round.",
    },
    inviteSafe: { signature: "inviteSafe(uint256 roundId, address investor, uint128 maxAmount)", about: "Invites a SAFE investor." },
    signSafe: { signature: "signSafe(uint256 roundId, uint128 amount, bytes32 documentHash) returns (uint256 noteId)", about: "An investor signs and pays a SAFE." },
    closeSafeRound: { signature: "closeSafeRound(uint256 roundId)", about: "Closes a SAFE round." },
    createPricedRound: {
      signature: "createPricedRound(uint8 classId, address token, uint128 price, uint128 maxShares, uint64 payBy, bytes32 documentHash) returns (uint256 roundId)",
      about: "A priced round.",
    },
    invite: { signature: "invite(uint256 roundId, address investor, uint128 maxAmount)", about: "Invites an investor." },
    commit: { signature: "commit(uint256 roundId, uint128 amount, bytes32 documentHash)", about: "An investor commits." },
    allocate: { signature: "allocate(uint256 roundId, address investor, uint128 shares)", about: "Allocates shares." },
    pay: { signature: "pay(uint256 roundId) returns (bytes32 paymentId)", about: "An investor pays." },
    close: { signature: "close(uint256 roundId, uint256 deemedOutstandingA)", about: "Closes a priced round." },
    cancel: { signature: "cancel(uint256 roundId)", about: "Cancels a round." },
    convertSafes: { signature: "convertSafes(uint256[] noteIds, uint256 pricedRoundId, uint256 companyCapitalization)", about: "Converts SAFE notes into a priced round's shares (Board)." },
    safeRound: { signature: "safeRound(uint256 roundId) view returns (SafeRound)", about: "A SAFE round's terms and state." },
    safeNote: { signature: "safeNote(uint256 noteId) view returns (SafeNote)", about: "One investor's SAFE note." },
    pricedRound: { signature: "pricedRound(uint256 roundId) view returns (PricedRound)", about: "A priced round's terms and state." },
    position: { signature: "position(uint256 roundId, address investor) view returns (Position)", about: "One investor's invitation, commitment, allocation and payment." },
    consent: { signature: "consent(uint256 roundId)", about: "A class consents to a down round (its class Governor: `approve-round` vote)." },
  },
  events: {
    SafeRoundCreated: {
      signature: "SafeRoundCreated(uint256 indexed roundId, address token, uint128 valuationCap, uint16 discountBps, uint64 closesAt, bytes32 documentHash)",
      about: "A SAFE round exists.",
    },
    SafeInvited: { signature: "SafeInvited(uint256 indexed roundId, address indexed investor, uint128 maxAmount)", about: "A SAFE investor invited." },
    SafeSigned: {
      signature: "SafeSigned(uint256 indexed roundId, uint256 indexed noteId, address indexed investor, uint128 amount, bytes32 documentHash, bytes32 paymentId)",
      about: "An investor signed and paid a SAFE.",
    },
    PricedRoundCreated: {
      signature: "PricedRoundCreated(uint256 indexed roundId, uint8 indexed classId, address token, uint128 price, uint128 maxShares, uint64 payBy, bytes32 documentHash)",
      about: "A priced round exists.",
    },
    Invited: { signature: "Invited(uint256 indexed roundId, address indexed investor, uint128 maxAmount)", about: "An investor invited to a priced round." },
    Allocated: { signature: "Allocated(uint256 indexed roundId, address indexed investor, uint128 shares)", about: "Shares allocated to an investor." },
    Committed: { signature: "Committed(uint256 indexed roundId, address indexed investor, uint128 amount, bytes32 documentHash)", about: "A commitment." },
    Paid: { signature: "Paid(uint256 indexed roundId, address indexed investor, uint128 shares, uint256 amount, bytes32 paymentId)", about: "An investor paid." },
    RoundClosed: { signature: "RoundClosed(uint256 indexed roundId, Adjustment[] adjustments)", about: "Closed." },
    RoundCancelled: { signature: "RoundCancelled(uint256 indexed roundId)", about: "Cancelled." },
  },
  was: [`${V4}/interfaces/IRounds.sol:70`, `${ADDR}:54`],
});

export const contract_exits = defineContract({
  id: "exits",
  title: "Exits: sales and secondary transfers",
  about: "One clone per company: an approved sale's waterfall, its settlement and claims (kind 8), and secondary share transfers (kind 5). The address is the implementation.",
  addresses: { [DEV]: "0x3560eab3FC06C631f0309f6f1b0F2Ac3E54d22C6" },
  functions: {
    approveSale: { signature: "approveSale(uint256 saleId, address token, uint256 proceeds, bytes32 termsHash)", about: "The Board approves a sale." },
    preview: { signature: "preview(uint256 saleId, Holding[] holdings) view returns (Payout[])", about: "Who gets what." },
    settle: { signature: "settle(uint256 saleId, Holding[] holdings, uint256[] claimIndexes)", about: "Pays the sale out." },
    offerTransfer: {
      signature: "offerTransfer(uint8 classId, address buyer, uint128 shares, uint128 price, address token, bytes32 documentHash) returns (uint256 transferId)",
      about: "A shareholder offers shares to a buyer, beside the Captable's consent.",
    },
    approveTransfer: { signature: "approveTransfer(uint256 transferId)", about: "Approves a secondary transfer." },
    buy: { signature: "buy(uint256 transferId)", about: "A buyer pays for shares." },
    transfer: { signature: "transfer(uint256 transferId) view returns (Transfer)", about: "A secondary sale offer as Exits holds it." },
    sale: { signature: "sale(uint256 saleId) view returns (Sale)", about: "An approved sale: its token, proceeds and whether it settled." },
  },
  events: {
    SaleApproved: { signature: "SaleApproved(uint256 indexed saleId, address token, uint256 proceeds, bytes32 termsHash)", about: "The Board approved a sale." },
    Settled: { signature: "Settled(uint256 indexed saleId)", about: "A sale paid out." },
    TransferOffered: {
      signature:
        "TransferOffered(uint256 indexed transferId, address indexed seller, address indexed buyer, uint8 classId, uint128 shares, uint128 price, address token, bytes32 documentHash)",
      about: "A shareholder offered shares to a buyer.",
    },
    TransferApproved: { signature: "TransferApproved(uint256 indexed transferId)", about: "A secondary transfer approved." },
    Bought: { signature: "Bought(uint256 indexed transferId, uint256 amount, bytes32 paymentId)", about: "A secondary sale paid." },
  },
  was: [`${V4}/interfaces/IExits.sol:68`, `${ADDR}:55`],
});

export const contract_governor = defineContract({
  id: "governor",
  title: "Governor: shareholder votes",
  about: "One OpenZeppelin 5 Governor clone per company or class, timestamp clock, allowed targets only. The address is the implementation.",
  addresses: { [DEV]: "0x7aA1c8Df83D4F6d77DCe4799A15d9c177702c9eA" },
  functions: {
    propose: { signature: "propose(address[] targets, uint256[] values, bytes[] calldatas, string description) returns (uint256)", about: "Proposes a vote." },
    castVote: { signature: "castVote(uint256 proposalId, uint8 support) returns (uint256)", about: "Casts a vote." },
    castVoteWithReason: { signature: "castVoteWithReason(uint256 proposalId, uint8 support, string reason) returns (uint256)", about: "Casts a vote with a reason (`vote cast`)." },
    state: { signature: "state(uint256 proposalId) view returns (uint8)", about: "A vote's state: pending, active, defeated, succeeded, executed..." },
    proposalVotes: { signature: "proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)", about: "A vote's tally." },
    quorum: { signature: "quorum(uint256 timepoint) view returns (uint256)", about: "The votes a proposal needs." },
    getVotes: { signature: "getVotes(address account, uint256 timepoint) view returns (uint256)", about: "A shareholder's weighted votes at a time: the proposal threshold, a ballot's weight." },
    proposalThreshold: { signature: "proposalThreshold() view returns (uint256)", about: "The votes a proposer needs." },
    hasVoted: { signature: "hasVoted(uint256 proposalId, address account) view returns (bool)", about: "Whether a Safe already voted on a proposal." },
    isAllowedTarget: { signature: "isAllowedTarget(address target) view returns (bool)", about: "Whether a matter's call may go to a target: the Board's matters may not." },
    execute: {
      signature: "execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) payable returns (uint256)",
      about: "Executes a passed vote.",
    },
  },
  events: {
    ProposalCreated: {
      signature:
        "ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
      about: "A vote exists.",
    },
    VoteCast: { signature: "VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)", about: "A vote cast." },
    ProposalExecuted: { signature: "ProposalExecuted(uint256 proposalId)", about: "A vote executed." },
  },
  was: [`${V4}/equity/Governor.sol:111`, `${ADDR}:56`],
});

// ── contracts: third-party, wired by the v4 install ─────────────────────────────────────────

export const contract_safe = defineContract({
  id: "safe",
  title: "Safe 1.4.1: personal, agent and company Safes",
  about:
    "Every Safe: a person's (owned by their signer), an agent's (under AgentOwner) and a company's (behind the Signer Gate). " +
    "A Board proposal is one company Safe transaction: each Director approves its hash from their own Safe, and the last " +
    "approval executes it with v=1 signatures. One proxy per Safe, so no address is listed.",
  functions: {
    approveHash: { signature: "approveHash(bytes32 hashToApprove)", about: "A Director's approval of a Board proposal, from their own Safe." },
    execTransaction: {
      signature:
        "execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
      about: "Runs a Board proposal, or a founder's install batch on the company Safe from the founder's Safe.",
    },
    getOwners: { signature: "getOwners() view returns (address[])", about: "A Safe's owners: an agent's sign-in proof, a Board's signers." },
    getThreshold: { signature: "getThreshold() view returns (uint256)", about: "How many approvals a Board proposal needs." },
  },
  events: {
    ApproveHash: { signature: "ApproveHash(bytes32 indexed approvedHash, address indexed owner)", about: "A Director approved a proposal." },
    ExecutionSuccess: { signature: "ExecutionSuccess(bytes32 indexed txHash, uint256 payment)", about: "A proposal executed." },
    ExecutionFailure: { signature: "ExecutionFailure(bytes32 indexed txHash, uint256 payment)", about: "A proposal ran and failed." },
    AddedOwner: { signature: "AddedOwner(address owner)", about: "A signer added (a Director seated)." },
    RemovedOwner: { signature: "RemovedOwner(address owner)", about: "A signer removed." },
    ChangedThreshold: { signature: "ChangedThreshold(uint256 threshold)", about: "The threshold changed." },
  },
  was: [`${SAFE}:26`, "apps/indexer/src/abis.ts:12"],
});

export const contract_safe_4337_module = defineContract({
  id: "safe-4337-module",
  title: "Safe4337Module: a Safe's UserOperation entry",
  about: "The personal and agent Safes' ERC-4337 module: every approval's callData is `executeUserOpWithErrorString` on the sender Safe.",
  addresses: { [DEV]: "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226" },
  functions: {
    executeUserOpWithErrorString: {
      signature: "executeUserOpWithErrorString(address to, uint256 value, bytes data, uint8 operation)",
      about: "The operation's one call, or a delegatecall to MultiSendCallOnly for several.",
    },
  },
  events: {},
  was: [`${SAFE}:33`],
});

export const contract_multi_send_call_only = defineContract({
  id: "multi-send-call-only",
  title: "MultiSendCallOnly: ordered call batches",
  about: "Delegatecalled to run an approval's calls in order (a token approve then a Payments.send) and to pack a Board batch.",
  addresses: { [DEV]: "0x9641d764fc13c8b624c04430c7356c1c7c8102e2" },
  functions: { multiSend: { signature: "multiSend(bytes transactions)", about: "Packed calls, each a plain call." } },
  events: {},
  was: [`${SAFE}:171`],
});

export const contract_entry_point = defineContract({
  id: "entry-point",
  title: "EntryPoint v0.7",
  about: "The canonical ERC-4337 EntryPoint: an approval's nonce key and the event that says what became of it.",
  addresses: { [DEV]: "0x0000000071727De22E5E9d8BAf0edAc6f37da032" },
  functions: {
    getNonce: { signature: "getNonce(address sender, uint192 key) view returns (uint256 nonce)", about: "The next nonce on an approval's own key." },
  },
  events: {
    UserOperationEvent: {
      signature:
        "UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
      about: "Which operation used a nonce and whether it succeeded: the chain proof that ends an approval.",
    },
  },
  was: [`${SAFE}:31`],
});

export const contract_roles = defineContract({
  id: "roles",
  title: "Zodiac Roles 2.1: the payout role and the claim role",
  about:
    "One proxy per company, owned by the company Safe and wired by the install: Budgets is the only member of its payout " +
    "role, capped per token by an allowance (the payout ceiling). Companies House's claim role uses the same module on " +
    "Companies House's Safe. One proxy each, so no address is listed.",
  functions: {
    execTransactionWithRole: {
      signature: "execTransactionWithRole(address to, uint256 value, bytes data, uint8 operation, bytes32 roleKey, bool shouldRevert) returns (bool success)",
      about: "Companies House's claim role calling CompaniesHouseClaimer.",
    },
    allowances: {
      signature: "allowances(bytes32 key) view returns (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance, uint64 timestamp)",
      about: "A token's payout ceiling and what is left of it.",
    },
    setAllowance: {
      signature: "setAllowance(bytes32 key, uint128 balance, uint128 maxRefill, uint128 refill, uint64 period, uint64 timestamp)",
      about: "The payout ceiling's one call in the Board batch `Installer.buildSetCeiling` returns.",
    },
  },
  events: {},
  was: ["packages/protocol/src/evm/zodiac-abi.ts:99", `${V4}/interfaces/external/IRoles.sol:144`],
});

export const contract_hats = defineContract({
  id: "hats",
  title: "Hats Protocol v1: who holds which role",
  about:
    "Every role in an Organization is a hat: the Board's top hat, the Director hat, the officer hats (Books, Invoicing, " +
    "People) and each budget's office hat. Capxul reads a permission only from Hats.",
  addresses: { [DEV]: "0x3bc1a0ad72417f2d411118085256fc53cbddd137" },
  functions: {
    createHat: {
      signature: "createHat(uint256 admin, string details, uint32 maxSupply, address eligibility, address toggle, bool mutable_, string imageURI) returns (uint256 newHatId)",
      about: "A new office or allowance hat.",
    },
    mintHat: { signature: "mintHat(uint256 hatId, address wearer) returns (bool success)", about: "Gives a hat to a member's Safe." },
    transferHat: { signature: "transferHat(uint256 hatId, address from, address to)", about: "Moves a budget's office hat." },
    setHatWearerStatus: {
      signature: "setHatWearerStatus(uint256 hatId, address wearer, bool eligible, bool standing) returns (bool updated)",
      about: "Rules a wearer out of a hat (revoke a permission, remove a Director).",
    },
    changeHatMaxSupply: { signature: "changeHatMaxSupply(uint256 hatId, uint32 newMaxSupply)", about: "Makes room on a full hat." },
    changeHatEligibility: { signature: "changeHatEligibility(uint256 hatId, address newEligibility)", about: "Hands a hat's eligibility over (`org board handover`)." },
    changeHatToggle: { signature: "changeHatToggle(uint256 hatId, address newToggle)", about: "Hands a hat's toggle over (`org board handover`)." },
    isWearerOfHat: { signature: "isWearerOfHat(address user, uint256 hatId) view returns (bool isWearer)", about: "Whether a Safe wears a hat now." },
    viewHat: {
      signature:
        "viewHat(uint256 hatId) view returns (string details, uint32 maxSupply, uint32 supply, address eligibility, address toggle, string imageURI, uint16 lastHatId, bool mutable_, bool active)",
      about: "A hat as the chain holds it now: its supply, modules, whether it is active, and `lastHatId`, from which the next child hat's id is planned.",
    },
  },
  events: {
    HatCreated: {
      signature: "HatCreated(uint256 id, string details, uint32 maxSupply, address eligibility, address toggle, bool mutable_, string imageURI)",
      about: "A hat exists.",
    },
    TransferSingle: {
      signature: "TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 amount)",
      about: "A hat minted, moved or burned: who wears what.",
    },
    WearerStandingChanged: { signature: "WearerStandingChanged(uint256 hatId, address wearer, bool wearerStanding)", about: "A wearer's standing changed." },
  },
  was: ["packages/protocol/src/evm/company-hats.ts:11", `${V4}/interfaces/external/IHats.sol:35`, `${V4}/interfaces/external/IHats.sol:111`],
});

export const contract_hats_signer_gate = defineContract({
  id: "hats-signer-gate",
  title: "Hats Signer Gate v2: the Board's signers",
  about:
    "One proxy per company, the company Safe's only module and guard: the Safe's signers are exactly the Director hat's " +
    "wearers who claimed, and the Gate keeps the threshold. One proxy each, so no address is listed.",
  functions: {
    claimSigner: { signature: "claimSigner(uint256 hatId)", about: "An elected Director claims their seat." },
    claimSignerFor: { signature: "claimSignerFor(uint256 hatId, address signer)", about: "Seats a Director the founder added." },
    removeSigner: { signature: "removeSigner(address signer)", about: "Removes a signer whose hat lapsed." },
    setThresholdConfig: { signature: "setThresholdConfig(ThresholdConfig thresholdConfig)", about: "Sets the Board's threshold." },
    isValidSigner: { signature: "isValidSigner(address account) view returns (bool valid)", about: "Whether a Director still wears the hat." },
  },
  events: {},
  was: [`${V4}/interfaces/external/IHatsSignerGate.sol:56`, "packages/protocol/src/evm/company-gate.ts"],
});

export const contract_hats_elections = defineContract({
  id: "hats-elections",
  title: "Hats Elections: a seat group's elected Directors",
  about:
    "Hats Election Eligibility v0.2.0, one clone per seat group's Director hat (from HatsModuleFactory, at the address the " +
    "equity install predicts), attached as that hat's eligibility by a shareholder vote (`org vote create board-settings`). " +
    "The company Governor records each term's winners and recalls; a Director is ineligible from the term's end until " +
    "the next term starts, with no event, so that hat is read live (indexing's hat-wearers). One clone each, so no " +
    "address is listed.",
  functions: {
    elect: { signature: "elect(uint128 termEnd, address[] winners)", about: "Records a term's winners (`elect` vote); at most the hat's seats." },
    recall: { signature: "recall(uint128 termEnd, address[] recallees)", about: "Removes winners from a term (`remove` vote)." },
    setNextTerm: { signature: "setNextTerm(uint128 newTermEnd)", about: "Opens the election for the next term (`board-settings` vote)." },
    startNextTerm: { signature: "startNextTerm()", about: "Makes the next term current once the current one has ended; anyone may send it." },
    currentTermEnd: { signature: "currentTermEnd() view returns (uint128)", about: "The current term's end: every wearer is ineligible from it until the next term starts." },
    nextTermEnd: { signature: "nextTermEnd() view returns (uint128)", about: "The next term's end, or 0 when none is open." },
  },
  events: {},
  was: [`${V4}/interfaces/external/IHatsElectionEligibility.sol:9`, `${V4}/authority/InstallerElections.sol:22`],
});

export const contract_erc20 = defineContract({
  id: "erc20",
  title: "ERC-20 money tokens",
  about:
    "The tokens Capxul moves: the admitted assets of the deployment (USDC, EURC and the other test tokens on Base Sepolia) " +
    "and any token an Organization adds to its books. One record covers them all, so no address is listed.",
  functions: {
    approve: { signature: "approve(address spender, uint256 amount) returns (bool)", about: "Approves Payments for a send's amount, in the same operation." },
    balanceOf: { signature: "balanceOf(address account) view returns (uint256)", about: "A Safe's balance before a send is built." },
    decimals: { signature: "decimals() view returns (uint8)", about: "A token's decimals, when the books add it." },
    symbol: { signature: "symbol() view returns (string)", about: "A token's symbol, when the books add it." },
    mint: {
      signature: "mint(address recipient, uint256 amount)",
      about: "Test networks only: the synthetic test tokens' open mint, sent by the faucet key for `dev fund` and the welcome grant. Production tokens have none.",
    },
  },
  events: {
    Transfer: { signature: "Transfer(address indexed from, address indexed to, uint256 value)", about: "Money moved: a Movement, or a Payment's own transfer." },
  },
  was: ["packages/protocol/src/evm/test-assets.ts:21", "packages/contracts/src/TestMoneyToken.sol:22"],
});
