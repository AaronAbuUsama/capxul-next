// The outside systems the old payments concept and the Core SDK's payments code call, and the
// on-chain contracts payments builds calls for or reads events from, as the old code has them.
// Old code: /home/user/factory (integration/factory). Evidence paths are relative to that root.

import { defineContract, defineIntegration } from "../../../packages/book/src/index.ts";
import { component_convex_backend, component_core_sdk } from "./foundation.ts";
import {
  error_ENV_MISSING,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SIGNER_REJECTED,
} from "./vocabulary.ts";

const RPC = "packages/backend/src/integrations/chain-rpc";
const EVIDENCE = "packages/backend/src/integrations/chain-evidence";
const PONDER = "packages/backend/src/integrations/ponder";
const MAIL = "packages/backend/src/integrations/mail";
const PAY = "packages/backend/src/payments";
const SIGNING = "packages/sdk/src/signing";
const SDK_PAY = "packages/sdk/src/payments";
const EVM = "packages/protocol/src/evm";
const DEVNET = "packages/devnet/src/modules/devnet/service.ts";

// ── shared call shapes of chain-rpc ─────────────────────────────────────────────────────────

/** A node read: 30 s per attempt, tried on each configured node in order (at most 4), no wait between. */
const NODE = { timeoutMs: 30_000, retries: { max: 3, backoff: "none" } } as const;
/** A bundler or paymaster method: one 30 s attempt through the owned AA Gateway, no other upstream. */
const GATEWAY = { timeoutMs: 30_000, retries: { max: 0, backoff: "none" } } as const;

const nodeFailures = [
  {
    when: "Every configured node timed out, was down or throttled (modes timeout, upstream-down, rate-limited), each tried in order",
    error: error_PROVIDER_ERROR,
  },
  {
    when: "A node gave a final JSON-RPC verdict on the request (a revert or a bad request), or the last node refused it over HTTP",
    error: error_PROVIDER_ERROR,
  },
  { when: "The answer had the wrong shape: rpcProviderError, mode upstream-down", error: error_PROVIDER_ERROR },
  { when: "The chain id has no configured node list (only 84532 and 8453 have one)", error: error_INVALID_INPUT },
] as const;

const gatewayFailures = [
  {
    when: "The AA Gateway did not answer in 30 s, was down or throttled; there is no second upstream for bundler methods",
    error: error_PROVIDER_ERROR,
  },
  {
    when: "The gateway refused the request: a bundler validation rejection (mode rejected), a simulation revert, a bad request or a refused token",
    error: error_PROVIDER_ERROR,
  },
  { when: "The answer had the wrong shape: rpcProviderError, mode upstream-down", error: error_PROVIDER_ERROR },
  { when: "BASE_SEPOLIA_BUNDLER_RPC_URL is not set (accountAbstractionUrl)", error: error_ENV_MISSING },
  { when: "The chain is not Base Sepolia (84532): the owned account-abstraction rail serves no other chain", error: error_INVALID_INPUT },
] as const;

// ── chain-rpc ───────────────────────────────────────────────────────────────────────────────

export const integration_chain_rpc = defineIntegration({
  id: "chain-rpc",
  title: "Chain JSON-RPC: Base nodes and the AA Gateway",
  about:
    "All backend JSON-RPC access, behind the Effect service `ChainRpc`. Node methods go to the configured Base node list " +
    "(`<CHAIN>_RPC_URLS`, at most four, `node_1` first, else the older per-provider names, else the public Base node) and move to " +
    "the next node on any HTTP failure or a throttle, internal error or unsupported method; a JSON-RPC verdict on the request is " +
    "final. Bundler and paymaster methods (eth_sendUserOperation, eth_estimateUserOperationGas, eth_getUserOperationReceipt, " +
    "eth_getUserOperationByHash, pm_getPaymasterStubData, pm_getPaymasterData) go to the owned AA Gateway in one attempt. Each " +
    "attempt is bounded by BOUNDED_RPC_TIMEOUT_MS (30 s) unless the caller names a timeout; payments names none and passes no " +
    "total budget. Every failure is a CapxulError: no usable answer is PROVIDER_ERROR through providerUnavailable, a refusal is " +
    "PROVIDER_ERROR through providerRefused, and a malformed answer is PROVIDER_ERROR mode upstream-down. Payments provides " +
    "`ChainRpcLive` at each chain-reading operation (`withChain`) and admits only the codes each call site names: a code outside " +
    "the admitted list (INVALID_INPUT from fetchEthCall, for one) becomes a defect there. The service also exports caller checks " +
    "payments applies: sentHashConflict, rolesRefusal, typedSponsorshipFailure and sponsorshipValidUntilMs, booked on the calls " +
    "they follow. Recovered fallbacks emit `chain_upstream_fallback`. Building the layer reads both Base chains' node settings " +
    "(84532 and 8453). The AA Gateway's token is a path segment of BASE_SEPOLIA_BUNDLER_RPC_URL; the backend reads no gateway " +
    "secret of its own.",
  was: [
    `${RPC}/service.ts:57`,
    `${RPC}/internal/upstreams.ts:38`,
    "packages/aa-gateway/README.md:57",
    `${RPC}/service.ts:139`,
    `${RPC}/service.ts:171`,
    `${RPC}/README.md:59`,
    `${RPC}/internal/requests.ts:140`,
    `${RPC}/internal/requests.ts:152`,
    `${RPC}/internal/requests.ts:188`,
    `${RPC}/internal/upstreams.ts:18`,
    `${RPC}/internal/rpcErrors.ts:85`,
    `${RPC}/internal/rpcErrors.ts:113`,
    `${RPC}/internal/rpcErrors.ts:125`,
    `${RPC}/internal/rpcErrors.ts:155`,
    `${RPC}/internal/quantities.ts:8`,
    `${RPC}/internal/userOperationWait.ts:30`,
    `${RPC}/internal/transactions.ts:58`,
    `${RPC}/internal/userOperationReceipts.ts:106`,
    `${EVM}/rpc-endpoints.ts:12`,
    `${PAY}/external.ts:8`,
    "packages/backend/src/platform/attempt.ts:37",
  ],
  component: component_convex_backend,
  system: "evm-json-rpc",
  service: "@capxul/backend/ChainRpc",
  calls: {
    fetchEthCall: {
      about:
        "eth_call at `latest`; `0x` is refused. Payments reads Budgets.scheduledOf, scheduledCount and leftOf, and a Roles module's " +
        "allowances(key), with it (board-budgets.ts:60, budget-executor.ts:56, commands/external/funding.ts:72 and 129).",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The node answered `0x`: no code at the address or an empty return (mode unknown)", error: error_PROVIDER_ERROR },
      ],
    },
    fetchCode: {
      about:
        "eth_getCode at `latest`. Payments reads a Roles module's runtime code to check it is a proxy of an admitted mastercopy " +
        "(commands/external/roles-modules.ts:19).",
      ...NODE,
      failures: [...nodeFailures],
    },
    fetchErc20Balance: {
      about:
        "ERC-20 balanceOf(holder) via eth_call, as a base-10 string. Payments reads the sender Safe's balance of each token a " +
        "command pays before it builds (executions/external/funding.ts:36), with no total budget.",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The token answered `0x` to balanceOf (mode unknown), or a value that is not hex", error: error_PROVIDER_ERROR },
        { when: "The holder is not 0x and 40 hex characters", error: error_INVALID_INPUT },
      ],
    },
    fetchLatestBlock: {
      about:
        "eth_getBlockByNumber(`latest`) through the bounded block read. Payments reads the block time a Roles allowance accrues to " +
        "and the chain clock a dated budget payment waits for (commands/external/funding.ts:51, budget-executor.ts:72).",
      ...NODE,
      failures: [...nodeFailures, { when: "The node answered no latest block (noLatestBlock, mode upstream-down)", error: error_PROVIDER_ERROR }],
    },
    fetchLatestBlockNumber: {
      about:
        "eth_blockNumber. Payments reads an Attempt's EntryPoint scan floor before it builds or sends " +
        "(executions/external/builds.ts:102, preflights.ts:64).",
      ...NODE,
      failures: [...nodeFailures],
    },
    fetchEntryPointNonce: {
      about:
        "EntryPoint v0.7 getNonce(sender, key) via eth_call: the next nonce on one 4337 lane. Payments reads the lane before a build, " +
        "at preflight, at lane recovery and when it classifies an Attempt (safes.ts:164, preflights.ts:66, lanes.ts:85, attempts.ts:79).",
      ...NODE,
      failures: [...nodeFailures, { when: "The answer is not a nonce, or is a nonce on another key", error: error_PROVIDER_ERROR }],
    },
    fetchEntryPointUserOperationEvent: {
      about:
        "The one EntryPoint UserOperationEvent that consumed a sender's nonce: eth_blockNumber, then eth_getLogs pages of 10,000 " +
        "blocks from the scan floor to the head, each 30 s, on the nodes that take wide log reads. The A06 hold applies. Used by lanes.ts:103 and attempts.ts:87.",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "A log lies outside the requested page, does not decode, or two events match one sender nonce", error: error_PROVIDER_ERROR },
        { when: "fromBlock is negative or not a safe integer, or the nonce is not a uint256", error: error_INVALID_INPUT },
      ],
    },
    fetchUserOperationReceipt: {
      about:
        "A UserOperation's receipt: from the recorded transaction's eth_getTransactionReceipt on the nodes when one is named, else " +
        "eth_getUserOperationReceipt on the gateway; null while none. The A06 receipt hold applies here. Used by attempts.ts:71 and " +
        "verifications/external.ts:222.",
      ...GATEWAY,
      failures: [
        ...gatewayFailures,
        {
          when: "With a recorded transaction hash (verifications/external.ts:222), its eth_getTransactionReceipt failed on the nodes as any node read does",
          error: error_PROVIDER_ERROR,
        },
      ],
    },
    hasUserOperationByHash: {
      about:
        "Whether the bundler knows one UserOperation: eth_getUserOperationByHash on the gateway, checked against the hash; a null or " +
        "failed lookup falls back to the receipt read once. Payments looks before a send and after a refused one (sends.ts:145, 174, " +
        "214; recoveries.ts:163).",
      ...GATEWAY,
      failures: [
        ...gatewayFailures,
        { when: "The bundler's operation or receipt hashes to another UserOperation hash", error: error_PROVIDER_ERROR },
        { when: "The hash is not 0x and 32 bytes", error: error_INVALID_INPUT },
      ],
    },
    fetchUserOperationFees: {
      about:
        "eth_maxPriorityFeePerGas and eth_getBlockByNumber(`latest`) on the nodes: maxFeePerGas is twice the base fee plus the " +
        "priority fee. Payments triples maxFeePerGas for a scheduled payment (safes.ts:169, SCHEDULED_FEE_MULTIPLIER).",
      ...NODE,
      failures: [...nodeFailures, { when: "The latest block has no baseFeePerGas, or a fee is not a quantity", error: error_PROVIDER_ERROR }],
    },
    sponsorUserOperation: {
      about:
        "ERC-7677 sponsorship: pm_getPaymasterStubData, eth_estimateUserOperationGas, pm_getPaymasterData with the window, one 30 s " +
        "attempt each. Payments maps failures with typedSponsorshipFailure (safes.ts:196) and rolesRefusal (builds.ts:131) and reads " +
        "sponsorshipValidUntilMs (builds.ts:146).",
      ...GATEWAY,
      failures: [
        ...gatewayFailures,
        { when: "The final paymaster answer has no paymaster or no paymasterData", error: error_PROVIDER_ERROR },
        { when: "The simulation reverted with the token's ERC20InsufficientBalance (typedSponsorshipFailure)", error: error_INSUFFICIENT_BALANCE },
        {
          when: "The simulation reverted in Zodiac Roles with ConditionViolation or NoMembership (rolesRefusal)",
          error: error_ROLE_PERMISSION_DENIED,
        },
        {
          when: "paymasterData is too short or not hex to hold a window, or its validUntil is zero or unsafe (sponsorshipValidUntilMs)",
          error: error_PROVIDER_RESPONSE_INVALID,
        },
      ],
    },
    sendUserOperation: {
      about:
        "eth_sendUserOperation on the gateway, once; returns the UserOperation hash. Payments records a witness row for every attempt " +
        "and checks the hash with sentHashConflict (sends.ts:151 and 217).",
      ...GATEWAY,
      failures: [
        ...gatewayFailures,
        { when: "The bundler answered a value that is not a 32-byte hash", error: error_PROVIDER_ERROR },
        { when: "The bundler answered another operation's hash (sentHashConflict, problem conflict)", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    prepareTransaction: {
      about:
        "An EOA type-2 transaction prepared from the nodes: eth_getTransactionCount(pending), the two fee reads, an eth_call " +
        "simulation and eth_estimateGas, each 30 s. Payments prepares Budgets.execute from BUDGETS_EXECUTOR_PRIVATE_KEY (budget-executor.ts:74).",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The gas estimate is not a quantity or is zero", error: error_PROVIDER_ERROR },
        {
          when: "The caller's sender, to or data is malformed: checked with the provider-answer readers, so it fails as the provider's upstream-down",
          error: error_PROVIDER_ERROR,
        },
      ],
    },
    broadcastTransaction: {
      about:
        "eth_sendRawTransaction of signed type-2 bytes on the node list; the answered hash must be the keccak of those bytes. " +
        "Payments signs the executor's Budgets.execute and broadcasts it at once, storing nothing (budget-executor.ts:80 and 94).",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The node answered another transaction hash", error: error_PROVIDER_ERROR },
        { when: "The bytes are not a type-2 signed transaction", error: error_INVALID_INPUT },
      ],
    },
    waitForTransactionReceipt: {
      about:
        "Polls eth_getTransactionReceipt on the nodes every 2 s until a receipt, reverted or not; the 120 s RECEIPT_TIMEOUT_MS is " +
        "checked between polls only. A failed poll ends the wait. Payments waits on the executor's Budgets.execute (budget-executor.ts:99).",
      timeoutMs: 120_000,
      retries: { max: 3, backoff: "none" },
      failures: [
        ...nodeFailures,
        {
          when: "No receipt by the 120 s deadline (receiptWaitTimedOut: provider account-abstraction, mode timeout)",
          error: error_PROVIDER_ERROR,
        },
      ],
    },
  },
  fake:
    "The devnet runs a local fork of Base Sepolia (chain 84532) as the only node (BASE_SEPOLIA_RPC_URL and " +
    "BASE_SEPOLIA_EVIDENCE_RPC_URL both name it) and a local bundler with the paymaster gateway on 127.0.0.1 " +
    "(BASE_SEPOLIA_BUNDLER_RPC_URL). With one node it cannot show the fallback between upstreams or a hosted key's refusal. " +
    "Tests replace methods through makeChainRpcLayer overrides.",
  secrets: [
    "BASE_SEPOLIA_RPC_URLS",
    "BASE_SEPOLIA_LOG_RPC_URLS",
    "BASE_SEPOLIA_RPC_URL",
    "BASE_SEPOLIA_EVIDENCE_RPC_URL",
    "BASE_SEPOLIA_ALCHEMY_RPC_URL",
    "BASE_SEPOLIA_INFURA_RPC_URL",
    "BASE_SEPOLIA_BUNDLER_RPC_URL",
    "BASE_MAINNET_RPC_URLS",
    "BASE_MAINNET_LOG_RPC_URLS",
    "BASE_MAINNET_RPC_URL",
    "BASE_MAINNET_EVIDENCE_RPC_URL",
    "BASE_MAINNET_ALCHEMY_RPC_URL",
    "BASE_MAINNET_INFURA_RPC_URL",
  ],
});

// ── chain-evidence ──────────────────────────────────────────────────────────────────────────

export const integration_chain_evidence = defineIntegration({
  id: "chain-evidence",
  title: "Chain evidence: Payment receipts verified",
  about:
    "Reads and verifies Base Sepolia evidence over chain-rpc and, when command fate reads Ponder, over the Ponder reader. It " +
    "writes nothing. Payments builds it with productionChainEvidence(\"payment-attempt\"), which caches the receipt, transaction " +
    "receipt and block reads of one attempt, and calls verifyPayment for every expected Payment at once (verifications/external.ts:105). " +
    "With COMMAND_FATE_READ_SOURCE unset or `rpc` the receipt-backed reader answers; with `ponder` a send is verified from the " +
    "indexed PaymentSent and Transfer facts and then the canonical receipt, and commitments keep the receipt path. A provider read " +
    "the verifier classifies becomes the `provider_failure` result, not an error, and a missing indexed fact is `pending`. An " +
    "unrecognized COMMAND_FATE_READ_SOURCE, or a Ponder reader that cannot be built, dies as a defect. Every chain or indexer read " +
    "inside the verifier is classified (readEvidence, or any Error on the Ponder path) to `provider_failure`, so the declared " +
    "PROVIDER_ERROR and ENV_MISSING are not known to be reached. Payments also imports three pure helpers that call nothing: " +
    "boundSettlementTransfer (verifications/external.ts:21), settlementTermsMismatch (writes/settlements.ts:10) and " +
    "decodeRolesAllowance (commands/external/funding.ts:16).",
  was: [
    `${EVIDENCE}/service.ts:76`,
    `${EVIDENCE}/service.ts:173`,
    `${EVIDENCE}/service.ts:186`,
    `${EVIDENCE}/service.ts:219`,
    `${EVIDENCE}/README.md:66`,
    `${EVIDENCE}/internal/receipt-context.ts:100`,
    `${EVIDENCE}/internal/receipt-context.ts:112`,
    `${EVIDENCE}/internal/receipt-context.ts:121`,
    `${EVIDENCE}/internal/payment-receipt.ts:49`,
    `${EVIDENCE}/internal/payment-receipt.ts:102`,
    `${EVIDENCE}/internal/indexed-payment.ts:70`,
    `${EVIDENCE}/internal/indexed-payment.ts:185`,
    `${EVIDENCE}/internal/indexed-payment.ts:194`,
    `${PONDER}/pages.ts:65`,
    `${PAY}/verifications/external.ts:21`,
    `${EVIDENCE}/settlements.ts:4`,
    `${EVIDENCE}/rolesAllowance.ts:17`,
    `${PAY}/verifications/external.ts:103`,
    `${PAY}/writes/settlements.ts:10`,
    `${PAY}/commands/external/funding.ts:16`,
  ],
  component: component_convex_backend,
  system: "chain-evidence",
  service: "ChainEvidence (productionChainEvidence)",
  calls: {
    verifyPayment: {
      about:
        "One expected Payment's send, or commitment create, claim, cancel or redirect, checked against its receipt, events and " +
        "Transfer. Never retried: each chain read is a chain-rpc read (30 s an attempt); on `ponder` an unindexed fact is re-read " +
        "after 2, 4, 8 s.",
      timeoutMs: 30_000,
      retries: { max: 0, backoff: "none" },
      failures: [
        {
          when: "Declared by ChainEvidenceFailure for a PROVIDER_ERROR outside a classified read; no such site is known (reads give provider_failure)",
          error: error_PROVIDER_ERROR,
        },
        {
          when: "Declared by ChainEvidenceFailure; a missing BASE_SEPOLIA_BUNDLER_RPC_URL is classified to the provider_failure result instead",
          error: error_ENV_MISSING,
        },
      ],
    },
  },
  fake:
    "No double of its own: on the devnet it reads the devnet chain-rpc and the devnet Ponder indexer. The devnet sets INDEXER_URL " +
    "but not COMMAND_FATE_READ_SOURCE, so it answers from receipts. Tests use the conformance fixtures under its tests/.",
  secrets: [],
});

// ── ponder ──────────────────────────────────────────────────────────────────────────────────

const ponderFailures = [
  {
    when: "The indexer did not answer in 5 s, failed in transit, or answered 5xx or 429 (provider-unavailable; isPonderUnavailable)",
    error: error_PROVIDER_ERROR,
  },
  { when: "The indexer refused the request with another failure status, 400, 404 and 422 included (providerRefused)", error: error_PROVIDER_ERROR },
  { when: "A successful answer that is not JSON or does not decode as the pinned rows", error: error_PROVIDER_RESPONSE_INVALID },
  {
    when: "The reader cannot be built: INDEXER_URL unset (upstream-down) or INDEXER_SERVICE_TOKEN unset (defect)",
    error: error_PROVIDER_ERROR,
  },
] as const;

export const integration_ponder = defineIntegration({
  id: "ponder",
  title: "Ponder indexer: indexed payment and transfer facts",
  about:
    "The backend's reader of the Ponder read model, behind the Effect service `PonderFacts`. Every request is one GET to " +
    "`/sql/db` carrying one pinned statement, with the service bearer, through callProvider with REQUEST_TIMEOUT_MS (5 s) and no " +
    "retry. It gives callProvider no refusal reader and no body limit, so the door's INVALID_INPUT and too-long branches never " +
    "apply and an answer is read whole. Payments settles open Payments from it (D2): `payments.verifications.settle` provides PonderFactsLive, reads each open " +
    "Payment's fact four at a time, and treats an unavailable indexer (isPonderUnavailable) as every Payment still pending; any " +
    "other failure fails the action. Payments also reads COMMAND_FATE_READ_SOURCE through commandFateReadSource to stamp a fact's " +
    "identity (verify.ts:156); that reads the environment, not the indexer.",
  was: [
    `${PONDER}/service.ts:45`,
    `${PONDER}/service.ts:50`,
    `${PONDER}/service.ts:59`,
    `${PONDER}/service.ts:105`,
    `${PONDER}/service.ts:123`,
    `${PONDER}/service.ts:146`,
    `${PONDER}/service.ts:224`,
    `${PONDER}/pages.ts:16`,
    `${PONDER}/pages.ts:37`,
    `${PONDER}/pages.ts:118`,
    `${PONDER}/pages.ts:141`,
    "packages/backend/src/platform/provider.ts:73",
    "packages/backend/src/platform/provider.ts:91",
    "packages/backend/src/platform/provider.ts:147",
    "packages/backend/src/platform/provider.ts:168",
    `${PAY}/verifications/operations/settle.ts:45`,
    `${PAY}/verifications/operations/settle.ts:55`,
    `${PAY}/verifications/operations/verify.ts:156`,
  ],
  component: component_convex_backend,
  system: "ponder",
  service: "@capxul/backend/PonderFacts",
  calls: {
    lookupPayment: {
      about:
        "The indexed PaymentSent rows for one settlement id, without a Safe (paymentLookupStatement); an absent settlement is an " +
        "empty page. Payments asks for 2 and keeps only the row on the Payment's own router (verifications/external.ts:45).",
      timeoutMs: 5_000,
      retries: { max: 0, backoff: "none" },
      failures: [...ponderFailures],
    },
    readTransactionFacts: {
      about:
        "Every `payment` or `transfer` row of one transaction, in pages of 200, until a short page or the 14 s fact budget ends; " +
        "`complete: false` when the budget ends first. Payments reads the Transfers a fact settled (verifications/external.ts:48).",
      timeoutMs: 5_000,
      retries: { max: 0, backoff: "none" },
      failures: [...ponderFailures],
    },
  },
  fake: "The devnet runs a local Ponder indexer at 127.0.0.1:42069 over its forked chain, with a fixed devnet service token.",
  secrets: ["INDEXER_SERVICE_TOKEN"],
});

// ── mail ────────────────────────────────────────────────────────────────────────────────────

export const integration_mail = defineIntegration({
  id: "mail",
  title: "Email: scheduled payment notices",
  about:
    "Transactional email through the Convex Resend component (@convex-dev/resend), which queues each accepted message durably and " +
    "retries its delivery itself. Payments' notify action sends a scheduled payment's notices with deliverNotices " +
    "(notices/external.ts:36). deliverNotices returns each failure as a value: it rejects only when the entry did not load the " +
    "Resend client or the retry cannot be scheduled, which payments' Effect.promise makes a defect. Each recipient's outcome is " +
    "kept in the delivery record " +
    "(operator.notices.record), a message the component did not take is the value PROVIDER_ERROR (provider resend, mode unknown) " +
    "logged as [CAPXUL_MAIL_FAILED], and the result counts sent and failed. While attempts remain the failed recipients are handed " +
    "to the caller's retry, which schedules the notify action again for them only.",
  was: [
    `${MAIL}/notices.ts:17`,
    `${MAIL}/notices.ts:20`,
    `${MAIL}/notices.ts:132`,
    `${MAIL}/service.ts:125`,
    `${MAIL}/service.ts:147`,
    `${MAIL}/service.ts:149`,
    `${MAIL}/notices.ts:164`,
    `${MAIL}/resend.ts:12`,
    `${PAY}/notices/external.ts:29`,
  ],
  component: component_convex_backend,
  system: "resend",
  service: "sendMail (@convex-dev/resend)",
  calls: {
    deliverNotices: {
      about:
        "One email per planned notice and recipient. No timeout of its own: it runs inside the notify action, which Convex ends at " +
        "ten minutes (ponder/pages.ts:40). Three tries in all, the waits one minute then four (60 s × 4^attempt).",
      timeoutMs: 600_000,
      retries: { max: 2, backoff: "exponential" },
      failures: [],
    },
  },
  fake:
    "On the devnet (resolveCapxulEnv() is `local`) a message is kept in the mail sink (operator.outboxes.record) and nothing is " +
    "sent; `capxul dev mail fail` arms a switch that refuses it, which the caller sees as the same PROVIDER_ERROR outcome.",
  secrets: ["RESEND_API_KEY"],
});

// ── openfort (client-hosted signer) ─────────────────────────────────────────────────────────

export const integration_openfort = defineIntegration({
  id: "openfort",
  title: "Openfort embedded signer in the Core SDK",
  about:
    "The Core SDK's payments code signs through the consumer's CapxulSigner: getAddress, then signUserOpHash over the SafeOp digest " +
    "the backend prepared (command-execution.ts:107 and 226; execution.ts:195 and 243). The Openfort embedded signer reads the " +
    "embedded wallet and signs the raw digest with signMessage (no EIP-191 prefix), then checks the signature recovers the wallet " +
    "address. The same port may instead be an injected EIP-1193 wallet (eth_requestAccounts, eth_sign) or a local key signer; " +
    "neither has a timeout or retry in the code. Every throw is folded by signerFailure into SIGNER_REJECTED, PROVIDER_ERROR or " +
    "PROVIDER_RESPONSE_INVALID. No Capxul timeout bounds either call: 30 s is Openfort's own request timeout as the code describes " +
    "it, and Openfort's iframe RPC timeout value is not in the repo.",
  was: [
    `${SIGNING}/signer.ts:47`,
    `${SIGNING}/signer.ts:167`,
    `${SIGNING}/signer.ts:185`,
    `${SIGNING}/signer.ts:239`,
    `${SIGNING}/openfort-embedded.ts:46`,
    `${SIGNING}/openfort-embedded.ts:92`,
    `${SIGNING}/embedded-wallet.ts:28`,
    `${SIGNING}/openfort-browser.ts:187`,
    `${SIGNING}/openfort-browser.ts:204`,
    `${SIGNING}/openfort-recovery.ts:19`,
    `${SIGNING}/openfort-readiness.ts:63`,
    `${SIGNING}/openfort-failures.ts:78`,
    `${SIGNING}/openfort-failures.ts:96`,
    `${SDK_PAY}/command-execution.ts:107`,
    `${SDK_PAY}/command-execution.ts:226`,
    `${SDK_PAY}/execution.ts:195`,
    `${SDK_PAY}/execution.ts:243`,
  ],
  component: component_core_sdk,
  system: "openfort",
  service: "CapxulSigner",
  calls: {
    getAddress: {
      about:
        "The Director EOA address, cached per session. The readiness cycle runs first and heals a stale cached Openfort user once " +
        "before it reads the wallet again.",
      timeoutMs: 30_000,
      retries: { max: 1, backoff: "none" },
      failures: [
        {
          when: "Openfort answered a failure status, gave no answer (upstream-down) or timed out in its iframe (timeout)",
          error: error_PROVIDER_ERROR,
        },
        {
          when: "The readiness cycle failed: no secure context, a stale cache that did not heal, or an unauthorized configure",
          error: error_PROVIDER_ERROR,
        },
        { when: "The embedded wallet returned an address of the wrong format, or nothing names a mode (mode unknown)", error: error_PROVIDER_ERROR },
        { when: "Openfort answered something Capxul cannot use (openfortAnswerInvalid)", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    signUserOpHash: {
      about:
        "A 65-byte ECDSA signature over the 32-byte SafeOp digest. When Openfort reports the signer not ready (MISSING_SIGNER, " +
        "NOT_CONFIGURED) it resets readiness, runs one fresh readiness cycle and signs once more (recoveringSign).",
      timeoutMs: 30_000,
      retries: { max: 1, backoff: "none" },
      failures: [
        { when: "The person cancelled: wallet code 4001 or passkey_user_cancelled; never retried", error: error_SIGNER_REJECTED },
        { when: "The signer was still not ready after the one recovery (mode signer-not-ready)", error: error_PROVIDER_ERROR },
        {
          when: "Openfort failed with a mode, or the signature had the wrong format or did not recover the wallet address (mode unknown)",
          error: error_PROVIDER_ERROR,
        },
        { when: "The readiness cycle named an answer Capxul cannot use", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
  },
  fake:
    "No Openfort double: a devnet browser run is given real Openfort keys. The CLI and node hosts sign with a local or testnet " +
    "development key signer (devPrivateKeySigner), which signs the same digest locally and has no readiness cycle to imitate.",
  secrets: [],
});

// ── contracts ───────────────────────────────────────────────────────────────────────────────

const BASE_SEPOLIA_NOTE =
  "The address is the Base Sepolia deployment; the devnet is a fork of Base Sepolia (chain 84532), so the same address holds there.";

export const contract_capxul_payments_v2 = defineContract({
  id: "capxul-payments-v2",
  title: "CapxulPaymentsV2: direct sends and vesting commitments",
  about:
    "Immutable escrow and direct-transfer contract with no owner or upgrade path. Payments routes commitments (create, claim, " +
    "cancel, redirect) to it, and a send whose command names it (commandRouter keeps V2 for a non-V3 command). Each payment and " +
    "commitment consumes one nonzero settlementId and carries a nonzero documentHash. Chain evidence decodes its events from a " +
    "receipt and reads `commitments` at a cancellation's block; the bundler revert decoder knows its custom errors. Start block " +
    `46,284,716. ${BASE_SEPOLIA_NOTE}`,
  was: [
    `${EVM}/payments-abi.ts:3`,
    `${EVM}/payments-abi.ts:6`,
    `${EVM}/payments-abi.ts:247`,
    `${EVM}/payments.ts:46`,
    `${EVM}/payments.ts:124`,
    `${EVM}/payments.ts:196`,
    `${PAY}/commands/rules.ts:60`,
    `${PAY}/reads/routers.ts:14`,
    `${EVIDENCE}/internal/payment-events.ts:142`,
    `${EVIDENCE}/internal/cancellation-receipt.ts:94`,
    `${RPC}/internal/revert.ts:60`,
    "packages/contracts/src/CapxulPaymentsV2.sol",
  ],
  addresses: {
    devnet: "0x7a5c25aB7ce91d7a475B71cd1ec33E230291f8a4",
    staging: "0x7a5c25aB7ce91d7a475B71cd1ec33E230291f8a4",
  },
  functions: {
    send: {
      signature:
        "send((bytes32 settlementId, address recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash) item)",
      about: "One direct payment from the calling Safe (encodeCapxulPaymentsV2Send), after an ERC-20 approve of the total.",
    },
    sendBatch: {
      signature:
        "sendBatch((bytes32 settlementId, address recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash)[] items)",
      about: "An atomic ordered batch when every item of a V2 command is a send and there is more than one.",
    },
    createCommitment: {
      signature:
        "createCommitment((bytes32 settlementId, address recipient, address token, uint256 totalAmount, uint48 startTime, " +
        "uint48 cliffTime, uint48 endTime, uint16 kind, bytes32 documentHash) input) returns (uint256 commitmentId)",
      about: "Escrows tokens for a vesting commitment; payments encodes it for a create_commitment item.",
    },
    claim: {
      signature: "claim(uint256 commitmentId)",
      about: "The recipient claims what vested; always sent direct from the recipient's own Safe.",
    },
    cancel: {
      signature: "cancel(uint256 commitmentId, bytes32 documentHash)",
      about: "The creator freezes vesting and takes back the unvested rest; direct, or through the Director role for an Organization.",
    },
    redirect: {
      signature: "redirect(uint256 commitmentId, address recipient, bytes32 documentHash)",
      about: "The creator points the unclaimed rest at a new recipient; direct, or through the Director role.",
    },
    commitments: {
      signature:
        "commitments(uint256) view returns (bytes32 settlementId, address creator, address recipient, address token, " +
        "uint256 totalAmount, uint256 claimed, uint48 startTime, uint48 cliffTime, uint48 endTime, uint16 kind, " +
        "bytes32 documentHash, bool cancelled)",
      about: "Read at a cancellation's block (eth_call at block) to prove a cancellation that returned nothing.",
    },
  },
  events: {
    PaymentSent: {
      signature:
        "PaymentSent(bytes32 indexed settlementId, address indexed sender, address indexed recipient, address token, " +
        "uint256 amount, uint16 kind, bytes32 documentHash)",
      about: "A direct send landed; chain evidence binds it to its ERC-20 Transfer in the same receipt.",
    },
    CommitmentCreated: {
      signature:
        "CommitmentCreated(uint256 indexed commitmentId, bytes32 indexed settlementId, address indexed creator, address recipient, " +
        "address token, uint256 totalAmount, uint48 startTime, uint48 cliffTime, uint48 endTime, uint16 kind, bytes32 documentHash)",
      about: "A commitment was escrowed; its commitmentId becomes the Payment's on-chain commitment id.",
    },
    FundsClaimed: {
      signature:
        "FundsClaimed(uint256 indexed commitmentId, bytes32 indexed settlementId, address indexed recipient, uint256 amount, " +
        "bytes32 documentHash)",
      about: "A recipient claimed vested funds; checked against its Transfer.",
    },
    CommitmentCancelled: {
      signature:
        "CommitmentCancelled(uint256 indexed commitmentId, bytes32 indexed settlementId, address indexed creator, " +
        "uint256 vestedUnclaimed, uint256 unvestedReturned, bytes32 documentHash)",
      about: "A commitment was cancelled; its vested and returned split is checked, with `commitments` when nothing returned.",
    },
    CommitmentRedirected: {
      signature:
        "CommitmentRedirected(uint256 indexed commitmentId, bytes32 indexed settlementId, address indexed oldRecipient, " +
        "address newRecipient, bytes32 documentHash)",
      about: "A commitment's recipient changed.",
    },
  },
});

const ROUTER_ITEM =
  "(bytes32 settlementId, address recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash, bytes32 jobNonce, address executor)";

export const contract_capxul_payments_v3 = defineContract({
  id: "capxul-payments-v3",
  title: "CapxulPaymentsV3: the payment router",
  about:
    "Immutable router with no owner or registry: `send` and `sendBatch` transfer exact token units and record a settlement whose " +
    "id is derived from the chain, router, job nonce, executor, recipient, token, amount, kind and document hash. A fresh send, a " +
    "payroll run and an obligation send use it off Protocol v4 (paymentsRouterAddress). Payments computes the payment id itself " +
    "(capxulPaymentsV3PaymentId) and never calls `paymentId` or `settled` on chain. Its PaymentSent settles a Payment from the " +
    `indexer and from the receipt. A fixed CREATE2 deployment on every admitted chain; start block 47,942,654. ${BASE_SEPOLIA_NOTE}`,
  was: [
    `${EVM}/payments-v3.ts:9`,
    `${EVM}/payments-v3.ts:54`,
    `${EVM}/payments-v3.ts:221`,
    `${EVM}/payments-v3.ts:228`,
    `${EVM}/payments.ts:142`,
    `${EVM}/payments.ts:176`,
    "packages/backend/src/integrations/companies-house/addresses.ts:58",
    `${PAY}/commands/writes/commands.ts:103`,
    `${PAY}/verifications/external.ts:46`,
    `${EVIDENCE}/internal/payment-events.ts:142`,
    "packages/contracts/src/CapxulPaymentsV3.sol",
  ],
  addresses: {
    devnet: "0x46b28f455c8de7c1505e3185A3f8f87B07eaE1aE",
    staging: "0x46b28f455c8de7c1505e3185A3f8f87B07eaE1aE",
  },
  functions: {
    send: {
      signature: `send(${ROUTER_ITEM} item)`,
      about: "One exact payment from the calling Safe, after an ERC-20 approve of the total (encodeCapxulPaymentsV3Send).",
    },
    sendBatch: {
      signature: `sendBatch(${ROUTER_ITEM}[] items)`,
      about: "An atomic batch when every item of a command is a send and there is more than one.",
    },
  },
  events: {
    PaymentSent: {
      signature:
        "PaymentSent(bytes32 indexed settlementId, address indexed sender, address indexed recipient, address token, " +
        "uint256 amount, uint16 kind, bytes32 documentHash)",
      about: "A settlement recorded; the indexer's payment row a Payment settles from (D2), bound to the Transfer it settled.",
    },
  },
});

const V4_ITEM =
  "(bytes32 paymentId, address recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash, bytes32 jobNonce, address executor)";

export const contract_payments = defineContract({
  id: "payments",
  title: "Protocol v4 Payments",
  about:
    "Each v4 deployment's Payments. It keeps V3's item, payment id, `send` and `PaymentSent` (only the names change), so payments " +
    "encodes, verifies and settles it with the V3 code (isPaymentsV3Router lists it). On Protocol v4 (CAPXUL_PROTOCOL_V4_DEPLOYMENT " +
    "set) every V3 send (a fresh send, a payroll run, an obligation send) goes to it instead of V3 (paymentsRouterAddress); " +
    "Budgets pays through it. The v4 address book lists only the devnet deployment.",
  was: [
    `${EVM}/protocol-v4-abis.ts:283`,
    `${EVM}/protocol-v4-abis.ts:366`,
    `${EVM}/protocol-v4-abis.ts:421`,
    `${EVM}/protocol-v4-abis.ts:476`,
    `${EVM}/protocol-v4-addresses.ts:46`,
    `${EVM}/payments-v3.ts:228`,
    "packages/backend/src/integrations/companies-house/addresses.ts:59",
    `${PAY}/README.md:36`,
    `${PAY}/commands/rules.ts:45`,
    "packages/contracts/v4/src/money/Payments.sol",
  ],
  addresses: { devnet: "0xe9cCC7E3b3cbf670ca0a23f338f10b266A2d9301" },
  functions: {
    send: { signature: `send(${V4_ITEM} item)`, about: "One exact payment from the calling Safe, encoded as V3's send." },
    sendBatch: { signature: `sendBatch(${V4_ITEM}[] items)`, about: "An atomic batch of sends, encoded as V3's sendBatch." },
  },
  events: {
    PaymentSent: {
      signature:
        "PaymentSent(bytes32 indexed paymentId, address indexed sender, address indexed recipient, address token, uint256 amount, " +
        "uint16 kind, bytes32 documentHash)",
      about: "A payment recorded; read as V3's PaymentSent from the indexer and from receipts.",
    },
  },
});

export const contract_budgets = defineContract({
  id: "budgets",
  title: "Protocol v4 Budgets",
  about:
    "Each v4 deployment's Budgets: a budget's hat wearer spends or schedules from it with their own Safe, and Budgets pays from " +
    "the company Safe through its Roles payout role and Payments. Budgets derives the Payments job nonce " +
    "(keccak256(budgets, id, jobNonce)), so payments knows the payment id before it signs. Payments builds spend, schedule and a " +
    "reschedule's cancel into the wearer's or the company Safe's operation, refuses before signing what leftOf cannot cover, finds " +
    "a Board's dated payment with scheduledCount and scheduledOf, and has its executor key call execute on the date. The v4 " +
    "address book lists only the devnet deployment.",
  was: [
    `${EVM}/protocol-v4-abis.ts:647`,
    `${EVM}/protocol-v4-addresses.ts:47`,
    `${EVM}/budget-payments.ts:39`,
    `${EVM}/budget-payments.ts:193`,
    `${PAY}/guards/budgets.ts:68`,
    `${PAY}/guards/owner-approvals.ts:58`,
    `${PAY}/commands/external/funding.ts:125`,
    `${PAY}/schedules/external/board-budgets.ts:57`,
    `${PAY}/schedules/external/budget-executor.ts:46`,
    `${PAY}/verifications/external.ts:203`,
    "packages/contracts/v4/src/money/Budgets.sol",
  ],
  addresses: { devnet: "0xC8670A227f9b8621aDA65E1746fA135271e62d9f" },
  functions: {
    spend: {
      signature:
        "spend(uint256 id, address recipient, uint128 amount, uint16 kind, bytes32 documentHash, bytes32 jobNonce) returns (bytes32 paymentId)",
      about: "Pay now from a budget the caller's hat allows (encodeBudgetsSpend), one per item.",
    },
    schedule: {
      signature:
        "schedule(uint256 id, address to, uint128 amount, uint16 kind, uint64 payAt, bytes32 documentHash, bytes32 jobNonce) " +
        "returns (uint256 scheduledId)",
      about: "A dated payment the budget reserves now; payAt is the send time in seconds, rounded up (encodeBudgetsSchedule).",
    },
    cancel: {
      signature: "cancel(uint256 scheduledId)",
      about: "Frees a pending dated payment's reservation; a reschedule cancels first in the same operation (encodeBudgetsCancel).",
    },
    execute: {
      signature: "execute(uint256 scheduledId) returns (bytes32 paymentId)",
      about: "Pays a due dated payment; sent by Capxul's executor EOA as a signed transaction (encodeBudgetsExecute).",
    },
    leftOf: {
      signature: "leftOf(uint256 id) view returns (uint128)",
      about: "What the budget has left this period, read before a spend is signed.",
    },
    scheduledOf: {
      signature:
        "scheduledOf(uint256 id) view returns ((uint256 budgetId, address to, uint128 amount, uint64 payAt, uint16 kind, " +
        "uint8 state, bytes32 documentHash, bytes32 jobNonce))",
      about: "A dated payment's state (none, pending, cancelled, paid), date, budget and job nonce.",
    },
    scheduledCount: {
      signature: "scheduledCount() view returns (uint256)",
      about: "The newest scheduled id; the Board scan reads down from it.",
    },
  },
  events: {
    PaymentScheduled: {
      signature:
        "PaymentScheduled(address indexed safe, uint256 indexed budgetId, uint256 indexed scheduledId, address to, uint128 amount, " +
        "uint16 kind, uint64 payAt, bytes32 documentHash, bytes32 jobNonce)",
      about:
        "Read from a landed operation's receipt logs: each item's job nonce and Budgets' scheduled id. A ScheduleCancelled beside " +
        "it is decoded and passed over.",
    },
  },
});

export const contract_erc20 = defineContract({
  id: "erc20",
  title: "ERC-20 money tokens",
  about:
    "The tokens a Payment moves. The admitted money assets are Capxul's own test tokens on Base Sepolia (USDC 0x06ba8b86…, " +
    "USDT, WETH, WBTC, cNGN, EURC in test-assets.ts); one record covers them all, so no single address is listed. Payments " +
    "approves the router for each token's total before a send or commitment, reads balanceOf before it builds, and binds each " +
    "payment event to its Transfer in the receipt and in the indexer. A sponsorship revert decodes the token's own " +
    "ERC20InsufficientBalance into INSUFFICIENT_BALANCE.",
  was: [
    `${EVM}/test-assets.ts:21`,
    `${EVM}/assets.ts:168`,
    `${EVM}/organization-payments.ts:85`,
    `${EVM}/payments.ts:160`,
    `${RPC}/internal/stateReads.ts:69`,
    `${RPC}/internal/revert.ts:18`,
    `${EVIDENCE}/internal/transfer-facts.ts:20`,
    `${PAY}/executions/external/funding.ts:36`,
  ],
  functions: {
    approve: {
      signature: "approve(address spender, uint256 amount) returns (bool)",
      about: "Approves the payments router for the sum of a command's items in that token, ahead of its sends or commitments.",
    },
    balanceOf: {
      signature: "balanceOf(address) view returns (uint256)",
      about: "The sender Safe's balance, read with selector 0x70a08231 before a build.",
    },
  },
  events: {
    Transfer: {
      signature: "Transfer(address indexed from, address indexed to, uint256 value)",
      about: "The movement a payment event settled; matched by token, source, destination and raw amount in log order.",
    },
  },
});

export const contract_entry_point = defineContract({
  id: "entry-point",
  title: "ERC-4337 EntryPoint v0.7",
  about:
    "The canonical EntryPoint every UserOperation payments sends goes through; the bundler calls it, payments never does. " +
    "Payments reads a lane's next nonce with getNonce and finds the event that consumed a nonce to decide what became of an " +
    `Attempt. ${BASE_SEPOLIA_NOTE}`,
  was: [
    `${EVM}/safe-contracts.ts:31`,
    `${RPC}/internal/accountReads.ts:10`,
    `${RPC}/internal/accountReads.ts:98`,
    `${RPC}/internal/userOperationEvents.ts:15`,
    `${PAY}/executions/external/attempts.ts:79`,
    `${PAY}/executions/external/lanes.ts:103`,
  ],
  addresses: {
    devnet: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    staging: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  },
  functions: {
    getNonce: {
      signature: "getNonce(address sender, uint192 key) view returns (uint256 nonce)",
      about: "The next nonce on one 4337 lane: key << 64 | sequence. A payment command rides its own key, others key 0.",
    },
  },
  events: {
    UserOperationEvent: {
      signature:
        "UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, " +
        "bool success, uint256 actualGasCost, uint256 actualGasUsed)",
      about: "Which operation consumed a sender's nonce and whether it succeeded: a landed, displaced or reverted Attempt.",
    },
  },
});

export const contract_safe_4337_module = defineContract({
  id: "safe-4337-module",
  title: "Safe4337Module: a Safe's UserOperation entry",
  about:
    "The Safe's ERC-4337 fallback handler. Every payment UserOperation's callData is executeUserOpWithErrorString on the sender " +
    "Safe: one call to a contract, or a delegatecall to MultiSendCallOnly for several, or a call to a Roles module for a " +
    "role-routed spend. A void of a scheduled payment is a call from the Safe to itself with no data. The SafeOp digest the " +
    `signer signs is this module's EIP-712 type. ${BASE_SEPOLIA_NOTE}`,
  was: [
    `${EVM}/safe-contracts.ts:33`,
    `${EVM}/safe-contracts.ts:174`,
    `${EVM}/safe-4337.ts:188`,
    `${EVM}/safe-4337.ts:205`,
    `${EVM}/organization-payments.ts:143`,
    `${EVM}/payments.ts:256`,
  ],
  addresses: {
    devnet: "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226",
    staging: "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226",
  },
  functions: {
    executeUserOpWithErrorString: {
      signature: "executeUserOpWithErrorString(address to, uint256 value, bytes data, uint8 operation)",
      about: "The operation's one call (operation 0) or delegatecall (operation 1), reverting with the inner reason.",
    },
  },
  events: {},
});

export const contract_multi_send_call_only = defineContract({
  id: "multi-send-call-only",
  title: "MultiSendCallOnly: ordered call batches",
  about:
    "Safe's MultiSendCallOnly, delegatecalled to run a command's approvals and sends in order: from the sender Safe for a direct " +
    "route, from the wearer's or company Safe for a budget route of more than one call, and inside a Roles " +
    `execTransactionWithRole for a role-routed one. ${BASE_SEPOLIA_NOTE}`,
  was: [
    `${EVM}/safe-contracts.ts:160`,
    `${EVM}/safe-contracts.ts:171`,
    `${EVM}/organization-payments.ts:122`,
    `${EVM}/safe-4337.ts:205`,
    `${EVM}/payments.ts:230`,
  ],
  addresses: {
    devnet: "0x9641d764fc13c8b624c04430c7356c1c7c8102e2",
    staging: "0x9641d764fc13c8b624c04430c7356c1c7c8102e2",
  },
  functions: {
    multiSend: {
      signature: "multiSend(bytes transactions)",
      about: "Packed (operation, to, value, data length, data) calls, each a plain call.",
    },
  },
  events: {},
});

export const contract_roles = defineContract({
  id: "roles",
  title: "Zodiac Roles v2.1.1: an Organization's permission module",
  about:
    "Each Organization's Roles module proxy (mastercopy 0xf2964ce6…, version 2.1.1 only). A `zodiac_role` route (a member's " +
    "Organization payment outside a v4 budget, or a Director's cancel or redirect of an Organization commitment) is one " +
    "execTransactionWithRole from the caller's Safe that delegatecalls MultiSendCallOnly. Payments checks the module's code is an " +
    "admitted proxy, reads a capped allowance before it builds, and declares a ConditionViolation or NoMembership revert " +
    "ROLE_PERMISSION_DENIED. One proxy per Organization, so no single address is listed.",
  was: [
    `${EVM}/organization-payments.ts:39`,
    `${EVM}/organization-payments.ts:62`,
    `${EVM}/organization-payments.ts:122`,
    `${EVM}/zodiac-abi.ts:99`,
    `${EVM}/zodiac-abi.ts:143`,
    `${EVM}/payments.ts:240`,
    `${RPC}/internal/revert.ts:48`,
    `${PAY}/commands/external/funding.ts:65`,
    `${PAY}/commands/external/roles-modules.ts:16`,
  ],
  functions: {
    execTransactionWithRole: {
      signature:
        "execTransactionWithRole(address to, uint256 value, bytes data, uint8 operation, bytes32 roleKey, bool shouldRevert) " +
        "returns (bool success)",
      about: "The member's role-scoped batch: to MultiSendCallOnly by delegatecall, shouldRevert true.",
    },
    allowances: {
      signature:
        "allowances(bytes32 key) view returns (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance, uint64 timestamp)",
      about: "A capped Budget's allowance, accrued to the latest block's time when it refills, read before a build.",
    },
  },
  events: {},
});
