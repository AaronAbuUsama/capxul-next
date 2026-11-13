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

import { defineContract, defineIntegration } from "../../packages/blueprint-engine/src/index.ts";
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
        { when: "The paymaster answer has no paymaster data, or its validated window is not exactly the one requested (zero, open, narrowed or widened)", error: error_PROVIDER_RESPONSE_INVALID },
        { when: "The canonical world clock has reached the approval's deadline, before or during sponsorship: the approval has expired", error: error_WRONG_STATE },
        {
          when: "The gateway's reply is not JSON (truncated or proxied), it answers throttled or banned (ERC-7769 -32504), or a chain read fails with a node's internal error, missing header or gas cap: an outage, retried",
          error: error_PROVIDER_ERROR,
        },
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
  title: "Email through Resend, out and in",
  about:
    "Email, behind the Effect service `Mail`, both ways. Out: notices' workflows send every notice from SENDER_EMAIL and " +
    "retry durably (three tries, a minute then four apart); access sends the sign-in code inside its own rpc; and each " +
    "Organization's CRM sends its conversations from its own CRM mailbox, `<handle>@<CRM_MAIL_DOMAIN>`, with Capxul's " +
    "own Message-ID so replies thread (contacts.crm-mailbox). The send call itself never retries: a retry belongs to " +
    "its caller, under the same idempotency key. In: CRM_MAIL_DOMAIN's mail is received by Resend, which posts a signed " +
    "event (Svix: id, timestamp and signature headers, checked with RESEND_WEBHOOK_SECRET against real time, " +
    "time.real-elapsed) to the CRM's mail route for each email received (`email.received`: its id, the addresses on " +
    "the domain it was received for, a BCC'd one included, and its headers' metadata, never its body), and for each " +
    "sent email's delivery, bounce or complaint; the CRM then reads the received email by its id (`getReceived`). In " +
    "its world (time.world-channels): " +
    "on a devnet and in a shared world nothing reaches Resend, and the fake below holds both directions; on staging " +
    "Resend sends only to the mailboxes MAIL_ALLOWED_RECIPIENTS lists (any other recipient is refused before the call, " +
    "as Resend refuses one: INVALID_INPUT) and receives only for staging's CRM_MAIL_DOMAIN; production's is real.",
  component: component_backend,
  system: "resend",
  service: "Mail",
  calls: {
    send: {
      about:
        "Sends one message from the address given (SENDER_EMAIL, or a CRM mailbox with the sender's name) to its " +
        "recipients, with its Reply-To and threading headers (Message-ID, In-Reply-To, References), under the caller's " +
        "idempotency key; returns the provider's message id.",
      timeoutMs: 10_000,
      retries: { max: 0, backoff: "none" },
      p95Ms: 2_000,
      failures: [
        unavailable("Resend"),
        { when: "Resend refused a recipient address, or staging's MAIL_ALLOWED_RECIPIENTS does not list it", error: error_INVALID_INPUT },
        { when: "Resend answered 429", error: error_RATE_LIMITED },
      ],
    },
  },
  fake:
    "The devnet's mail sink (devnet's tables), on a devnet and in a shared world: every message sent is kept and nothing " +
    "is sent; `dev mail fail` makes the next sends refuse. In: `capxul-devnet mail receive` keeps an inbound email in the " +
    "sink, dated at the world's now, and posts its signed event to the CRM's mail route as Resend does; `getReceived` " +
    "reads it from the sink, its `received_for` naming every CRM mailbox it was received for, a BCC'd one included. " +
    "A connected real head's own email (its notifications and reports) reaches the sink through the supervisor's " +
    "`POST /v1/mail` on its follower grant, as a sent message (devnet.site-follows-world). Delivery events: a sink send " +
    "is followed at once by its delivered event, unless a fault makes it bounce. It runs no spam filter and renders " +
    "nothing.",
  secrets: ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET"],
  was: [`${OLD}/mail/service.ts:125`, `${OLD}/mail/notices.ts:17`, "github.com/frappe/frappe@1a7ea577:frappe/email/receive.py:697"],
});

// ── whatsapp ────────────────────────────────────────────────────────────────────────────────

/** A Cloud API call on one Organization's own number, with the access token its WA account seals. */
const metaUnavailable = unavailable("Meta's Cloud API");
const metaThrottled = { when: "Meta answered 429 or its rate-limit codes (4, 80007, 130429) and the retries ran out", error: error_RATE_LIMITED } as const;
const metaUnusable = unusable("Meta's Cloud API");

export const integration_whatsapp = defineIntegration({
  id: "whatsapp",
  title: "WhatsApp through Meta's WhatsApp Business Cloud API",
  about:
    "WhatsApp for each Organization's CRM, behind the Effect service `WhatsApp`, on Meta's WhatsApp Business Cloud API " +
    "(graph.facebook.com, version v23.0, as Frappe's WhatsApp app calls it) at the deployment's WHATSAPP_API_URL. An " +
    "Organization connects its own Business number (aaron.world-clock; contacts.whatsapp-connect): every call carries " +
    "that number's phone number id and the access token its WA account seals, so no deployment secret is Meta's. Out: " +
    "a call per message. In: once the app is subscribed to the number's WhatsApp Business Account, Meta posts signed " +
    "webhooks (X-Hub-Signature-256, the HMAC of the body with the account's app secret) to the callback set for that " +
    "app, the CRM's route for the account, for each message received and each status of one sent (sent, delivered, " +
    "read, failed), and redelivers one not answered 200 for up to 7 days; the GET handshake answers `hub.challenge` " +
    "for the account's verify token. In its " +
    "world (time.world-channels): on a devnet and in a shared world WHATSAPP_API_URL is the stand-in WhatsApp, and " +
    "nothing reaches Meta or a phone; on staging Meta's test number, which sends only to the recipients registered with " +
    "it (any other is refused: INVALID_INPUT); production's is real.",
  component: component_backend,
  system: "meta",
  service: "WhatsApp",
  calls: {
  },
  fake:
    "The devnet's stand-in WhatsApp (devnet.whatsapp-stand-in), on a devnet and in a shared world: the supervisor " +
    "serves the Cloud API's routes at WHATSAPP_API_URL on devnet's whatsapp-numbers and whatsapp-messages; " +
    "`capxul-devnet whatsapp number add <org>` makes a number and the key file `org crm whatsapp connect` reads; a send " +
    "is answered with its wamid and followed at once by its sent and delivered webhooks, `whatsapp receive` posts an " +
    "inbound message and `whatsapp read` a read status, each signed with the number's app secret and dated at the " +
    "world's now, and redelivered while the route does not answer 200, as Meta does; it takes the app's subscription " +
    "to the number's business account and serves `readNumber`; it judges Meta's rules on the world's now, so a " +
    "free-form send outside the 24-hour window is refused 131047 and a template it does not hold 132001; its fault " +
    "switch has down, refuse (the next send, as outside the window) and clear. It holds Meta's sample template " +
    "`hello_world` (en_US) for every number, approved at once, renders no template and holds no media.",
  secrets: [],
  was: [
    "github.com/frappe/whatsapp@59bf368:whatsapp/whatsapp/api/whatsapp.py:10",
    "github.com/frappe/whatsapp@59bf368:whatsapp/whatsapp/webhook.py:30",
    "github.com/frappe/whatsapp@59bf368:whatsapp/whatsapp/doctype/wa_account/wa_account.py:144",
  ],
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
    when:
      "This machine runs no devnet (no control handoff: the supervisor's address and token, or not this user's), or a shared world's address was given no grant, or a revoked one",
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
  when: "Another move of the clock (a warp, step, settle, start-at, freeze, resume or rate change) is running; the refusal names it",
  error: error_WRONG_STATE,
} as const;
/** In a shared world only its owner moves the clock and saves and restores the world; only the owner or a follower grant follows it (decision devnet.shared-world). */
const ownerOnly = {
  when: "In a shared world the grant may not do this: only the owner's grant moves the clock and saves or restores the world, and only the owner's or a follower grant follows it",
  error: error_ROLE_PERMISSION_DENIED,
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
    "one; for a shared world, HTTPS at the world's address with a world grant as the bearer token, answered by the " +
    "grant's role (decision devnet.shared-world). Its time part is the one clock's interface for people building on " +
    "Capxul (decision devnet.time-protocol): read now, start the story at a date, warp, step, settle, freeze and resume, " +
    "set the rate a running clock runs at (decision devnet.clock-rate), watch the clock's events and follow it as a " +
    "follower the barrier and the running stops wait for. Its world part saves, lists and restores named worlds (the " +
    "chain, Postgres and Ponder together, with the clock). The Core SDK's Node-only devnet entry is its typed client, " +
    "behind the Effect service `DevnetControl`; the CLI's `dev time` and `dev snapshot` commands and the supervisor's " +
    "own `capxul-devnet time` commands are thin clients of it, and an outside program may speak the HTTP directly. Its " +
    "season part, the plan and run of a shared world's seasons, is parked (cut.seasons). A follower that keeps world " +
    "state (a real bench, the FDE namespace) joins stateful and saves and restores its own state with every world " +
    "(decision devnet.stateful-followers). Only devnet records use it.",
  component: component_core_sdk,
  system: "capxul-devnet supervisor",
  service: "DevnetControl",
  calls: {
    snapshotSave: {
      about:
        "Saves the whole world under a name, with its clock and the backend code it was saved with; `replace` replaces a " +
        "world of that name. On the `save` event each stateful follower saves its own state under the name before it " +
        "acknowledges, and the manifest lists them (devnet.stateful-followers).",
      timeoutMs: 60_000,
      ...CONTROL,
      p95Ms: 10_000,
      failures: [
        ...controlFailures,
        { when: "A world has that name and `replace` was not asked", error: error_WRONG_STATE },
        { when: "The name is not lowercase letters, digits and hyphens, up to 40 characters", error: error_INVALID_INPUT },
        ownerOnly,
      ],
    },
    snapshotRestore: {
      about:
        "Restores a named world, its clock frozen at the world's now meanwhile, then in its saved mode and rate. On the " +
        "`restore` event each stateful follower restores its own state before it acknowledges, and the backend and Ponder " +
        "start only after (devnet.stateful-followers).",
      timeoutMs: 60_000,
      ...CONTROL,
      p95Ms: 10_000,
      failures: [
        ...controlFailures,
        { when: "No world has that name; the refusal lists the worlds saved here", error: error_INVALID_INPUT },
        { when: "The world was saved with other backend code, so its data may not match it", error: error_WRONG_STATE },
        {
          when: "A stateful follower joined now is missing from the world's manifest (the refusal names it)",
          error: error_WRONG_STATE,
        },
        ownerOnly,
      ],
    },
    worldCreate: {
      about: "Makes a whole world: id (no hyphen), folder, ports, token; a chain instance with the contracts (from a template's saved state or deployed), the service, the clock, the record's born entry, the stand-ins and keys. One supervisor per world.",
      timeoutMs: 120_000,
      ...CONTROL,
      p95Ms: 60_000,
      failures: [
        ...controlFailures,
        { when: "A world has that id, or the id has a hyphen, a capital letter or is longer than 12 characters", error: error_INVALID_INPUT },
        { when: "The template is not saved here", error: error_INVALID_INPUT },
        ownerOnly,
      ],
    },
    restoreAs: {
      about: "Restores a snapshot into a separate world under a new id: same chain id, new chain instance, every site address, secret, port and name renamed; the born entry names the parent. Proved by the spike: 36 s for one company.",
      timeoutMs: 180_000,
      ...CONTROL,
      p95Ms: 90_000,
      failures: [
        ...controlFailures,
        { when: "No snapshot of that name in that world, or the new id is taken or malformed", error: error_INVALID_INPUT },
        { when: "The snapshot was saved with other backend code, so its data may not match it", error: error_WRONG_STATE },
        ownerOnly,
      ],
    },
    snapshotList: { about: "The saved worlds, newest first.", timeoutMs: 2_000, ...CONTROL, p95Ms: 100, failures: [...controlFailures] },
    timeRead: {
      about:
        "GET /v1/time: the clock (now and realAt, mode, rate, next stop, version, world epoch, whether it moved, the " +
        "authority's real time), the chain head, the backend's now, Ponder's position, each " +
        "follower's acknowledged version and next due, and whether they agree.",
      ...CLOCK_CALL,
      failures: [...controlFailures],
    },
    timeRate: {
      about:
        "POST /v1/time/rate {rate}: sets the seconds of world time that pass in each real second while the clock runs, a " +
        "whole number from 1 to 60. A running clock runs on at it from now; a frozen one keeps it for when it runs. It " +
        "moves nothing back and mines nothing (decision devnet.clock-rate).",
      ...CLOCK_CALL,
      failures: [
        ...controlFailures,
        { when: "The rate is not a whole number from 1 to 60; the refusal names the range", error: error_INVALID_INPUT },
        busy,
        ownerOnly,
      ],
    },
    timeWarp: {
      about:
        "POST /v1/time/warp: moves now forward by a span or to an instant, stopping at every due second on the way, and " +
        "returns when the chain has a block at the target and everything due by then has run and settled. A warp whose " +
        "caller goes away stops at its next settled stop.",
      ...BARRIER,
      p95Ms: 5_000,
      failures: [...controlFailures, { when: "The target is not later than now", error: error_INVALID_INPUT }, busy, unsettled, ownerOnly],
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
        ownerOnly,
      ],
    },
    timeStep: {
      about: "POST /v1/time/step: moves now to the next instant anything is due (a timer, a cron run, a follower's next due), not past a limit, and settles.",
      ...BARRIER,
      p95Ms: 3_000,
      failures: [...controlFailures, { when: "The limit is not later than now", error: error_INVALID_INPUT }, busy, unsettled, ownerOnly],
    },
    timeSettle: {
      about: "POST /v1/time/settle: waits until everything due at now has run and every follower is idle, without moving now.",
      ...BARRIER,
      p95Ms: 2_000,
      failures: [...controlFailures, busy, unsettled, ownerOnly],
    },
    timeFreeze: {
      about: "POST /v1/time/freeze: holds now still, at the next whole second, until a warp, step or resume moves it; the rate is kept.",
      ...CLOCK_CALL,
      failures: [...controlFailures, busy, ownerOnly],
    },
    timeResume: {
      about: "POST /v1/time/resume: lets now run on from where it stands, at the clock's rate, through the running stops.",
      ...CLOCK_CALL,
      failures: [...controlFailures, busy, ownerOnly],
    },
    timeWatch: {
      about:
        "GET /v1/time/events: the clock's events as server-sent events, each with its version, now and realAt, mode, rate, " +
        "next stop, world and reason; a `save` or `restore` names its world. Any grant may watch.",
      ...CLOCK_CALL,
      failures: [...controlFailures],
    },
    timeFollow: {
      about:
        "POST /v1/followers, its event stream, acknowledgements and due reports (POST /v1/followers/<id>/due): a " +
        "follower the barrier and running stops wait for, with its own next due. `stateful` joins one that keeps world " +
        "state: it gets `save` and `restore` events (devnet.stateful-followers).",
      ...CLOCK_CALL,
      failures: [...controlFailures, { when: "A follower of that name is already following", error: error_WRONG_STATE }, ownerOnly],
    },
  },
  fake: "None: it exists only on a devnet machine or a shared world's host. Its conformance suite is the protocol's own, run against the supervisor.",
  secrets: [],
  was: ["packages/sdk/src/devnet/index.ts:5", "packages/protocol/src/devnet/control.ts:107", "packages/devnet/src/modules/guardian/standing-config.ts:20"],
});

// ── fde-host ────────────────────────────────────────────────────────────────────────────────

/** A host call: one HTTPS call to Capxul's FDE host, idempotent by the agent id (and a send by its ask). */
const HOST_CALL = { timeoutMs: 10_000, retries: { max: 3, backoff: "exponential" }, p95Ms: 2_000 } as const;
const hostFailures = [
  unavailable("The FDE host"),
  { when: "The FDE host answered 429 and the retries ran out", error: error_RATE_LIMITED },
  unusable("The FDE host"),
] as const;

export const integration_fde_host = defineIntegration({
  id: "fde-host",
  title: "Capxul's FDE host: each Organization's hosted Forward Deployed Engineer",
  about:
    "The durable runtime Capxul runs each Organization's FDE on (aaron.fde-hosted; organizations.fde-host): Capxul's " +
    "swarmD namespace, one persistent agent per Organization keyed `fde:<orgId>`, its conversation kept durable and " +
    "its tools run in a sandbox, behind the Effect service `FdeHost`, reached over HTTPS with the host token. The host " +
    "makes and keeps the FDE's key: Capxul only ever learns its address, which the install batch passes to " +
    "`AgentOwner.create` with the company Safe as owner, so the Board owns the FDE. Hosted, it acts only as the asker " +
    "of its turn (organizations.fde-for-the-asker): each send carries an act-for token the host gives the FDE's CLI for " +
    "that turn alone. Every call is idempotent by the agent id, a send by its ask id too, so a retried step changes " +
    "nothing twice. Its agents' timers are instants on the world's clock: a world that hosts real FDEs gets its own " +
    "namespace, which follows that world's clock as one follower and fires them at its stops " +
    "(devnet.fde-host-follows-world, time.world-channels).",
  component: component_backend,
  system: "swarmd",
  service: "FdeHost",
  calls: {
    provision: {
      about: "Makes the Organization's FDE agent and its key, or finds them; keeps the key and answers the agent id and the key's address.",
      ...HOST_CALL,
      failures: [...hostFailures],
    },
  },
  fake:
    "The devnet's stand-in host (devnet.fde-host-stand-in): the supervisor serves it on loopback and keeps its agents in " +
    "devnet's `fde-host-agents`. Keys come from the agent id, each turn ends with a scripted reply as it is posted, " +
    "`capxul-devnet fde run <org> --ask <askId> -- <command>` runs a command as the FDE under that open ask's act-for " +
    "token (devnet.world-pass-worlds), and its fault switch has down, hold (new turns stay working) and clear. It runs " +
    "no model and no sandbox. The real host's namespace for a world follows it stateful: swarmD saves and restores the " +
    "namespace's agents under the world's name, beside its timers on the world's clock (devnet.stateful-followers).",
  secrets: ["FDE_HOST_TOKEN"],
  was: ["blueprint/organizations/decisions.ts (organizations.fde-host)", "/home/user/swarmd/docs/SPEC.md (B.15, B.16, B.19)"],
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

// ── contracts: Capxul's Protocol v4 ─────────────────────────────────────────────────────────

const DEV = "devnet" as const;
const PAYMENT_ITEM =
  "(bytes32 paymentId, address recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash, bytes32 jobNonce, address executor)";

export const contract_companies_house_claimer = defineContract({
  id: "companies-house-claimer",
  code: "built",
  artifact: "CompaniesHouseClaimer",
  title: "CompaniesHouseClaimer: a person's Safe claimed",
  about:
    "One shared, stateless contract. Companies House's claim role calls `claim` through Roles to deploy (if needed) a " +
    "person's email-derived Safe and swap its signer in; `safeAddressFor` is the pure address function the whole system " +
    "uses for a person's Safe.",
  functions: {
    claim: { signature: "claim(string namespace, string email, address signer) returns (address safe)", about: "Deploys and claims a person's Safe for their signer." },
    safeAddressFor: { signature: "safeAddressFor(address owner, string namespace, string email) pure returns (address)", about: "A person's Safe address from their email." },
  },
  events: {
    CapxulSafeClaimed: { signature: "CapxulSafeClaimed(address indexed safe, address indexed signer, bool deployed)", about: "A person's Safe is live with their signer: setup done, referral credit earned." },
  },
  errors: {
    DerivedAddressMismatch: { signature: "DerivedAddressMismatch(address expected, address deployed)", about: "The Safe factory deployed somewhere other than the derived address." },
    EmailNotNormalized: { signature: "EmailNotNormalized()", about: "The email is empty, has a leading or trailing space or control byte, an upper-case letter or a non-ASCII byte." },
    EmptyNamespace: { signature: "EmptyNamespace()", about: "The namespace is empty." },
    InvalidSigner: { signature: "InvalidSigner()", about: "The signer is zero, the owners sentinel or Companies House itself." },
    NotDelegateCall: { signature: "NotDelegateCall()", about: "claim was called plainly: it runs only as Companies House's delegatecall." },
    SwapRefused: { signature: "SwapRefused()", about: "The Safe refused the owner swap." },
  },
  was: [`${V4}/interfaces/ICompaniesHouseClaimer.sol:17`, `${ADDR}:44`],
});

export const contract_company_safe_minter = defineContract({
  id: "company-safe-minter",
  code: "built",
  artifact: "CompanySafeMinter",
  title: "CompanySafeMinter: a company Safe minted",
  about: "Companies House's company-Safe role mints an Organization's Safe, owned by the founder's personal Safe, at a predictable address.",
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
  errors: {
    DerivedAddressMismatch: { signature: "DerivedAddressMismatch(address expected, address deployed)", about: "The Safe factory deployed somewhere other than the derived address." },
    EmptyCompany: { signature: "EmptyCompany()", about: "The company id is empty." },
    EmptyNamespace: { signature: "EmptyNamespace()", about: "The namespace is empty." },
    InvalidFounderSafe: { signature: "InvalidFounderSafe()", about: "The founder's Safe is zero, the owners sentinel, Companies House, or has no code." },
    NotDelegateCall: { signature: "NotDelegateCall()", about: "mint was called plainly: it runs only as Companies House's delegatecall." },
    SwapRefused: { signature: "SwapRefused()", about: "The Safe refused the owner swap." },
  },
  was: [`${V4}/companies-house/CompanySafeMinter.sol:59`, `${ADDR}:45`],
});

export const contract_installer = defineContract({
  id: "installer",
  code: "built",
  artifact: "Installer",
  title: "Installer: an Organization's hats, Roles and Gate",
  about:
    "One shared contract. `deployMoney` (anyone, sent by the tier key) deploys a company's hat trees, Roles and Signer Gate; " +
    "`buildMoney`, `buildAddToken`, `buildSetCeiling` and `buildEquity` return the batches the company Safe signs. It never " +
    "holds funds or authority after.",
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
    PAYOUT_ROLE_KEY: { signature: "PAYOUT_ROLE_KEY() view returns (bytes32)", about: "The Roles role key of the payout role Budgets is the only member of." },
    agreements: { signature: "agreements() view returns (address)", about: "The Agreements address, set at deploy." },
    budgets: { signature: "budgets() view returns (address)", about: "The Budgets address, set at deploy." },
    captableImplementation: { signature: "captableImplementation() view returns (address)", about: "The Captable implementation (equity, parked), set at deploy." },
    electionsImplementation: { signature: "electionsImplementation() view returns (address)", about: "The Hats Elections implementation address, set at deploy." },
    escrowFactory: { signature: "escrowFactory() view returns (address)", about: "The EscrowFactory address, set at deploy." },
    exitsImplementation: { signature: "exitsImplementation() view returns (address)", about: "The Exits implementation (equity, parked), set at deploy." },
    fallbackHandler: { signature: "fallbackHandler() view returns (address)", about: "The Safe fallback handler address, set at deploy." },
    gateImplementation: { signature: "gateImplementation() view returns (address)", about: "The Hats Signer Gate implementation address, set at deploy." },
    governorImplementation: { signature: "governorImplementation() view returns (address)", about: "The Governor implementation (equity, parked), set at deploy." },
    hats: { signature: "hats() view returns (address)", about: "The Hats address, set at deploy." },
    hatsModuleFactory: { signature: "hatsModuleFactory() view returns (address)", about: "The Hats module factory address, set at deploy." },
    moduleProxyFactory: { signature: "moduleProxyFactory() view returns (address)", about: "The module proxy factory address, set at deploy." },
    multisendUnwrapper: { signature: "multisendUnwrapper() view returns (address)", about: "The MultiSend unwrapper address, set at deploy." },
    optionsImplementation: { signature: "optionsImplementation() view returns (address)", about: "The Options implementation (equity, parked), set at deploy." },
    payments: { signature: "payments() view returns (address)", about: "The Payments address, set at deploy." },
    payoutAllowanceKey: { signature: "payoutAllowanceKey(address token) pure returns (bytes32)", about: "The Roles allowance key of a token's payout ceiling." },
    rolesMastercopy: { signature: "rolesMastercopy() view returns (address)", about: "The Roles mastercopy address, set at deploy." },
    roundsImplementation: { signature: "roundsImplementation() view returns (address)", about: "The Rounds implementation (equity, parked), set at deploy." },
    safe4337Module: { signature: "safe4337Module() view returns (address)", about: "The Safe 4337 module address, set at deploy." },
    shareClassImplementation: { signature: "shareClassImplementation() view returns (address)", about: "The ShareClass implementation (equity, parked), set at deploy." },
    vesting: { signature: "vesting() view returns (address)", about: "The Vesting address, set at deploy." },
  },
  events: {
    MoneyDeployed: { signature: "MoneyDeployed(address indexed safe, address indexed founderSafe, MoneyDeployment deployment)", about: "An Organization's deployment: its hat ids, Roles and Gate." },
    EquityDeployed: { signature: "EquityDeployed(address indexed safe, EquityDeployment deployment)", about: "The equity clones of a company." },
    ElectionsDeployed: {
      signature: "ElectionsDeployed(address indexed safe, address elections, uint256 directorHat, uint128 firstTermEnd)",
      about: "A seat group's Elections clone exists, with its first term.",
    },
  },
  errors: {
    InvalidInstall: { signature: "InvalidInstall(InstallRefusal reason)", about: "The install was refused, with a reason: Safe, founder Safe, Roles, Gate, Director or co-Director invalid, no token, duplicate token, zero top hat, bad period or threshold, unknown token, equity exists, not the company's clones." },
    SafeCastOverflowedUintDowncast: { signature: "SafeCastOverflowedUintDowncast(uint8 bits, uint256 value)", about: "A figure too large for the width the Installer packs it into (OpenZeppelin SafeCast)." },
  },
  was: [`${V4}/interfaces/IInstaller.sol:222`, `${V4}/interfaces/IInstaller.sol:288`, `${ADDR}:57`],
});

export const contract_payments = defineContract({
  id: "payments",
  code: "built",
  artifact: "Payments",
  title: "Payments: the one way money leaves",
  about:
    "One shared contract: an exact transfer of one token amount from the caller to a fixed recipient, identified by a hash " +
    "of every term, consumed once, stamped with a kind and a document hash. Every movement of money in v4 ends in a " +
    "`PaymentSent`, which is what settles a Payment.",
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
  errors: {
    InexactTransfer: { signature: "InexactTransfer(address token, uint256 expected, uint256 received)", about: "The token moved a different amount than the item says (a fee-on-transfer token is refused)." },
    InvalidExecutor: { signature: "InvalidExecutor(address expected, address supplied)", about: "The item names an executor and the caller is someone else." },
    InvalidRecipient: { signature: "InvalidRecipient()", about: "The recipient is Payments itself." },
    PaymentIdConsumed: { signature: "PaymentIdConsumed(bytes32 paymentId)", about: "The payment id was already used: one payment is never sent twice." },
    PaymentIdMismatch: { signature: "PaymentIdMismatch(bytes32 expected, bytes32 supplied)", about: "The item's paymentId is not the hash of its terms." },
    ReentrantCall: { signature: "ReentrantCall()", about: "A call back into Payments while it runs." },
    TokenCallReturnedFalse: { signature: "TokenCallReturnedFalse(address token)", about: "The token's transferFrom answered false." },
    TokenHasNoCode: { signature: "TokenHasNoCode(address token)", about: "The token address holds no code." },
    ZeroAddress: { signature: "ZeroAddress()", about: "The recipient or the token is the zero address." },
    ZeroAmount: { signature: "ZeroAmount()", about: "An item of zero." },
    ZeroDocumentHash: { signature: "ZeroDocumentHash()", about: "An item with no document hash." },
    ZeroJobNonce: { signature: "ZeroJobNonce()", about: "An item with no job nonce." },
    ZeroPaymentId: { signature: "ZeroPaymentId()", about: "An item with no payment id." },
  },
  was: [`${V4}/interfaces/IPayments.sol:23`, `${ADDR}:46`],
});

export const contract_budgets = defineContract({
  id: "budgets",
  code: "built",
  artifact: "Budgets",
  title: "Budgets: money authority under hats",
  about:
    "One shared contract keyed by company Safe: a tree of budgets per token and period, each naming a hat; a wearer of the " +
    "hat or of any hat above may spend, schedule or open a child; Budgets pays from the company Safe through its Roles " +
    "payout role and Payments. Anyone may `execute` a scheduled payment at or after its date.",
  functions: {
    createTopBudget: { signature: "createTopBudget(address token, uint8 period, uint128 amount, uint256 hat) returns (uint256 id)", about: "A top budget, by the Board." },
    createChildBudget: { signature: "createChildBudget(uint256 parent, uint128 amount, uint256 hat) returns (uint256 id)", about: "A department, team or allowance." },
    setAmount: { signature: "setAmount(uint256 id, uint128 amount)", about: "A budget's amount per period." },
    setHat: { signature: "setHat(uint256 id, uint256 hat)", about: "A budget's office hat." },
    close: { signature: "close(uint256 id)", about: "Closes a budget." },
    reopen: { signature: "reopen(uint256 id)", about: "Reopens a closed budget." },
    spend: {
      signature: "spend(uint256 id, address recipient, uint128 amount, uint16 kind, bytes32 documentHash, bytes32 jobNonce) returns (bytes32 paymentId)",
      about: "Pays now from a budget: the caller must be authorised, the path open, kind 0 to 3, the amount, document hash and job nonce non-zero and the amount within leftOf, else OverBudget.",
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
    authorised: { signature: "authorised(uint256 id, address who) view returns (bool)", about: "Whether `who` may act on a budget: it is the company Safe, or it wears (in good standing) the budget's hat or an ancestor budget's hat. The only place an agent's authority is decided." },
    scheduledOf: { signature: "scheduledOf(uint256 id) view returns (Scheduled)", about: "A dated payment's state and date." },
    MAX_DEPTH: { signature: "MAX_DEPTH() pure returns (uint8)", about: "How deep a budget tree may go: 8. A child under a budget of depth 8 reverts TooDeep." },
    agreements: { signature: "agreements() view returns (address)", about: "The Agreements contract, the only caller of commit, release and payReserved; zero before setAgreements." },
    budgetCount: { signature: "budgetCount() view returns (uint256)", about: "How many budgets have been created." },
    commit: { signature: "commit(uint256 id, uint128 amount)", about: "Agreements only: reserves an amount in a budget for an agreement (open path, within what is left, else OverBudget)." },
    configs: { signature: "configs(address safe) view returns (address, bytes32)", about: "A company Safe's payout wiring: its Roles and its payout role key (zero before `configure`)." },
    configure: { signature: "configure(address roles, bytes32 payoutRoleKey)", about: "The company Safe wires its payout: Roles must name it as avatar and target a Gate of its own, else InvalidConfiguration. The install batch runs it; createTopBudget refuses a Safe that has not." },
    hats: { signature: "hats() view returns (address)", about: "The Hats contract Budgets asks who wears a hat (set at deploy)." },
    pathOf: { signature: "pathOf(uint256 id) view returns (uint256[] path)", about: "The budget ids from its top budget down to this one." },
    payReserved: { signature: "payReserved(uint256 id, address recipient, uint128 amount, bytes32 documentHash, bytes32 jobNonce) returns (bytes32 paymentId)", about: "Agreements only: pays a collection (kind 4) against the agreement's reservation through the payout role, even while the budget is closed." },
    payments: { signature: "payments() view returns (address)", about: "The Payments contract every payout goes through (set at deploy)." },
    release: { signature: "release(uint256 id, uint128 amount)", about: "Agreements only: frees part of an agreement's reservation in a budget." },
    scheduledCount: { signature: "scheduledCount() view returns (uint256)", about: "How many dated payments have been scheduled." },
    setAgreements: { signature: "setAgreements(address agreements_)", about: "The deployer sets the Agreements address once (AlreadySet after, NotDeployer from anyone else); only that contract may commit, release and payReserved." },
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
    AgreementsSet: { signature: "AgreementsSet(address indexed agreements)", about: "The Agreements contract was set, once." },
    Configured: { signature: "Configured(address indexed safe, address roles, bytes32 payoutRoleKey)", about: "A company Safe wired its Roles and payout role key." },
    ReservedPaid: { signature: "ReservedPaid(address indexed safe, uint256 indexed id, address indexed recipient, uint128 amount, bytes32 paymentId)", about: "An agreement's collection was paid from its reservation, beside its PaymentSent." },
  },
  errors: {
    AlreadyClosed: { signature: "AlreadyClosed()", about: "close on a budget that is already closed." },
    AlreadySet: { signature: "AlreadySet()", about: "setAgreements after the Agreements address was set." },
    AmountBelowUse: { signature: "AmountBelowUse(uint256 id, uint128 used, uint128 requested)", about: "setAmount below what the budget has spent, reserved and given its children this period." },
    BudgetIsClosed: { signature: "BudgetIsClosed(uint256 closedId)", about: "A spend, reservation, schedule or child under a path with a closed budget; names the nearest closed one." },
    ChildrenExceedParent: { signature: "ChildrenExceedParent(uint256 parent, uint128 left, uint128 requested)", about: "A child's amount does not fit in what its parent has left." },
    InvalidBudgetPeriod: { signature: "InvalidBudgetPeriod(uint8 period)", about: "A top budget's period above the year (from the calendar)." },
    InvalidConfiguration: { signature: "InvalidConfiguration()", about: "configure: Roles does not name the caller as avatar, does not target a Gate of the caller, or answers badly." },
    InvalidHat: { signature: "InvalidHat()", about: "A budget's hat is zero." },
    InvalidKind: { signature: "InvalidKind(uint16 kind)", about: "spend or schedule with a payment kind above 3: kind 4 (collection) and 9 (sweep) are the contracts' own." },
    InvalidPayAt: { signature: "InvalidPayAt()", about: "schedule with a date that is not in the future." },
    InvalidToken: { signature: "InvalidToken()", about: "createTopBudget with the zero address or a token that has no code." },
    NotAuthorised: { signature: "NotAuthorised(uint256 id, address who)", about: "The caller may not act on the budget: not the company Safe, nor a wearer in good standing of its hat or of an ancestor budget's hat (a top budget's amount, hat, close and reopen are the Safe's alone)." },
    NotClosed: { signature: "NotClosed()", about: "reopen on a budget that is open." },
    NotConfigured: { signature: "NotConfigured()", about: "createTopBudget by a Safe that has not run configure." },
    NotDeployer: { signature: "NotDeployer()", about: "setAgreements by anyone but the deployer." },
    NotDue: { signature: "NotDue(uint256 id, uint64 payAt)", about: "execute before the dated payment's date." },
    NotPending: { signature: "NotPending(uint256 id)", about: "cancel or execute a dated payment that is already paid or cancelled." },
    NotTheSafe: { signature: "NotTheSafe()", about: "Declared in the interface and never thrown by the code." },
    OnlyAgreements: { signature: "OnlyAgreements()", about: "commit, release or payReserved from anyone but the Agreements contract." },
    OverBudget: { signature: "OverBudget(uint256 id, uint128 left, uint128 requested)", about: "A spend, schedule or reservation larger than what the budget has left this period: names the budget, the amount left and the amount asked." },
    ReentrantCall: { signature: "ReentrantCall()", about: "A call back into Budgets while it runs." },
    SafeCastOverflowedUintDowncast: { signature: "SafeCastOverflowedUintDowncast(uint8 bits, uint256 value)", about: "A figure too large for the 128 bits a budget keeps (OpenZeppelin SafeCast)." },
    TooDeep: { signature: "TooDeep()", about: "createChildBudget under a budget already 8 deep." },
    UnknownBudget: { signature: "UnknownBudget(uint256 id)", about: "A budget id no one has created." },
    UnknownScheduled: { signature: "UnknownScheduled(uint256 id)", about: "A scheduled payment id no one has created." },
    ZeroAddress: { signature: "ZeroAddress()", about: "A zero Payments, Hats or Agreements address, or a scheduled payment to the zero address." },
    ZeroAmount: { signature: "ZeroAmount()", about: "spend or schedule of zero." },
    ZeroDocumentHash: { signature: "ZeroDocumentHash()", about: "spend or schedule with no document hash." },
    ZeroJobNonce: { signature: "ZeroJobNonce()", about: "spend or schedule with no job nonce." },
  },
  was: [`${V4}/interfaces/IBudgets.sol:56`, `${ADDR}:47`],
});

export const contract_agreements = defineContract({
  id: "agreements",
  code: "built",
  artifact: "Agreements",
  title: "Agreements: pay agreements from a budget",
  about:
    "One shared contract keyed by company Safe: an office holder offers a salary, stream or retainer from a budget (which " +
    "reserves it in Budgets), the payee accepts at the exact terms, and collects what is released (paid through " +
    "`Budgets.payReserved`, kind 4).",
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
    MAX_OPEN_AGREEMENTS: { signature: "MAX_OPEN_AGREEMENTS() view returns (uint256)", about: "The most open agreements one budget may hold: 64." },
    MONTHLY: { signature: "MONTHLY() view returns (uint64)", about: "The step value (max uint64) that means calendar months, not a fixed number of seconds." },
    agreementCount: { signature: "agreementCount() view returns (uint256)", about: "How many agreements have been offered." },
    budgets: { signature: "budgets() view returns (address)", about: "The Budgets contract agreements reserve in and are paid through (set at deploy)." },
    earnedOf: { signature: "earnedOf(uint256 id) view returns (uint128)", about: "What the payee has earned and not yet collected, released or not." },
    openOf: { signature: "openOf(uint256 budgetId) view returns (uint256[])", about: "A budget's open agreement ids (offered, accepted or paused), at most 64." },
    reservation: { signature: "reservation(uint128 rate, uint8 period, uint8 budgetPeriod, uint64 startsAt, uint64 endsAt) pure returns (uint128)", about: "What an agreement reserves in its budget: its per-budget-period figure, capped by the whole term when it has an end." },
    settle: { signature: "settle(uint256 budgetId)", about: "Anyone: brings a budget's open agreements up to date, freeing the reservation of those ended, lowered or whose offer expired, and dropping the closed from its open list." },
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
    ReservationReleased: { signature: "ReservationReleased(address indexed safe, uint256 indexed budgetId, uint256 indexed id, uint128 amount)", about: "An agreement's reservation was freed (offer withdrawn or expired, agreement ended or lowered), with the amount." },
  },
  errors: {
    AlreadyAccepted: { signature: "AlreadyAccepted()", about: "withdrawOffer or accept on an agreement already accepted." },
    AlreadyEnded: { signature: "AlreadyEnded()", about: "changeRate on an agreement that has an end; cancelChange, pause or resume on a closed one." },
    AlreadyPaused: { signature: "AlreadyPaused()", about: "pause on an agreement already paused." },
    InsufficientReleased: { signature: "InsufficientReleased(uint128 available, uint128 requested)", about: "collect of more than has been released: names what is available and what was asked." },
    InvalidAgreement: { signature: "InvalidAgreement()", about: "An unknown agreement; or an offer to the zero address, to the offering Safe itself, at a zero rate or with no document hash." },
    InvalidAmount: { signature: "InvalidAmount()", about: "collect of zero." },
    InvalidBudgetPeriod: { signature: "InvalidBudgetPeriod(uint8 period)", about: "A budget period above the year (from the calendar)." },
    InvalidDate: { signature: "InvalidDate()", about: "A start in the past, an offer expiry not in the future or after the end, an end not after the start, or a rate change or end dated in the past." },
    InvalidPeriod: { signature: "InvalidPeriod(uint8 period)", about: "A pay period the calendar does not know (from the calendar)." },
    InvalidRate: { signature: "InvalidRate()", about: "A zero rate, a change to the same rate, or a figure too large for 128 bits." },
    InvalidStep: { signature: "InvalidStep()", about: "An offer with a zero step." },
    NoPendingChange: { signature: "NoPendingChange()", about: "cancelChange with no rate change pending." },
    NotAccepted: { signature: "NotAccepted()", about: "collect or a change on an agreement the payee has not accepted." },
    NotAuthorised: { signature: "NotAuthorised(uint256 budgetId, address who)", about: "The caller is not authorised on the agreement's budget (Budgets.authorised: its hat's wearers, an ancestor's, or the company Safe)." },
    NotPaused: { signature: "NotPaused()", about: "resume on an agreement that is not paused." },
    NotThePayee: { signature: "NotThePayee()", about: "accept or collect by anyone but the payee." },
    OfferExpired: { signature: "OfferExpired()", about: "accept after the offer's expiry, or on a closed offer; withdrawOffer on a closed one." },
    PendingChange: { signature: "PendingChange()", about: "changeRate while another change is pending." },
    ReentrantCall: { signature: "ReentrantCall()", about: "A call back into Agreements while it runs." },
    TermsMismatch: { signature: "TermsMismatch()", about: "accept with a terms hash that is not the offer's document hash." },
    TooManyAgreements: { signature: "TooManyAgreements()", about: "An offer into a budget that already holds 64 open agreements." },
    UnknownBudget: { signature: "UnknownBudget(uint256 id)", about: "An offer into a budget id Budgets does not know." },
  },
  was: [`${V4}/interfaces/IAgreements.sol:37`, `${ADDR}:48`],
});

/**
 * The general escrow's terms (aaron.escrow-general; decision payments.general-escrow). Every term is in the CREATE2 init
 * code, so an address names exactly one set of terms. `owner`: who collects, the recipient's account, which may not
 * exist yet. `sender`: where the money came from, the only address a refund pays. `authority` and `authorityKey`: zero,
 * or a view `authorised(uint256 key, address who) returns (bool)` that admits other callers to refund for the sender (v4
 * Budgets and a budget id). `bootstrapOwner`: zero, or an address the owner must no longer list among its owners before
 * it can collect (Companies House, for an email's Safe). `condition`: 0 the owner's claim stands in the terms and anyone
 * pays it out once the amount is held (an invoice); 1 the owner collects when it chooses. `ownerTakesSurplus`: a
 * collection's surplus goes to the owner, not back to the sender.
 */
const ESCROW_TERMS =
  "Terms(address owner, address sender, address authority, uint256 authorityKey, address bootstrapOwner, address token, uint256 amount, bytes32 jobNonce, uint16 kind, bytes32 documentHash, uint8 condition, bool ownerTakesSurplus)";

export const contract_escrow_factory = defineContract({
  id: "escrow-factory",
  code: "designed",
  title: "EscrowFactory, general (designed, not built): counterfactual address",
  about:
    "Deploys each escrow at the CREATE2 address of its terms and salt, known before it exists, so the money is sent " +
    "there first and the escrow deployed after, by anyone, in the same batch or later (`deploy` is idempotent and moves " +
    "no money). The init code binds every term (" + ESCROW_TERMS + ") and the factory's Payments, so another deploy at " +
    "that address can only be the same escrow. It is v4's factory with the general escrow's terms: it keeps v4's " +
    "constructor (Payments and the chain's Companies House) and its `bootstrapOwner()` view, which a terms builder reads " +
    "to fill the `bootstrapOwner` term (Exits from the factory it already holds), but each escrow checks only its own " +
    "term (decision payments.general-escrow). The build writes and deploys it with its escrow " +
    "(payments.escrow-contract-build); the devnet address is recorded once it is deployed.",
  functions: {
    deploy: {
      signature: "deploy(Terms terms, bytes32 salt) returns (address escrow)",
      about: "Deploys the escrow for its terms at its predicted address, or returns the one there. Anyone may send it, before or after the money arrives.",
    },
    predictAddress: { signature: "predictAddress(Terms terms, bytes32 salt) view returns (address)", about: "The escrow's address before it exists: where the money is sent." },
    predictPaymentId: {
      signature: "predictPaymentId(Terms terms, bytes32 salt) view returns (bytes32)",
      about: "The Payments id its one payment to the owner will carry (executor the escrow for an owner-collects escrow), known before anyone signs.",
    },
  },
  events: {
    EscrowDeployed: {
      signature: "EscrowDeployed(address indexed escrow, address indexed owner, address indexed sender, bytes32 paymentId, bytes32 salt)",
      about: "An escrow exists at its counterfactual address: what makes it, and the money already in it, known to indexing.",
    },
  },
  was: [`${V4}/interfaces/IEscrowFactory.sol:11`, `${V4}/money/EscrowFactory.sol:28`, `${ADDR}:49`],
});

export const contract_escrow = defineContract({
  id: "escrow",
  code: "designed",
  title: "Escrow, general (designed, not built): owner collects, sender takes back",
  about:
    "One contract per escrow at its counterfactual address (EscrowFactory), its terms immutable and public. It holds " +
    "one payment of `amount` of `token` for its `owner`, the recipient's account, which may not exist yet: for a " +
    "mailbox with no account, the Safe CompaniesHouseClaimer derives from it. Two ways out, and only two: the owner " +
    "collects, and the money goes to the owner through Payments (its PaymentSent, sender the escrow, settles the " +
    "Payment); or it is taken back, and the money goes to `sender`, where it came from. The owner may collect whenever " +
    "it chooses once it can act: it calls itself, and where `bootstrapOwner` is named it no longer lists that address " +
    "among its owners (D11, failing closed). The sender may take it back at any time until it is collected, even after " +
    "the owner can act (D12): the sender itself, or any caller the `authority` term admits for `authorityKey` at the " +
    "call, so a department's escrow (authority Budgets, key the budget id) is taken back by whoever " +
    "`Budgets.authorised` admits then, its hat's wearers or those above and the company Safe, while the money still " +
    "returns to the company Safe. An amount-reached escrow (an invoice) carries its owner's claim in its terms: anyone " +
    "pays it out once it holds the amount, and from then it cannot be taken back. No expiry. What changed from v4: " +
    "roles named for what they do (v4's `ownerSafe` is `sender`, `payeeSafe` is `owner`), the authority term, the " +
    "bootstrap owner as a term, the exit-claim lookup replaced by `ownerTakesSurplus`, `canRefund`, and `by` on " +
    "EscrowRefunded. Payments, Budgets and every other contract but Exits' terms builder stay as v4 has them " +
    "(decision payments.general-escrow).",
  functions: {
    collect: {
      signature: "collect()",
      about:
        "Owner-collects escrow: only the owner, once it can act and the escrow is open and holds the amount. Pays exactly " +
        "`amount` to the owner through Payments, the escrow its executor; any surplus to the sender, or to the owner with " +
        "`ownerTakesSurplus`.",
    },
    payout: {
      signature: "payout()",
      about: "Amount-reached escrow only: anyone pays the owner once it holds the amount, the surplus to the sender. An owner-collects escrow refuses it.",
    },
    refund: {
      signature: "refund()",
      about:
        "Takes the money back to the sender, whoever calls: the sender, or a caller the authority admits for its key now " +
        "(a revert or malformed answer refuses). While open: owner-collects until collected; amount-reached while short. " +
        "Once closed, it returns a later deposit.",
    },
    canRefund: {
      signature: "canRefund(address who) view returns (bool)",
      about: "Whether `who` may take it back now: the sender, or the authority's answer for its key, read the way `refund` reads it.",
    },
    state: { signature: "state() view returns (State)", about: "Open, Paid (collected or paid out) or Refunded (taken back)." },
  },
  events: {
    EscrowCreated: {
      signature:
        "EscrowCreated(address indexed owner, address indexed sender, bytes32 indexed paymentId, address token, uint256 amount, uint16 kind, bytes32 documentHash, uint8 condition, address authority, uint256 authorityKey)",
      about: "An escrow's terms, emitted when it is deployed: who collects, where a refund goes, and who else may take it back.",
    },
    EscrowPaid: {
      signature: "EscrowPaid(address indexed owner, address indexed sender, bytes32 indexed paymentId, uint256 amount)",
      about: "Collected by its owner, or paid out to it: beside the PaymentSent with the same payment id.",
    },
    EscrowRefunded: {
      signature: "EscrowRefunded(address indexed sender, address indexed by, bytes32 indexed paymentId, uint256 amount, State state)",
      about: "Taken back to its sender by `by` (state Refunded), or a later deposit returned (state Paid or Refunded, unchanged).",
    },
  },
  was: [`${V4}/interfaces/IEscrow.sol:30`, `${V4}/money/Escrow.sol:107-197`, "docs/planning/protocol-v4/spec/escrow.md"],
});

export const contract_escrow_factory_v4 = defineContract({
  id: "escrow-factory-v4",
  code: "built",
  artifact: "EscrowFactory",
  title: "EscrowFactory (built, v4): fixed-term escrows at their addresses",
  about:
    "What the code has (packages/contracts, v4): deploys each escrow at the CREATE2 address of its terms and salt, known before it exists, so money is sent there first and the escrow deployed after, by anyone (`deploy` is idempotent and moves no money). " +
    "The terms are `ownerSafe` (the payer, and where a refund goes), `payeeSafe`, token, amount, job nonce, kind, document hash and a condition (0 the invoice amount is held, 1 the payee's Safe is claimed). " +
    "The general escrow of `escrow-factory` is the design meant to replace it and is not built (decision contracts.general-escrow-not-built).",
  functions: {
    bootstrapOwner: { signature: "bootstrapOwner() view returns (address)", about: "The chain's Companies House Safe, the address a claim escrow's payee must no longer list among its owners." },
    deploy: { signature: "deploy(Terms terms, bytes32 salt) returns (address escrow)", about: "Deploys the escrow for its terms at its predicted address, or returns the one there. Anyone may send it, before or after the money arrives." },
    payments: { signature: "payments() view returns (address)", about: "The Payments contract every escrow pays through (set at deploy)." },
    predictAddress: { signature: "predictAddress(Terms terms, bytes32 salt) view returns (address)", about: "The escrow's address before it exists: where the money is sent. Refuses terms with a zero address, amount, job nonce or document hash, or a condition above 1." },
    predictPaymentId: { signature: "predictPaymentId(Terms terms, bytes32 salt) view returns (bytes32)", about: "The Payments id the escrow's one payment will carry, known before anyone signs (executor the escrow for a claim escrow)." },
  },
  events: {
    EscrowDeployed: { signature: "EscrowDeployed(address indexed escrow, address indexed ownerSafe, address indexed payeeSafe, bytes32 paymentId, bytes32 salt)", about: "An escrow exists at its predicted address: what makes it, and the money already in it, known to indexing." },
  },
  errors: {
    InvalidCondition: { signature: "InvalidCondition(uint8 condition)", about: "Terms with a condition above 1 (0 invoice amount reached, 1 payee claimed)." },
    ZeroAddress: { signature: "ZeroAddress()", about: "Terms with a zero owner, payee or token, or a zero Payments or bootstrap owner at construction." },
    ZeroAmount: { signature: "ZeroAmount()", about: "Terms with a zero amount." },
    ZeroDocumentHash: { signature: "ZeroDocumentHash()", about: "Terms with no document hash." },
    ZeroJobNonce: { signature: "ZeroJobNonce()", about: "Terms with no job nonce." },
  },
  was: ["packages/contracts/src/money/EscrowFactory.sol", "packages/contracts/src/interfaces/IEscrowFactory.sol", "decision contracts.general-escrow-not-built"],
});

export const contract_escrow_v4 = defineContract({
  id: "escrow-v4",
  code: "built",
  artifact: "Escrow",
  title: "Escrow (built, v4): one fixed payment, owner refunds, payee collects",
  about:
    "What the code has (packages/contracts, v4): one contract per escrow, its terms immutable and public. It holds one payment of `amount` of `token` for `payeeSafe`, released one of two ways. Condition 0 (an invoice): anyone calls `payout` once it holds the amount, and from then it cannot be refunded. Condition 1 (the payee claimed): `payeeSafe` calls `collect` once Companies House is no longer among its owners (read as isOwner(bootstrapOwner) answering exactly false; any other answer fails closed), and Payments records the escrow as the executor. " +
    "Only `ownerSafe`, the payer, may `refund`: an invoice escrow while open and short of the amount, a claim escrow while open even after the claim (D12), and any later deposit after Paid or Refunded. There is no authority term: a department's hat wearers cannot take an escrow back, only the Safe that funded it. A registered exit claim (the owner answers isExitClaimEscrow) sends its surplus to the payee, any other surplus returns to the owner. " +
    "The general escrow of `escrow` (sender, owner, authority, canRefund, ten-argument EscrowCreated) is the design meant to replace it and is not built (decision contracts.general-escrow-not-built).",
  functions: {
    CONDITION_INVOICE_AMOUNT_REACHED: { signature: "CONDITION_INVOICE_AMOUNT_REACHED() view returns (uint8)", about: "Condition 0: anyone may payout once the escrow holds the amount." },
    CONDITION_PAYEE_CLAIMED: { signature: "CONDITION_PAYEE_CLAIMED() view returns (uint8)", about: "Condition 1: the payee may collect once Companies House is not one of its owners." },
    amount: { signature: "amount() view returns (uint256)", about: "The amount paid to the payee." },
    bootstrapOwner: { signature: "bootstrapOwner() view returns (address)", about: "The chain's Companies House Safe, whose absence from the payee's owners is the claim." },
    collect: { signature: "collect()", about: "Claim escrow only: the payee Safe, once Companies House is no longer among its owners, collects: exactly `amount` to the payee through Payments (the escrow its executor), any surplus to the owner (to the payee for a registered exit claim)." },
    condition: { signature: "condition() view returns (uint8)", about: "The release condition: 0 invoice amount reached, 1 payee claimed." },
    conditionMet: { signature: "conditionMet() view returns (bool)", about: "Whether the release condition holds: for an invoice, the balance is at least the amount; for a claim, the payee has code and answers isOwner(bootstrapOwner) with exactly false (anything else fails closed)." },
    documentHash: { signature: "documentHash() view returns (bytes32)", about: "The document the payment settles." },
    jobNonce: { signature: "jobNonce() view returns (bytes32)", about: "The payment's job nonce." },
    kind: { signature: "kind() view returns (uint16)", about: "The payment kind." },
    ownerSafe: { signature: "ownerSafe() view returns (address)", about: "The payer Safe: the only address that may refund, and where a refund and any surplus go." },
    payeeSafe: { signature: "payeeSafe() view returns (address)", about: "The payee Safe, which may not exist yet: who is paid, and who collects a claim escrow." },
    paymentId: { signature: "paymentId() view returns (bytes32)", about: "The Payments id of the escrow's one payment." },
    payments: { signature: "payments() view returns (address)", about: "The Payments contract the escrow pays through." },
    payout: { signature: "payout()", about: "Invoice escrow only: anyone pays the payee once the escrow holds `amount`, the surplus back to the owner. A claim escrow refuses it." },
    refund: { signature: "refund()", about: "Only `ownerSafe`: takes the balance back while open (an invoice escrow only while short of the amount; a claim escrow even after the claim, until collected), or returns a later deposit after Paid or Refunded." },
    state: { signature: "state() view returns (State)", about: "Open, Paid or Refunded." },
    token: { signature: "token() view returns (address)", about: "The token held and paid." },
  },
  events: {
    EscrowCreated: { signature: "EscrowCreated(address indexed ownerSafe, address indexed payeeSafe, bytes32 indexed paymentId, address token, uint256 amount, uint16 kind, bytes32 documentHash, uint8 condition)", about: "An escrow's terms, emitted when it is deployed: payer, payee, token, amount, kind, document and condition." },
    EscrowPaid: { signature: "EscrowPaid(address indexed ownerSafe, address indexed payeeSafe, bytes32 indexed paymentId, uint256 amount)", about: "Collected by the payee or paid out to it: beside the PaymentSent with the same payment id." },
    EscrowRefunded: { signature: "EscrowRefunded(address indexed ownerSafe, bytes32 indexed paymentId, uint256 amount, State state)", about: "Taken back by the owner (state Refunded), or a later deposit returned (state unchanged). It does not name the payee." },
    InvoicePaymentCompleted: { signature: "InvoicePaymentCompleted(address indexed ownerSafe, address indexed payeeSafe, bytes32 indexed paymentId, uint256 surplus)", about: "An invoice escrow's payment id was already paid elsewhere: the escrow closes and returns its balance, the surplus, to the owner." },
  },
  errors: {
    ConditionMet: { signature: "ConditionMet()", about: "refund on an invoice escrow that already holds the amount: it can no longer be taken back." },
    ConditionNotMet: { signature: "ConditionNotMet()", about: "payout or collect before the release condition holds." },
    InexactTransfer: { signature: "InexactTransfer(address token, uint256 expected, uint256 received)", about: "An exit claim's payout moved a different amount than expected." },
    InsufficientFunding: { signature: "InsufficientFunding()", about: "payout or collect while the escrow holds less than the amount." },
    InsufficientGasForExitIdentity: { signature: "InsufficientGasForExitIdentity()", about: "Too little gas left to ask the owner whether this is an exit claim." },
    InvalidCondition: { signature: "InvalidCondition(uint8 condition)", about: "payout on a claim escrow, collect on an invoice escrow, or a condition above 1 at construction." },
    JobNotOpen: { signature: "JobNotOpen()", about: "payout or collect on an escrow already paid or refunded." },
    NotOwner: { signature: "NotOwner()", about: "refund from anyone but `ownerSafe`." },
    NotPayee: { signature: "NotPayee()", about: "collect from anyone but `payeeSafe`." },
    ReentrantCall: { signature: "ReentrantCall()", about: "A call back into the escrow while it runs." },
    TokenCallReturnedFalse: { signature: "TokenCallReturnedFalse(address token)", about: "The token answered false to a transfer or approval." },
    TokenHasNoCode: { signature: "TokenHasNoCode(address token)", about: "The token address holds no code." },
    ZeroAddress: { signature: "ZeroAddress()", about: "A zero owner, payee, token, Payments or bootstrap owner at construction." },
    ZeroAmount: { signature: "ZeroAmount()", about: "A zero amount at construction." },
    ZeroDocumentHash: { signature: "ZeroDocumentHash()", about: "No document hash at construction." },
    ZeroJobNonce: { signature: "ZeroJobNonce()", about: "No job nonce at construction." },
  },
  was: ["packages/contracts/src/money/Escrow.sol", "packages/contracts/src/interfaces/IEscrow.sol", "decision contracts.general-escrow-not-built"],
});

export const contract_agent_owner = defineContract({
  id: "agent-owner",
  code: "built",
  artifact: "AgentOwner",
  title: "AgentOwner: an agent's Safe under its owner",
  about:
    "One shared module and guard: deploys an agent's Safe with the agent's key as its one signer and the owner's Safe in " +
    "control, so the owner can freeze it, swap its key, sweep it and remove it, and the agent's key can never switch that off.",
  functions: {
    create: { signature: "create(address signer, address owner) returns (address safe)", about: "Deploys the agent's Safe, sent by the owner's Safe (the owner must be the caller); the agent has no authority until a hat is minted to its Safe." },
    freeze: { signature: "freeze(address safe)", about: "Freezes the agent." },
    unfreeze: { signature: "unfreeze(address safe)", about: "Unfreezes it." },
    swapSigner: { signature: "swapSigner(address safe, address oldSigner, address newSigner)", about: "Rotates the agent's key." },
    sweep: { signature: "sweep(address safe, address to, address token) returns (uint256 amount)", about: "Takes back what the agent holds (kind 9)." },
    remove: { signature: "remove(address safe, address[] tokens)", about: "Sweeps and removes the agent." },
    agentOf: { signature: "agentOf(address safe) view returns (Agent)", about: "An agent's owner, signer and frozen flag: the proof an agent's sign-in checks." },
    safeAddressFor: { signature: "safeAddressFor(address signer, address owner) view returns (address)", about: "The agent's Safe before it exists." },
    PAYMENTS: { signature: "PAYMENTS() view returns (address)", about: "The Payments contract a sweep moves money through (set at deploy)." },
    SWEEP_KIND: { signature: "SWEEP_KIND() view returns (uint16)", about: "The payment kind a sweep stamps: 9." },
    checkAfterExecution: { signature: "checkAfterExecution(bytes32, bool) pure", about: "The transaction guard's after-hook: does nothing." },
    checkAfterModuleExecution: { signature: "checkAfterModuleExecution(bytes32, bool) pure", about: "The module guard's after-hook: does nothing." },
    checkModuleTransaction: { signature: "checkModuleTransaction(address to, uint256, bytes, uint8 operation, address module) view returns (bytes32)", about: "The Safe's module guard: refuses a module call to the Safe itself or a delegatecall, and any module call while the agent is frozen or removed, unless AgentOwner makes it." },
    checkTransaction: { signature: "checkTransaction(address to, uint256, bytes, uint8 operation, uint256, uint256, uint256, address, address, bytes, address) view", about: "The Safe's transaction guard: refuses a transaction the agent's key signs that calls the agent's own Safe or delegatecalls (AgentSelfCall)." },
    supportsInterface: { signature: "supportsInterface(bytes4 interfaceId) pure returns (bool)", about: "ERC-165, so a Safe accepts this contract as a transaction and module guard." },
    sweeps: { signature: "sweeps(address safe) view returns (uint256)", about: "How many sweeps an agent's Safe has paid: the counter in each sweep's job nonce." },
  },
  events: {
    AgentCreated: { signature: "AgentCreated(address indexed safe, address indexed owner, address indexed signer)", about: "An agent exists." },
    AgentFrozen: { signature: "AgentFrozen(address indexed safe)", about: "Frozen." },
    AgentUnfrozen: { signature: "AgentUnfrozen(address indexed safe)", about: "Unfrozen." },
    AgentSignerSwapped: { signature: "AgentSignerSwapped(address indexed safe, address oldSigner, address newSigner)", about: "Key rotated." },
    AgentSwept: { signature: "AgentSwept(address indexed safe, address indexed to, address indexed token, uint256 amount)", about: "Swept." },
    AgentRemoved: { signature: "AgentRemoved(address indexed safe)", about: "Removed." },
  },
  errors: {
    AgentExists: { signature: "AgentExists(address safe)", about: "create for a Safe that already belongs to an agent." },
    AgentInactive: { signature: "AgentInactive(address safe)", about: "A module call, such as a 4337 user operation, while the agent is frozen or removed." },
    AgentIsRemoved: { signature: "AgentIsRemoved(address safe)", about: "An owner power used on an agent that was removed." },
    AgentSelfCall: { signature: "AgentSelfCall(address safe, address to, uint8 operation)", about: "The agent's key tried to call its own Safe or to delegatecall: only its owner changes the Safe." },
    AlreadyFrozen: { signature: "AlreadyFrozen(address safe)", about: "freeze on an agent already frozen." },
    DerivedAddressMismatch: { signature: "DerivedAddressMismatch(address expected, address deployed)", about: "The Safe factory deployed somewhere other than the derived address." },
    InvalidRecipient: { signature: "InvalidRecipient()", about: "A sweep to the zero address or to the agent's own Safe." },
    InvalidSigner: { signature: "InvalidSigner()", about: "A signer that is zero, the owners sentinel, AgentOwner itself or the owner." },
    ModuleCallFailed: { signature: "ModuleCallFailed(address safe)", about: "The agent's Safe refused or failed a module call (a sweep's approve, a swap)." },
    NotFrozen: { signature: "NotFrozen(address safe)", about: "unfreeze on an agent that is not frozen." },
    NotOwner: { signature: "NotOwner(address caller)", about: "The caller is not the owner: create must be sent by the owner's Safe, every other power by the agent's owner." },
    SignerMismatch: { signature: "SignerMismatch(address expected, address supplied)", about: "swapSigner with an old signer that is not the agent's key." },
    UnknownAgent: { signature: "UnknownAgent(address safe)", about: "No agent has this Safe." },
    ZeroPayments: { signature: "ZeroPayments()", about: "A zero Payments address at construction." },
  },
  was: [`${V4}/agents/AgentOwner.sol:123`, `${ADDR}:58`],
});

// ── contracts: equity (low priority) ────────────────────────────────────────────────────────

// ── contracts: third-party, wired by the v4 install ─────────────────────────────────────────

export const contract_safe = defineContract({
  id: "safe",
  code: "third-party",
  title: "Safe 1.5.0: personal, agent and company Safes",
  about:
    "Every Safe: a person's (owned by their signer), an agent's (under AgentOwner) and a company's (behind the Signer Gate). " +
    "A Board proposal is one company Safe transaction: each Director approves its hash from their own Safe, and the last " +
    "approval executes it with v=1 signatures. Version 1.5.0 (SafeL2 and its proxy factory): every person's, agent's and company Safe the code creates is on it; only MultiSendCallOnly and CreateCall are 1.4.1 (packages/contracts/README.md). One proxy per Safe, so no address is listed.",
  functions: {
    approveHash: { signature: "approveHash(bytes32 hashToApprove)", about: "A Director's approval of a Board proposal, from their own Safe." },
    execTransaction: {
      signature:
        "execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
      about: "Runs a Board proposal, or a founder's install batch on the company Safe from the founder's Safe.",
    },
    getOwners: { signature: "getOwners() view returns (address[])", about: "A Safe's owners: an agent's sign-in proof, a Board's signers." },
    getThreshold: { signature: "getThreshold() view returns (uint256)", about: "How many approvals a Board proposal needs." },
    nonce: { signature: "nonce() view returns (uint256)", about: "The Safe transaction nonce, read with owners and threshold at the same pinned block when planning a Board proposal." },
  },
  events: {
    ApproveHash: { signature: "ApproveHash(bytes32 indexed approvedHash, address indexed owner)", about: "A Director approved a proposal." },
    ExecutionSuccess: { signature: "ExecutionSuccess(bytes32 indexed txHash, uint256 payment)", about: "A proposal executed." },
    ExecutionFailure: { signature: "ExecutionFailure(bytes32 indexed txHash, uint256 payment)", about: "A proposal ran and failed." },
    // The owner is indexed in Safe 1.5.0: on the seeded world each AddedOwner and RemovedOwner log has two topics and no
    // data (eth_getLogs, 12 November 2026, docs/mission/world-cost.md); the old indexer's ABI had it unindexed.
    AddedOwner: { signature: "AddedOwner(address indexed owner)", about: "A signer added (a Director seated)." },
    RemovedOwner: { signature: "RemovedOwner(address indexed owner)", about: "A signer removed." },
    ChangedThreshold: { signature: "ChangedThreshold(uint256 threshold)", about: "The threshold changed." },
  },
  was: [`${SAFE}:26`, "apps/indexer/src/abis.ts:12"],
});

export const contract_safe_4337_module = defineContract({
  id: "safe-4337-module",
  code: "third-party",
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
  code: "third-party",
  title: "MultiSendCallOnly: ordered call batches",
  about: "Delegatecalled to run an approval's calls in order (a token approve then a Payments.send) and to pack a Board batch.",
  addresses: { [DEV]: "0x9641d764fc13c8b624c04430c7356c1c7c8102e2" },
  functions: { multiSend: { signature: "multiSend(bytes transactions)", about: "Packed calls, each a plain call." } },
  events: {},
  was: [`${SAFE}:171`],
});

export const contract_entry_point = defineContract({
  id: "entry-point",
  code: "third-party",
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
  code: "third-party",
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
  code: "third-party",
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
  code: "third-party",
  title: "Hats Signer Gate v2: the Board's signers",
  about:
    "One proxy per company, the company Safe's only module and guard: the Safe's signers are exactly the Director hat's " +
    "wearers who claimed, and the Gate keeps the threshold. One proxy each, so no address is listed.",
  functions: {
    claimSigner: { signature: "claimSigner(uint256 hatId)", about: "An elected Director claims their seat." },
    claimSignerFor: { signature: "claimSignerFor(uint256 hatId, address signer)", about: "Seats a Director the founder added." },
    removeSigner: { signature: "removeSigner(address signer)", about: "Removes a signer whose hat lapsed." },
    setThresholdConfig: { signature: "setThresholdConfig(ThresholdConfig thresholdConfig)", about: "Sets the Board's threshold." },
    thresholdConfig: { signature: "thresholdConfig() view returns ((uint8 thresholdType, uint120 min, uint120 target) config)", about: "Reads the Gate's configured threshold rule; Board combines it with live owners and signer validity for lapsed-owner cleanup." },
    isValidSigner: { signature: "isValidSigner(address account) view returns (bool valid)", about: "Whether a Director still wears the hat." },
  },
  events: {},
  was: [`${V4}/interfaces/external/IHatsSignerGate.sol:56`, "packages/protocol/src/evm/company-gate.ts"],
});

export const contract_erc20 = defineContract({
  id: "erc20",
  code: "third-party",
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
