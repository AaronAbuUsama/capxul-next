// The outside systems the old backend and Core SDK call (every vendor folder under
// packages/backend/src/integrations, the PostHog export of the observation platform, and the SDK's
// signer), and the on-chain contracts they build calls for or read events from (packages/contracts,
// v4 and the legacy contracts still used, and the third-party contracts they reach), as the old
// code has them. The first records were booked with payments; the rest extend them to the whole
// system. Old code: /home/user/factory (integration/factory). Evidence paths are relative to it.
//
// A call is an exported function a concept calls that reaches the outside system, or runs the
// vendor's own code (the Roles SDK). A helper that calls nothing (a decoder, an address derivation,
// an error builder) is named in its integration's `about`, and its failures are booked on the call
// it follows, as payments booked sentHashConflict.

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
const SRC = "packages/backend/src";
const BRIDGE = "packages/backend/src/integrations/bridge";
const HOUSE = "packages/backend/src/integrations/companies-house";
const OBS = "packages/backend/src/platform/observation";
const V4ABI = "packages/protocol/src/evm/protocol-v4-abis.ts";
const V4ADDR = "packages/protocol/src/evm/protocol-v4-addresses.ts";
const V4 = "packages/contracts/v4/src";
const BETA = "packages/contracts/src";
const IDX = "apps/indexer/src";

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
    "secret of its own. Other concepts add the block-pinned reads, the bounded block, transaction and receipt reads, a Safe's " +
    "code and owners, a proxy's creation log and the UserOperation receipt wait, and apply checks that call nothing: " +
    "isDefinitiveUserOperationRejection, isDefinitiveTransactionRejection and userOperationReceiptFailure.",
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
    `${RPC}/types.ts:154`,
    `${RPC}/types.ts:167`,
    `${RPC}/types.ts:193`,
    `${RPC}/types.ts:223`,
    `${RPC}/types.ts:246`,
    `${RPC}/types.ts:251`,
    `${RPC}/internal/boundedReads.ts:49`,
    `${RPC}/internal/blockReads.ts:110`,
    `${RPC}/internal/stateReads.ts:152`,
    `${RPC}/internal/accountReads.ts:48`,
    `${RPC}/internal/rpcFailures.ts:156`,
    `${RPC}/errors.ts:22`,
    `${RPC}/errors.ts:97`,
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
    waitForUserOperationReceipt: {
      about:
        "Polls fetchUserOperationReceipt every 2 s until a receipt, failed or not; the 120 s deadline is checked between " +
        "polls and a failed poll ends the wait. Used by the faucet grant and approvals in flight (faucet.ts:62, " +
        "approvals-in-flight.ts:40).",
      timeoutMs: 120_000,
      retries: { max: 0, backoff: "none" },
      failures: [
        ...gatewayFailures,
        {
          when: "No receipt by the 120 s deadline (receiptWaitTimedOut: provider account-abstraction, mode timeout)",
          error: error_PROVIDER_ERROR,
        },
      ],
    },
    fetchBoundedBlock: {
      about:
        "eth_getBlockByNumber for one number, `latest` or `finalized`, 30 s an attempt: number, hash and timestamp, or null. " +
        "Requests reads a checkout's block and setup the bootstrap's (requests/external/requests.ts:161, " +
        "setups/external/bootstraps.ts:43); chain evidence caches it per payment attempt.",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The block is malformed, or a field is not a quantity or a 32-byte hash", error: error_PROVIDER_ERROR },
        { when: "The block number is negative or not a safe integer", error: error_INVALID_INPUT },
      ],
    },
    fetchBoundedTransaction: {
      about:
        "eth_getTransactionByHash with its exact identity and quantities (hash, chain id, from, to, nonce, value, input), or " +
        "null. Read for a checkout, a setup deploy, an equity send and a claim (requests.ts:62, deploys.ts:163, " +
        "equity/external.ts:115, claims/external/submissions.ts:170).",
      ...NODE,
      failures: [...nodeFailures, { when: "The transaction is malformed or a quantity is not hex", error: error_PROVIDER_ERROR }],
    },
    fetchBoundedTransactionReceipt: {
      about:
        "eth_getTransactionReceipt with every log whole, status 0x0 or 0x1, or null. Votes read an execution's receipt " +
        "(votes/external/executions.ts:48); chain evidence and waitForTransactionReceipt read through it.",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The receipt or one of its logs is malformed, or its status is neither 0x0 nor 0x1", error: error_PROVIDER_ERROR },
      ],
    },
    fetchCodeAtBlock: {
      about:
        "eth_getCode at one block. Organization setup checks the code of what it verifies at the receipt's block " +
        "(setups/external/verifications.ts:118, setups/external/authority.ts:101).",
      ...NODE,
      failures: [...nodeFailures, { when: "The code is not hex data", error: error_PROVIDER_ERROR }],
    },
    fetchStorageAtBlock: {
      about:
        "eth_getStorageAt for one slot at one block, 30 s an attempt. Setup and proposals read one storage word at a block " +
        "(install-checks.ts:82, setups/external/authority.ts:157, proposals/guards.ts:49, proposals/external/signer-gate.ts:33).",
      ...NODE,
      failures: [
        ...nodeFailures,
        {
          when: "The answer is not a 32-byte word, or the address or slot is malformed (checked with the provider-answer readers)",
          error: error_PROVIDER_ERROR,
        },
        { when: "The block number is negative or not a safe integer", error: error_INVALID_INPUT },
      ],
    },
    fetchEthCallAtBlock: {
      about:
        "eth_call at one block; `0x` is refused. Setup reads Roles, Safe and module state at a receipt's block, and Books a " +
        "token at a block (setups/external/contracts.ts:67, install-checks.ts:57, books/facts/external.ts:139).",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The node answered `0x`: no code at the address or an empty return (mode unknown)", error: error_PROVIDER_ERROR },
      ],
    },
    fetchProxyCreationLog: {
      about:
        "eth_getLogs for SafeProxyFactory ProxyCreation with the Safe as topic 1, from `earliest` unless a block is named, on " +
        "the nodes that take wide log reads: the first log or null. Accounts reads a Safe's deployment (safes/external.ts:73).",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The answer is not an array, or a log is malformed", error: error_PROVIDER_ERROR },
        { when: "The Safe address is not 0x and 40 hex characters", error: error_INVALID_INPUT },
      ],
    },
    fetchBlockTimestamp: {
      about:
        "A block's time in ms: eth_getBlockByNumber, polled every 500 ms while the node has no such block, all within one 10 s " +
        "deadline (BLOCK_TIMESTAMP_TIMEOUT_MS). Payroll, directors, votes, safes and claims read it " +
        "(agreements/external.ts:212, safes/external.ts:57).",
      timeoutMs: 10_000,
      retries: { max: 3, backoff: "none" },
      failures: [
        ...nodeFailures,
        { when: "No such block by the 10 s deadline (mode timeout)", error: error_PROVIDER_ERROR },
        { when: "The block has no timestamp, or the timestamp overflows in ms", error: error_PROVIDER_ERROR },
        { when: "The block number is negative or not a safe integer", error: error_INVALID_INPUT },
      ],
    },
    fetchBlockIdentity: {
      about:
        "A block's hash and time in ms by number; a missing block fails. Setup, the bootstrap and the drift check pin what they " +
        "read to it (setups/external/authority.ts:56, setups/external/receipts.ts:55, indexing/drifts/external.ts:61).",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The node has no such block, or the block is malformed or its time overflows", error: error_PROVIDER_ERROR },
        { when: "The block number is negative or not a safe integer", error: error_INVALID_INPUT },
      ],
    },
    fetchAddressCode: {
      about:
        "eth_getCode at `latest`, null when nothing is deployed. Checkout escrows, setup deploys, the faucet and claims check " +
        "that a contract or Safe exists (escrows.ts:137, deploys.ts:48, faucet.ts:102, claims/external/ownership.ts:27).",
      ...NODE,
      failures: [...nodeFailures, { when: "The code answer is not a string", error: error_PROVIDER_ERROR }],
    },
    fetchSafeOwners: {
      about:
        "Safe getOwners() by eth_call at `latest`, lowercased, first owner first; empty when no Safe. Claims, directors, " +
        "proposals, receivables, payroll and setup read it before an owner change or a notice (ownership.ts:31, " +
        "directors/external.ts:85).",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The answer is not a strict ABI address[]: offset, length or padding wrong", error: error_PROVIDER_ERROR },
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

/** What a receipt verifier other than verifyPayment declares (ChainEvidenceFailure); reads give provider_failure. */
const evidenceFailures = [
  {
    when: "Declared by ChainEvidenceFailure for a PROVIDER_ERROR the verifier did not classify; a classified read gives the provider_failure result",
    error: error_PROVIDER_ERROR,
  },
  { when: "Declared by ChainEvidenceFailure for a missing setting outside a classified read", error: error_ENV_MISSING },
] as const;

export const integration_chain_evidence = defineIntegration({
  id: "chain-evidence",
  title: "Chain evidence: receipts and indexed facts verified",
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
    "decodeRolesAllowance (commands/external/funding.ts:16). Permissions, the Movement scan and documents also build " +
    "productionChainEvidence; requests builds the receipt reader directly (requests/external/evidence.ts:7), so it never " +
    "reads Ponder. Setup imports the bootstrap checks (each PROVIDER_RESPONSE_INVALID), ABIs and event hashes, which call nothing.",
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
    `${EVIDENCE}/service.ts:134`,
    `${EVIDENCE}/service.ts:139`,
    `${EVIDENCE}/service.ts:148`,
    `${EVIDENCE}/service.ts:153`,
    `${EVIDENCE}/service.ts:158`,
    `${EVIDENCE}/service.ts:164`,
    `${EVIDENCE}/service.ts:168`,
    `${EVIDENCE}/internal/transfer-reads.ts:16`,
    `${EVIDENCE}/internal/transfer-reads.ts:58`,
    `${EVIDENCE}/internal/transfer-windows.ts:44`,
    `${EVIDENCE}/internal/checkout-receipt.ts:73`,
    `${EVIDENCE}/internal/checkout-receipt.ts:150`,
    `${EVIDENCE}/internal/authority-state.ts:206`,
    `${SRC}/permissions/grants/external.ts:232`,
    `${SRC}/permissions/configurations/external.ts:13`,
    `${SRC}/permissions/verifications/external.ts:14`,
    `${SRC}/indexing/movements/external.ts:16`,
    `${SRC}/documents/memos/external.ts:102`,
    `${SRC}/requests/external/evidence.ts:7`,
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
    verifyPermission: {
      about:
        "An ordinary Permission's UserOperation receipt checked against its exact authority events, the Roles and Safe " +
        "identity and the post-state at the receipt block. Never retried; each read is a chain-rpc read " +
        "(permissions/verifications/external.ts:14).",
      timeoutMs: 30_000,
      retries: { max: 0, backoff: "none" },
      failures: [...evidenceFailures],
    },
    verifyInvitationConfiguration: {
      about:
        "The inviter's one sponsored configuration UserOperation checked against the stored authority expectation " +
        "(permissions/configurations/external.ts:13).",
      timeoutMs: 30_000,
      retries: { max: 0, backoff: "none" },
      failures: [...evidenceFailures],
    },
    verifyInvitation: {
      about:
        "A signed EOA invitation transaction: its exact AssignRoles and ConsumeAllowance, no reversal later in its block, and " +
        "the one-use counter's state (permissions/grants/external.ts:232).",
      timeoutMs: 30_000,
      retries: { max: 0, backoff: "none" },
      failures: [...evidenceFailures],
    },
    readTransfer: {
      about:
        "One canonical ERC-20 Transfer by its logical id `84532:<tx hash>:<log ordinal>`: the log, its receipt and block " +
        "checked, or null. Documents reads a memo payment's Transfer with it (documents/memos/external.ts:102).",
      timeoutMs: 30_000,
      retries: { max: 0, backoff: "none" },
      failures: [
        { when: "The id is not a Base Sepolia logical event id", error: error_INVALID_INPUT },
        { when: "A chain read failed, or the receipt or block is not canonical (TransferReadFailure)", error: error_PROVIDER_ERROR },
      ],
    },
    readTransferWindow: {
      about:
        "The canonical Transfers of one window under 10,000 blocks: the head and anchor blocks, a bounded eth_getLogs, each " +
        "log's receipt and block, and the requests spent. The Movement scan halves a window refused as too large " +
        "(indexing/movements/external.ts:16).",
      timeoutMs: 30_000,
      retries: { max: 0, backoff: "none" },
      failures: [
        { when: "The range is unordered, spans 10,000 blocks or more, or reaches past the included head", error: error_INVALID_INPUT },
        {
          when: "A read failed or a log, receipt or block is not canonical: a ChainEvidenceReadError (provider_failure or provider_size_error), not a CapxulError, which the scan records",
          error: error_PROVIDER_ERROR,
        },
      ],
    },
    verifyCheckoutPayment: {
      about:
        "A direct wallet checkout: the transaction, receipt and block, one PaymentSent on the router with the frozen terms, " +
        "and its bound Transfer. Any read failure is the provider_failure result; a hash that is not one dies " +
        "(requests.ts:71, purchases.ts:21).",
      timeoutMs: 30_000,
      retries: { max: 0, backoff: "none" },
      failures: [],
    },
    checkoutReceiptOccurrence: {
      about:
        "Whether a saved checkout receipt's block is still canonical: included, orphaned with the new hash, or unavailable " +
        "on any read failure. It never fails (requests.ts:243, purchases.ts:58).",
      timeoutMs: 30_000,
      retries: { max: 0, backoff: "none" },
      failures: [],
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
    "identity (verify.ts:156); that reads the environment, not the indexer. Beyond payments: Books sweeps a Safe's transfers " +
    "in block windows and reads the index head, banking polls a deposit's Transfer, documents reads a memo payment's " +
    "transaction, the drift check sweeps a Safe's payments and role assignments (reading the setting with " +
    "commandFateReadSetting, a defect on an unknown value), and Organization setup locates a bootstrap's module. " +
    "isPonderUnavailable, which Books also uses, calls nothing. The SDK reads /sql/db itself with the session JWT " +
    "(packages/sdk/src/indexing/ponder/reads.ts:203); that is not this reader.",
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
    `${PONDER}/service.ts:112`,
    `${PONDER}/service.ts:160`,
    `${PONDER}/service.ts:182`,
    `${PONDER}/service.ts:195`,
    `${PONDER}/pages.ts:23`,
    `${PONDER}/pages.ts:65`,
    `${PONDER}/pages.ts:86`,
    `${PONDER}/pages.ts:101`,
    `${PONDER}/internal/rows.ts:72`,
    `${SRC}/books/facts/external.ts:59`,
    `${SRC}/books/facts/operations/observe.ts:150`,
    `${SRC}/banking/deposits/operations/credit.ts:78`,
    `${SRC}/documents/memos/external.ts:73`,
    `${SRC}/indexing/drifts/external.ts:58`,
    `${SRC}/organizations/setups/external/bootstraps.ts:92`,
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
    read: {
      about:
        "One page of a table (transfer, payment, role_assignment, native_transfer, safe) through one pinned statement, by " +
        "stable id after a cursor; its provider operation is the table's (readTransfers, readPayments and so on). The drift " +
        "check reads a Safe's row (drifts/external.ts:132).",
      timeoutMs: 5_000,
      retries: { max: 0, backoff: "none" },
      failures: [...ponderFailures],
    },
    head: {
      about:
        "Ponder's own /status, sent without the bearer: the block each chain is indexed through, or none. Books and the drift " +
        "check read it before they trust an empty page (books/facts/operations/observe.ts:150, open.ts:107, drifts/external.ts:58).",
      timeoutMs: 5_000,
      retries: { max: 0, backoff: "none" },
      failures: [...ponderFailures],
    },
    locateBootstrapModule: {
      about:
        "The one indexed Roles module setup matching a bootstrap's chain, module, Safe, mastercopy and code hash: its " +
        "transaction hash, or null on none, several or a mismatch (setups/external/bootstraps.ts:92).",
      timeoutMs: 5_000,
      retries: { max: 0, backoff: "none" },
      failures: [...ponderFailures],
    },
    readPagesThrough: {
      about:
        "A Safe's rows at or above a block, 200 a page by id cursor, at most 5 pages (PONDER_FACT_PAGES): `complete` false at " +
        "the cap. The drift check sweeps payments and role assignments (drifts/external.ts:119, 131). Each page is 5 s.",
      timeoutMs: 5_000,
      retries: { max: 0, backoff: "none" },
      failures: [...ponderFailures],
    },
    readPagesWithin: {
      about:
        "A Safe's rows from one block through another, 200 a page, at most 5 pages; Books halves a window that hits the cap " +
        "and reads it again (books/facts/external.ts:59, 74). Each page is 5 s.",
      timeoutMs: 5_000,
      retries: { max: 0, backoff: "none" },
      failures: [...ponderFailures],
    },
    pollPonderFact: {
      about:
        "Re-reads a fact until it appears: waits 2, 4 then 8 s within the 14 s PONDER_FACT_BUDGET_MS (a larger budget doubles " +
        "to a 60 s cap, 300 s at most); undefined is pending. Banking credits a deposit's Transfer with it (credit.ts:78).",
      timeoutMs: 14_000,
      retries: { max: 3, backoff: "exponential" },
      failures: [...ponderFailures],
    },
  },
  fake: "The devnet runs a local Ponder indexer at 127.0.0.1:42069 over its forked chain, with a fixed devnet service token.",
  secrets: ["INDEXER_SERVICE_TOKEN"],
});

// ── mail ────────────────────────────────────────────────────────────────────────────────────

export const integration_mail = defineIntegration({
  id: "mail",
  title: "Email: transactional mail and notices",
  about:
    "Transactional email through the Convex Resend component (@convex-dev/resend), which queues each accepted message durably and " +
    "retries its delivery itself. Payments' notify action sends a scheduled payment's notices with deliverNotices " +
    "(notices/external.ts:36). deliverNotices returns each failure as a value: it rejects only when the entry did not load the " +
    "Resend client or the retry cannot be scheduled, which payments' Effect.promise makes a defect. Each recipient's outcome is " +
    "kept in the delivery record " +
    "(operator.notices.record), a message the component did not take is the value PROVIDER_ERROR (provider resend, mode unknown) " +
    "logged as [CAPXUL_MAIL_FAILED], and the result counts sent and failed. While attempts remain the failed recipients are handed " +
    "to the caller's retry, which schedules the notify action again for them only. sendMail (service.ts:147) is the one " +
    "transport under it: Access sends OTP and waitlist mail with it, Organizations invitations, Parties person verification " +
    "invites and Profiles the account-ready message. It sends from SENDER_EMAIL (else onboarding@resend.dev) and stays in " +
    "Resend test mode unless RESEND_TEST_MODE=false. Every other concept's notices (approvals, payouts, directors, members, " +
    "proposals, verifications) go through deliverNotices. An entry that did not load the Resend client dies as a defect.",
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
    `${MAIL}/service.ts:45`,
    `${MAIL}/service.ts:50`,
    `${MAIL}/service.ts:169`,
    `${MAIL}/README.md:3`,
    `${SRC}/access/sessions/external/otp-delivery.ts:16`,
    `${SRC}/access/waitlist/external.ts:11`,
    `${SRC}/organizations/invitations/external.ts:11`,
    `${SRC}/parties/verifications/operations/deliver-person-invite.ts:4`,
    `${SRC}/profiles/onboardings/external.ts:10`,
    `${SRC}/organizations/members/external.ts:21`,
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
    sendMail: {
      about:
        "One message through the Resend component's sendEmail, or into the devnet mail sink. It never throws: a refusal is the " +
        "value { status: failed }. No timeout of its own: it runs inside its caller, a mutation (1 s) or an action (ten minutes).",
      timeoutMs: 600_000,
      retries: { max: 0, backoff: "none" },
      failures: [
        {
          when: "The component did not enqueue the message, or the devnet fail switch refused it: returned as the failed outcome, provider resend, mode unknown",
          error: error_PROVIDER_ERROR,
        },
      ],
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

// ── bridge ──────────────────────────────────────────────────────────────────────────────────

/** Every Bridge call: one 30 s attempt through the provider door, body included, never retried. */
const BRIDGE_CALL = { timeoutMs: 30_000, retries: { max: 0, backoff: "none" } } as const;

const bridgeFailures = [
  {
    when: "Bridge did not answer in 30 s (mode timeout), the request or its body failed in transit, or it answered 5xx, 429 or 408",
    error: error_PROVIDER_ERROR,
  },
  {
    when: "Bridge refused the request: 401, 403, or 400, 404 or 422 (bad-request), keeping Bridge's code and the refused field names, never its reasons",
    error: error_PROVIDER_ERROR,
  },
  {
    when: "A successful answer that is not JSON, or does not decode as the call's Schema (the first failing field named)",
    error: error_PROVIDER_RESPONSE_INVALID,
  },
  {
    when: "BRIDGE_API_KEY is unset or not a sandbox key (sk-test), or BRIDGE_STAND_IN_URL is not a loopback HTTP origin: refused before fetch",
    error: error_ENV_MISSING,
  },
  { when: "A path off /v0/ of the origin, or a POST without its idempotency key: refused before fetch", error: error_INVALID_INPUT },
] as const;

export const integration_bridge = defineIntegration({
  id: "bridge",
  title: "Bridge: customers, bank accounts and payouts",
  about:
    "Bridge's sandbox API behind the Effect service `Bridge` (makeBridgeLayer, BridgeLive): one typed method per call, named " +
    "by its provider operation, through the provider door callProvider with a 30 s deadline and no retry. A POST carries the " +
    "idempotency key its caller recorded first, so a retry repeats the same call. The live layer sends `Api-Key` to " +
    "https://api.sandbox.bridge.xyz and refuses a key that is not a sandbox key; with BRIDGE_STAND_IN_URL set and no key " +
    "given, every call goes to that loopback stand-in and no key is read. A refusal is classified by its status; when Bridge " +
    "refused only the person's amount it is INVALID_INPUT with Bridge's reason. Each method checks what the answer names " +
    "beyond its Schema. Parties creates and reads customers, associated persons, hosted links and saved bank accounts; banking " +
    "opens, reads and changes virtual accounts, reads rates, creates, reads and cancels payout transfers, and catches up on " +
    "webhook events. The webhook itself is inbound: banking checks its RSA-SHA256 signature with verifyBridgeSignature " +
    "against BRIDGE_WEBHOOK_PUBLIC_KEY (ten-minute replay window; valid, missing, malformed, stale or invalid, never a " +
    "failure), decodes the object with the event decoders and maps it with adaptBridgeEvent. Those, isBridgeTime, " +
    "depositRails, transferEventRef, checkExternalAccountEvent, reportTransfer, transferStateConflict and the createTransfer " +
    "failure builders call nothing; their failures are booked on the calls they follow.",
  was: [
    `${BRIDGE}/README.md:3`,
    `${BRIDGE}/service.ts:37`,
    `${BRIDGE}/service.ts:51`,
    `${BRIDGE}/service.ts:205`,
    `${BRIDGE}/service.ts:239`,
    `${BRIDGE}/types.ts:1`,
    `${BRIDGE}/internal/transport.ts:7`,
    `${BRIDGE}/internal/transport.ts:9`,
    `${BRIDGE}/internal/transport.ts:119`,
    `${BRIDGE}/internal/transport.ts:132`,
    `${BRIDGE}/internal/transport.ts:161`,
    `${BRIDGE}/internal/refusal.ts:56`,
    `${BRIDGE}/internal/transfers.ts:20`,
    `${BRIDGE}/internal/create-failures.ts:15`,
    `${BRIDGE}/internal/signature.ts:11`,
    `${BRIDGE}/internal/events.ts:48`,
    `${BRIDGE}/internal/event-objects.ts:40`,
    `${BRIDGE}/internal/answer-checks.ts:240`,
    `${BRIDGE}/internal/answer-checks.ts:254`,
    "packages/backend/src/platform/provider.ts:91",
    "packages/protocol/src/errors/provider-evidence.ts:201",
    `${SRC}/parties/verifications/external/index.ts:11`,
    `${SRC}/parties/accounts/external.ts:55`,
    `${SRC}/banking/bank-details/external.ts:31`,
    `${SRC}/banking/payouts/external.ts:49`,
    `${SRC}/banking/reconcile/external.ts:6`,
    `${SRC}/banking/webhooks/external.ts:18`,
  ],
  component: component_convex_backend,
  system: "bridge",
  service: "@capxul/backend/Bridge",
  calls: {
    createCustomer: {
      about: "POST /v0/customers: a person or business customer for verification (parties/verifications/external/index.ts:11).",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
    readCustomer: {
      about: "GET /v0/customers/{id}: the customer and its verification state (verifications/external/index.ts:21).",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
    updateCustomer: {
      about: "PUT /v0/customers/{id} with new details (verifications/external/index.ts:26).",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
    createAssociatedPerson: {
      about: "POST /v0/customers/{id}/associated_persons: an owner or controller of a business; answers its id (index.ts:31).",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
    updateAssociatedPerson: {
      about: "PUT /v0/customers/{id}/associated_persons/{person}; answers the person's id (index.ts:36).",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
    readHostedLink: {
      about:
        "GET the customer's tos_acceptance_link or kyc_link, for an endorsement when named: a terms link on " +
        "compliance.sandbox.bridge.xyz or a liveness link on bridge.withpersona.com (index.ts:46).",
      ...BRIDGE_CALL,
      failures: [
        ...bridgeFailures,
        { when: "The link is not https on the host Bridge uses for it (a decode failure)", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    createExternalAccount: {
      about: "POST /v0/customers/{id}/external_accounts: a saved bank account payouts go to (parties/accounts/external.ts:55).",
      ...BRIDGE_CALL,
      failures: [
        ...bridgeFailures,
        {
          when: "The account has no last four digits, a type that is not its currency's, or another customer, currency or last digits",
          error: error_PROVIDER_RESPONSE_INVALID,
        },
      ],
    },
    createVirtualAccount: {
      about: "POST /v0/customers/{id}/virtual_accounts: bank details that take deposits (banking/bank-details/external.ts:31).",
      ...BRIDGE_CALL,
      failures: [
        ...bridgeFailures,
        { when: "The account's deposit instructions name no bank rail", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    readVirtualAccount: {
      about: "GET /v0/customers/{id}/virtual_accounts/{account} (bank-details/external.ts:36).",
      ...BRIDGE_CALL,
      failures: [
        ...bridgeFailures,
        { when: "The account's deposit instructions name no bank rail", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    updateVirtualAccount: {
      about: "PUT the virtual account; answers only Bridge's object, which the caller confirms with a read (bank-details/external.ts:46).",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
    changeVirtualAccountState: {
      about:
        "POST the virtual account's /deactivate or /reactivate with an idempotency key; operation deactivateVirtualAccount or " +
        "reactivateVirtualAccount (bank-details/external.ts:58).",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
    readVirtualAccountHistory: {
      about: "GET the virtual account's history, one event type, limit 1: the newest activation, deactivation or update (external.ts:80).",
      ...BRIDGE_CALL,
      failures: [
        ...bridgeFailures,
        { when: "The entry names another virtual account", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    readExchangeRate: {
      about: "GET /v0/exchange_rates?from&to: the sell rate a payout quote uses (banking/payouts/external.ts:11).",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures],
    },
    createTransfer: {
      about:
        "POST /v0/transfers keyed by the payout's railOperationId: Base USDC or EURC from the payer's Safe to a saved bank " +
        "account, a fixed source or a fixed output amount (payouts/external.ts:49, 58).",
      ...BRIDGE_CALL,
      failures: [
        ...bridgeFailures,
        { when: "Bridge refused only the amount (400, 404 or 422 on amount or destination.amount), with Bridge's reason", error: error_INVALID_INPUT },
        {
          when: "The transfer names another customer, payer, account, rail, asset or amount, or funding above the cap; details.transferId kept to cancel it",
          error: error_PROVIDER_RESPONSE_INVALID,
        },
      ],
    },
    readTransfer: {
      about:
        "GET /v0/transfers/{id}: the transfer's state (payouts/external.ts:70). Payouts then holds it to reportTransfer and " +
        "transferStateConflict (payouts/writes.ts:8), as it does a transfer event.",
      ...BRIDGE_CALL,
      failures: [
        ...bridgeFailures,
        { when: "The answer names another transfer", error: error_PROVIDER_RESPONSE_INVALID },
        {
          when: "reportTransfer: not the transfer asked for, or short of the quote's amounts; transferStateConflict: delivered for a payout never funded",
          error: error_PROVIDER_RESPONSE_INVALID,
        },
      ],
    },
    cancelTransfer: {
      about:
        "DELETE /v0/transfers/{id} with no body. A 400, 409 or 422 is the answer not_awaiting_funds, not a failure, and so is " +
        "an answer naming another state (payouts/external.ts:64).",
      ...BRIDGE_CALL,
      failures: [...bridgeFailures, { when: "The answer names another transfer", error: error_PROVIDER_RESPONSE_INVALID }],
    },
    listWebhookEvents: {
      about:
        "GET /v0/webhook_events?limit=100, after a cursor when named: one page for the reconcile catch-up " +
        "(banking/reconcile/external.ts:6). Each object is then decoded as a pushed event's is.",
      ...BRIDGE_CALL,
      failures: [
        ...bridgeFailures,
        {
          when: "An event's object does not decode, or names another object (customerEvent, transferEvent and the rest; field event_object, no status)",
          error: error_PROVIDER_RESPONSE_INVALID,
        },
      ],
    },
  },
  fake:
    "Tests replay recorded responses through BridgeReplay (fake.ts): the same methods, door and Schemas. A devnet calls the " +
    "Bridge sandbox with its own sandbox key by default; with `up --bridge-stand-in` the backend's BRIDGE_STAND_IN_URL names " +
    "the devnet Bridge on a loopback port, which answers every call from its own world, scripted by a profile (calm, " +
    "realistic, stormy) and rules, moves the devnet test token and signs webhooks with the run's own key pair. Its answers " +
    "are canned or scripted, so they show no real Bridge review.",
  secrets: ["BRIDGE_API_KEY"],
});

// ── chainlink ───────────────────────────────────────────────────────────────────────────────

export const integration_chainlink = defineIntegration({
  id: "chainlink",
  title: "Chainlink price feeds: latest rounds",
  about:
    "Reads a Chainlink aggregator's decimals() and latestRoundData() with two eth_calls at once over a node's JSON-RPC, " +
    "through the provider door (10 s and 10,000 bytes each, no retry). It holds no key and does not go through chain-rpc: no " +
    "node list and no fallback. Only Books' price sync calls it (books/facts/external.ts:24): for each of the five feeds in " +
    "PRICE_FEEDS (USDC/USD, USDT/USD, EUR/USD, ETH/USD, BTC/USD, on Arbitrum One) it asks CAPXUL_PRICE_FEED_RPC_URL, else " +
    "the public https://arb1.arbitrum.io/rpc, five at a time, and leaves out a feed that fails, so one slow feed never holds " +
    "back the rest.",
  was: [
    "packages/backend/src/integrations/chainlink/README.md:3",
    "packages/backend/src/integrations/chainlink/feeds.ts:36",
    "packages/backend/src/integrations/chainlink/feeds.ts:52",
    "packages/backend/src/integrations/chainlink/feeds.ts:85",
    `${SRC}/books/facts/external.ts:18`,
    `${SRC}/books/facts/external.ts:24`,
    `${SRC}/books/facts/rules.ts:119`,
  ],
  component: component_convex_backend,
  system: "chainlink",
  service: "readLatestRound (chainlink/feeds.ts)",
  calls: {
    readLatestRound: {
      about:
        "One aggregator's decimals() and latestRoundData(): the answer, its decimals and the update time in ms. A round " +
        "whose answer is not positive, or that was never updated, is refused so the sync skips that feed.",
      timeoutMs: 10_000,
      retries: { max: 0, backoff: "none" },
      failures: [
        { when: "The node did not answer in 10 s, failed in transit, or answered 5xx, 429 or 408", error: error_PROVIDER_ERROR },
        { when: "The node refused the request with another failure status", error: error_PROVIDER_ERROR },
        {
          when: "The answer is not JSON, has no hex result (a JSON-RPC error has none), is over 10,000 bytes, or does not decode",
          error: error_PROVIDER_RESPONSE_INVALID,
        },
        { when: "The round's answer is not positive, or its updatedAt is zero", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
  },
  fake: "No double: a devnet and the tests read the node CAPXUL_PRICE_FEED_RPC_URL names, else the public Arbitrum One node; tests pass their own fetch.",
  secrets: [],
});

// ── companies-house ─────────────────────────────────────────────────────────────────────────

export const integration_companies_house = defineIntegration({
  id: "companies-house",
  title: "Companies House: the Protocol v4 service key and settings",
  about:
    "The backend's side of Protocol v4: which v4 deployment it runs on (CAPXUL_PROTOCOL_V4_DEPLOYMENT naming an entry of the " +
    "v4 address book, with CAPXUL_COMPANIES_HOUSE_TIER and the tier's personal and company salt namespaces; a malformed one " +
    "is ENV_MISSING), the Safe addresses that follow from Companies House, the one key the backend holds, and permissions " +
    "read as hats. Companies House is the bootstrap owner of every personal and company Safe. The tier's service key is the " +
    "only member of its claim role (delegatecall CompaniesHouseClaimer.claim) and company role (delegatecall " +
    "CompanySafeMinter.mint), and also pays the gas of the Installer's permissionless deployMoney. A send signs at the node's " +
    "pending nonce and holds the key's sender lane (accounts/lanes withServiceLane) until its receipt. Concepts also import " +
    "parts that call nothing: protocolV4 and requireProtocolV4 (the latter throws ENV_MISSING when no deployment is named), " +
    "personalSafeAddress, personalSafeBootstrapOwner, companySafeAddress, paymentsRouterAddress (v4 Payments, else " +
    "CapxulPaymentsV3), serviceSender (the key's address, ENV_MISSING without it), personalClaimCall and companyMintCall. A " +
    "deployment without CAPXUL_PROTOCOL_V4_DEPLOYMENT keeps the earlier personal Safe derivation from the fixed bootstrap " +
    "owner, and its claims refuse with ENV_MISSING.",
  was: [
    `${HOUSE}/README.md:3`,
    `${HOUSE}/config.ts:45`,
    `${HOUSE}/config.ts:64`,
    `${HOUSE}/addresses.ts:20`,
    `${HOUSE}/addresses.ts:58`,
    `${HOUSE}/service.ts:29`,
    `${HOUSE}/service.ts:37`,
    `${HOUSE}/service.ts:46`,
    `${HOUSE}/service.ts:80`,
    `${HOUSE}/service.ts:92`,
    `${HOUSE}/service.ts:110`,
    `${HOUSE}/service.ts:116`,
    `${HOUSE}/hats.ts:15`,
    `${HOUSE}/errors.ts:4`,
    `${HOUSE}/errors.ts:15`,
    `${SRC}/accounts/claims/external/submissions.ts:16`,
    `${SRC}/organizations/equity/external.ts:28`,
    `${SRC}/organizations/setups/external/deploys.ts:23`,
    `${SRC}/organizations/setups/external/install-checks.ts:90`,
  ],
  component: component_convex_backend,
  system: "companies-house",
  service: "companies-house (config.ts, addresses.ts, service.ts, hats.ts) over ChainRpc",
  calls: {
    signServiceCall: {
      about:
        "Simulates and prepares the call from the service key (chain-rpc prepareTransaction), then signs a type-2 transaction " +
        "locally at the node's pending nonce and fees. Claims, equity and setup deploys sign with it (submissions.ts, " +
        "equity/external.ts, deploys.ts).",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "CAPXUL_COMPANIES_HOUSE_SERVICE_KEY is unset or not a 32-byte hex key (serviceKeyInvalid)", error: error_ENV_MISSING },
        { when: "The gas estimate is not a quantity or is zero", error: error_PROVIDER_ERROR },
      ],
    },
    confirmServiceTransaction: {
      about:
        "Waits for a sent service transaction's receipt (chain-rpc waitForTransactionReceipt: 2 s polls, 120 s); a reverted " +
        "receipt is the chain's final answer, never retried. Claims, equity and setup confirm with it.",
      timeoutMs: 120_000,
      retries: { max: 3, backoff: "none" },
      failures: [
        ...nodeFailures,
        { when: "No receipt by the 120 s deadline (mode timeout)", error: error_PROVIDER_ERROR },
        {
          when: "The receipt reverted (serviceTransactionReverted: provider chain, mode revert, upstream node_1)",
          error: error_PROVIDER_ERROR,
        },
      ],
    },
    sendServiceCall: {
      about:
        "signServiceCall, eth_sendRawTransaction of the exact bytes (broadcastTransaction), then confirmServiceTransaction. " +
        "Organization setup mints the company Safe and pays for deployMoney with it (setups/external/deploys.ts).",
      timeoutMs: 120_000,
      retries: { max: 3, backoff: "none" },
      failures: [
        ...nodeFailures,
        { when: "CAPXUL_COMPANIES_HOUSE_SERVICE_KEY is unset or not a 32-byte hex key (serviceKeyInvalid)", error: error_ENV_MISSING },
        { when: "The gas estimate is not a quantity or is zero, or the node answered another transaction hash", error: error_PROVIDER_ERROR },
        { when: "No receipt by the 120 s deadline (mode timeout)", error: error_PROVIDER_ERROR },
        { when: "The receipt reverted (serviceTransactionReverted, mode revert)", error: error_PROVIDER_ERROR },
      ],
    },
    readWornHats: {
      about:
        "Hats Protocol isWearerOfHat(wearer, hat) for each hat at once, by eth_call at `latest` or at one block. Setup checks " +
        "the founder wears the Director and officer hats (install-checks.ts:90). An answer that is not an ABI bool dies.",
      ...NODE,
      failures: [
        ...nodeFailures,
        { when: "The node answered `0x`: no code at the address or an empty return (mode unknown)", error: error_PROVIDER_ERROR },
      ],
    },
  },
  fake:
    "The devnet runs the `devnet` entry of the v4 address book (chain 84532) with a stand-in Companies House " +
    "(0x38d9772b87a52Ed4615E2c804414f0cDD4854F2F) whose stand-in service key the DevNet passes as " +
    "CAPXUL_COMPANIES_HOUSE_SERVICE_KEY. It reaches the devnet chain through chain-rpc.",
  secrets: ["CAPXUL_COMPANIES_HOUSE_SERVICE_KEY"],
});

// ── posthog ─────────────────────────────────────────────────────────────────────────────────

const posthogPostFailures = [
  { when: "No answer by the caller's deadline (mode timeout) or none at all (upstream-down)", error: error_PROVIDER_ERROR },
  { when: "PostHog refused the post: a failure by its status, with its bounded, masked body", error: error_PROVIDER_ERROR },
] as const;

export const integration_posthog = defineIntegration({
  id: "posthog",
  title: "PostHog: feature flags in, events and OTLP out",
  about:
    "Two directions. In: readFlagDefinitions reads the project's feature flag definitions with the server-only personal key " +
    "(POSTHOG_FLAGS_API_KEY, project POSTHOG_FLAGS_PROJECT_ID, host POSTHOG_FLAGS_HOST else https://us.posthog.com). Only " +
    "the Access features sync calls it; without a key or project it reads nothing and the run is recorded failed, and the " +
    "copy goes stale after ten minutes. No client asks PostHog for a flag (ADR-0016). Out: the observation platform posts " +
    "catalog events, $exception rows and identity calls to /capture/ (postPostHogEvent) and OTLP logs and traces " +
    "(postHogIngest) with the project token (POSTHOG_PROJECT_TOKEN, POSTHOG_PROECT_TOKEN or POSTHOG_INGEST_KEY) to " +
    "POSTHOG_HOST, else https://app.posthog.com, through postWithoutAnswer, which reads only the status. Concepts never call " +
    "these two directly: Telemetry, the wide event, chain tracing and the failure reporters do. A post's failure is recorded " +
    "as a dropped delivery and never replaces the domain result.",
  was: [
    "packages/backend/src/integrations/posthog/README.md:3",
    "packages/backend/src/integrations/posthog/flags.ts:56",
    "packages/backend/src/integrations/posthog/flags.ts:62",
    `${SRC}/access/features/external.ts:21`,
    `${SRC}/access/features/rules.ts:82`,
    `${OBS}/posthog.ts:171`,
    `${OBS}/posthog.ts:184`,
    `${OBS}/posthog.ts:244`,
    `${OBS}/posthog.ts:284`,
    "packages/backend/src/platform/provider.ts:240",
    `${OBS}/telemetry.ts:40`,
    `${OBS}/posthog-failure.ts:13`,
    `${OBS}/wide-event.ts:106`,
    `${OBS}/chain-tracing.ts:51`,
  ],
  component: component_convex_backend,
  system: "posthog",
  service: "readFlagDefinitions (posthog/flags.ts); postPostHogEvent and postHogIngest (platform/observation/posthog.ts)",
  calls: {
    readFlagDefinitions: {
      about:
        "GET /api/projects/{id}/feature_flags/?limit=100 with the bearer, page by page (at most 10 pages, 10 s and 1 MB each), " +
        "following `next` only on the same origin; every failure withholds its cause (access/features/external.ts:25).",
      timeoutMs: 10_000,
      retries: { max: 0, backoff: "none" },
      failures: [
        { when: "PostHog did not answer in 10 s, failed in transit, or answered 5xx, 429 or 408", error: error_PROVIDER_ERROR },
        { when: "PostHog refused the request with another failure status (401, 403, 400, 404, 422)", error: error_PROVIDER_ERROR },
        { when: "A page is not JSON, does not decode, or is longer than 1,000,000 bytes", error: error_PROVIDER_RESPONSE_INVALID },
      ],
    },
    postPostHogEvent: {
      about:
        "POST {host}/capture/ with the token and one event, reading only the status; disabled, local or devnet echo without a " +
        "post. Callers bound it: 1 s for an awaited catalog event (telemetry.ts:40), 5 s for a failure report.",
      timeoutMs: 5_000,
      retries: { max: 0, backoff: "none" },
      failures: [...posthogPostFailures],
    },
    postHogIngest: {
      about:
        "The OTLP side: a wide-event Log body to the logs endpoint (5 s, wide-event.ts:106) or spans to the traces endpoint " +
        "(1 s, chain-tracing.ts:51), the token as bearer; nothing to post when no token is set outside a devnet.",
      timeoutMs: 5_000,
      retries: { max: 0, backoff: "none" },
      failures: [...posthogPostFailures],
    },
  },
  fake:
    "No double. A local environment exports nothing; a devnet writes each capture and OTLP body to the Convex log " +
    "([CAPXUL_TELEMETRY_LOCAL]) and posts only when its bootstrap names a valid ingest host and public token. The flags sync " +
    "has no stand-in. Tests script fetch.",
  secrets: ["POSTHOG_FLAGS_API_KEY"],
});

// ── roles ───────────────────────────────────────────────────────────────────────────────────

export const integration_roles = defineIntegration({
  id: "roles",
  title: "Zodiac Roles SDK: role and condition encoding",
  about:
    "The V8 adapter for the installed zodiac-roles-sdk: its setUpRoles and the condition builders c.calldataMatches and " +
    "c.callWithinAllowance, injected into the @capxul/protocol compilers that take an encoder. It runs inside the Convex " +
    "function, reaches no network and grants nothing; the calls it returns are what a Safe later signs. Convex V8 refuses a " +
    "dynamic import, so zodiac.ts imports the SDK statically and fills the entry-loaded slot, and only the convex/ entries " +
    "that encode Roles import it; an entry that encodes without it dies at run time and fails `vp run bundles:backend`. " +
    "Permissions compiles policies and invitation authorizations, payroll builds department and budget batches, and " +
    "Organization setup builds the solo bootstrap. A throw reaches the caller as a plain error, which it admits by code or " +
    "lets die. No timeout of its own: a call is bounded by its caller's Convex function, 1 s for a query or mutation " +
    "(operator/jobs/operations/run.ts:89 names the mutation limit) and ten minutes for an action (ponder/pages.ts:40).",
  was: [
    "packages/backend/src/integrations/roles/README.md:3",
    "packages/backend/src/integrations/roles/encoding.ts:46",
    "packages/backend/src/integrations/roles/encoding.ts:52",
    "packages/backend/src/integrations/roles/encoding.ts:73",
    "packages/backend/src/integrations/roles/encoding.ts:79",
    "packages/backend/src/integrations/roles/zodiac.ts:10",
    `${SRC}/permissions/rules/encoding.ts:146`,
    `${SRC}/permissions/rules/invitations.ts:3`,
    `${SRC}/payroll/departments/external.ts:258`,
    `${SRC}/organizations/setups/external/authorizations.ts:51`,
    `${SRC}/organizations/external.ts:8`,
    `${SRC}/operator/jobs/operations/run.ts:89`,
  ],
  component: component_convex_backend,
  system: "zodiac-roles-sdk",
  service: "rolesSdk (entry-loaded zodiac-roles-sdk)",
  calls: {
    encodeRoles: {
      about:
        "setUpRoles for one module address and its role configs, members copied: the Roles calls that set them up. Permissions " +
        "rules and payroll department batches use it (encoding.ts:146, departments/external.ts:258).",
      timeoutMs: 1_000,
      retries: { max: 0, backoff: "none" },
      failures: [
        { when: "The SDK or a compiler threw on a config it refuses; payroll admits INVALID_INPUT, any other throw dies", error: error_INVALID_INPUT },
      ],
    },
    buildConvexInvitationAuthorizationCalls: {
      about:
        "An invitation's Roles authorization calls, compiled with setUpRoles and the two condition builders. Permissions " +
        "calls it in queries and mutations (rules/invitations.ts:3, writes/configurations.ts:3).",
      timeoutMs: 1_000,
      retries: { max: 0, backoff: "none" },
      failures: [
        { when: "Zero addresses, no role keys, repeated rights or shared keys: the compiler throws INVALID_INPUT", error: error_INVALID_INPUT },
      ],
    },
    buildConvexSoloOrgBootstrapCalls: {
      about:
        "The solo Organization bootstrap calls from setUpRoles, as a Promise. Setup builds them in an action inside " +
        "attempt(CHAIN_FAILURES), which admits only PROVIDER_ERROR and ENV_MISSING, so a compiler throw dies (authorizations.ts:51).",
      timeoutMs: 600_000,
      retries: { max: 0, backoff: "none" },
      failures: [],
    },
  },
  fake: "No double: the real zodiac-roles-sdk runs in process in every environment and in tests.",
  secrets: [],
});

// ── openfort-shield (backend) ───────────────────────────────────────────────────────────────

export const integration_openfort_shield = defineIntegration({
  id: "openfort-shield",
  title: "Openfort Shield: encryption sessions for the embedded wallet",
  about:
    "The backend's Openfort client, in the src/integrations/openfort folder; booked apart from `openfort`, the SDK's signer, " +
    "because it runs in the backend. It is the fetch adapter the Openfort Better Auth plugin (@openfort/better-auth " +
    "encryptionSession) calls inside the Better Auth route in Access (access/sessions/external/auth.ts:188). Its one method " +
    "posts the deployment's encryption share to Shield with SHIELD_PUBLISHABLE_KEY and SHIELD_SECRET_KEY through the " +
    "provider door (15 s, body included; 64 KiB answer at most; no retry) and returns Shield's session id, so the browser's " +
    "embedded wallet can recover its key. Every failure withholds its cause, since a Shield error can echo the share; a " +
    "refusal keeps its masked body as details.reason, and a PROVIDER_ERROR's message names that reason because the plugin " +
    "logs only messages. A failure is reported once to PostHog (reportError, posthog_action) before the Promise rejects; " +
    "Better Auth then answers its own fixed failure.",
  was: [
    "packages/backend/src/integrations/openfort/README.md:3",
    "packages/backend/src/integrations/openfort/betterAuthClient.ts:13",
    "packages/backend/src/integrations/openfort/betterAuthClient.ts:36",
    "packages/backend/src/integrations/openfort/betterAuthClient.ts:60",
    "packages/backend/src/integrations/openfort/betterAuthClient.ts:75",
    "packages/backend/src/integrations/openfort/answers.ts:8",
    `${SRC}/access/sessions/external/auth.ts:75`,
    `${SRC}/access/sessions/external/auth.ts:188`,
    "packages/devnet/src/modules/backend/README.md:10",
  ],
  component: component_convex_backend,
  system: "openfort",
  service: "openfortBetterAuthClient (openfort/betterAuthClient.ts)",
  calls: {
    createEncryptionSession: {
      about:
        "POST {Shield base, default https://shield.openfort.io}/project/encryption-session with x-api-key, x-api-secret and " +
        "{ encryption_part }: the session id, never blank. Runs under the auth.createEncryptionSession server span.",
      timeoutMs: 15_000,
      retries: { max: 0, backoff: "none" },
      failures: [
        { when: "Shield did not answer in 15 s, failed in transit, or answered 5xx, 429 or 408", error: error_PROVIDER_ERROR },
        { when: "Shield refused with another failure status; its masked body is kept as details.reason", error: error_PROVIDER_ERROR },
        {
          when: "The answer is not JSON, is longer than 64 KiB, or has no session_id that is not blank",
          error: error_PROVIDER_RESPONSE_INVALID,
        },
      ],
    },
  },
  fake:
    "No Shield double. The devnet sets dummy SHIELD_PUBLISHABLE_KEY, SHIELD_SECRET_KEY and SHIELD_ENCRYPTION_SHARE so the " +
    "auth mount deploys; tests script fetch.",
  secrets: ["SHIELD_PUBLISHABLE_KEY", "SHIELD_SECRET_KEY", "SHIELD_ENCRYPTION_SHARE"],
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
    paid: {
      signature: "paid(bytes32) view returns (bool)",
      about:
        "A v4 company Safe's rejection call is Payments.paid(bytes32(0)), a read that only uses up the rejected proposal's " +
        "nonce, since the Gate refuses an empty call to the Safe (company-gate.ts:165).",
    },
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
    authorised: {
      signature: "authorised(uint256 id, address who) view returns (bool)",
      about: "Whether `who` may act on a budget: the authority Agreements uses; payroll reads it before an offer (agreements-v4.ts:90).",
    },
    budgetCount: {
      signature: "budgetCount() view returns (uint256)",
      about: "The newest budget id; payroll and allowance reads scan budgets with it (agreements-v4.ts:100, allowance-budgets.ts:68).",
    },
    budgetOf: {
      signature:
        "budgetOf(uint256 id) view returns ((address safe, uint256 parent, uint256 hat, address token, uint8 period, uint8 depth, " +
        "bool closed, uint128 amount, uint128 childrenAmount, uint128 ownSpent, uint128 ownCommitted, uint128 spent, " +
        "uint128 committed, uint64 periodIndex) b)",
      about: "A budget's Safe, parent, hat, token, period and what it has spent and committed (agreements-v4-reads.ts:48).",
    },
    pathOf: {
      signature: "pathOf(uint256 id) view returns (uint256[] path)",
      about: "A budget's ancestry up to its top budget (agreements-v4.ts:113).",
    },
    configs: {
      signature: "configs(address safe) view returns (address, bytes32)",
      about: "The Roles module and payout role a Safe's budgets pay through (agreements-v4-reads.ts:209).",
    },
    createTopBudget: {
      signature: "createTopBudget(address token, uint8 period, uint128 amount, uint256 hat) returns (uint256 id)",
      about: "A department's top budget in one token for a hat, in the company Safe's batch (department-budgets.ts:172).",
    },
    createChildBudget: {
      signature: "createChildBudget(uint256 parent, uint128 amount, uint256 hat) returns (uint256 id)",
      about: "A child budget under a parent for a hat: a spending allowance (allowance-budgets.ts:135).",
    },
    setAmount: {
      signature: "setAmount(uint256 id, uint128 amount)",
      about: "A budget's amount changed (budget-amounts.ts:132, allowance-writes.ts:62).",
    },
    close: { signature: "close(uint256 id)", about: "Closes a budget (budget-amounts.ts:185)." },
    reopen: { signature: "reopen(uint256 id)", about: "Reopens a closed budget (budget-amounts.ts:185)." },
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
    ScheduleCancelled: {
      signature: "ScheduleCancelled(address indexed safe, uint256 indexed budgetId, uint256 indexed scheduledId)",
      about: "A dated payment's reservation freed; decoded beside PaymentScheduled in a reschedule's receipt and passed over (budget-payments.ts:167).",
    },
    BudgetCreated: {
      signature:
        "BudgetCreated(address indexed safe, uint256 indexed id, uint256 indexed parent, address token, uint8 period, " +
        "uint128 amount, uint256 hat)",
      about: "A budget was made; the indexer records it as Budgets evidence (apps/indexer/src/v4/budgets/handlers.ts:6).",
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
    transfer: {
      signature: "transfer(address to, uint256 amount)",
      about: "A Director's direct token payment from the company Safe (director-payments.ts:25).",
    },
    symbol: {
      signature: "symbol() view returns (string)",
      about: "Books reads a token's symbol when it adds an asset, falling back to a bytes32 symbol (books/assets/external.ts:38, 41).",
    },
    decimals: {
      signature: "decimals() view returns (uint8)",
      about: "Books reads a token's decimals when it adds an asset (books/assets/external.ts:51).",
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
    setUp: {
      signature: "setUp(bytes initParams)",
      about: "The proxy's initializer, passed to ModuleProxyFactory.deployModule when setup deploys the module (roles-module.ts:79).",
    },
    setTransactionUnwrapper: {
      signature: "setTransactionUnwrapper(address target, bytes4 selector, address adapter)",
      about: "Registers the MultiSend unwrapper at setup, so a role sees each call of a batch (roles-module.ts:158).",
    },
    assignRoles: {
      signature: "assignRoles(address module, bytes32[] roleKeys, bool[] memberOf)",
      about: "Gives or takes a member's roles: setup, invitations, payroll departments (payroll-department-calls.ts:116).",
    },
    setAllowance: {
      signature:
        "setAllowance(bytes32 key, uint128 balance, uint128 maxRefill, uint128 refill, uint64 period, uint64 timestamp)",
      about: "Sets a capped allowance: an invitation's one-use counter or a spending cap (invitation-permissions.ts:172).",
    },
    scopeTarget: {
      signature: "scopeTarget(bytes32 roleKey, address targetAddress)",
      about: "Scopes a role to one target; Companies House's claim and company roles and setUpRoles output use it (companies-house-scopes.ts:126).",
    },
    scopeFunction: {
      signature:
        "scopeFunction(bytes32 roleKey, address targetAddress, bytes4 selector, (uint8 parent, uint8 paramType, uint8 operator, " +
        "bytes compValue)[] conditions, uint8 options)",
      about: "Allows one function under flat conditions (companies-house-scopes.ts:135).",
    },
    revokeTarget: {
      signature: "revokeTarget(bytes32 roleKey, address targetAddress)",
      about: "Takes a target away from a role when a Permission is revoked (permission-revocation.ts:106).",
    },
    revokeFunction: {
      signature: "revokeFunction(bytes32 roleKey, address targetAddress, bytes4 selector)",
      about: "Takes one function away from a role when a Permission is revoked (permission-revocation.ts:123).",
    },
    owner: {
      signature: "owner() view returns (address)",
      about: "Read at a receipt block to prove the module's wiring (chain-evidence authority-state.ts:62).",
    },
    avatar: {
      signature: "avatar() view returns (address)",
      about: "The Safe the module acts for, read at a receipt block (authority-state.ts:63); the indexer reads it too.",
    },
    target: {
      signature: "target() view returns (address)",
      about: "The Safe the module calls, read at a receipt block (authority-state.ts:64); the indexer reads it too.",
    },
    unwrappers: {
      signature: "unwrappers(bytes32 key) view returns (address adapter)",
      about: "The registered MultiSend unwrapper, read at a receipt block (authority-state.ts:67).",
    },
  },
  events: {
    RolesModSetup: {
      signature: "RolesModSetup(address indexed initiator, address indexed owner, address indexed avatar, address target)",
      about: "A module was set up: the indexer records it and setup finds its bootstrap by it (apps/indexer/src/abis.ts:38).",
    },
    AssignRoles: {
      signature: "AssignRoles(address module, bytes32[] roleKeys, bool[] memberOf)",
      about: "A member's roles changed: the indexer's role assignments, and an invitation's proof (invitation-events.ts:2).",
    },
    AllowTarget: {
      signature: "AllowTarget(bytes32 roleKey, address targetAddress, uint8 options)",
      about: "Permission authority evidence, read from receipts and indexed (authority-contract.ts:98, abis.ts:40).",
    },
    ScopeTarget: {
      signature: "ScopeTarget(bytes32 roleKey, address targetAddress)",
      about: "Permission authority evidence, read from receipts and indexed.",
    },
    RevokeTarget: {
      signature: "RevokeTarget(bytes32 roleKey, address targetAddress)",
      about: "Permission authority evidence, read from receipts and indexed.",
    },
    AllowFunction: {
      signature: "AllowFunction(bytes32 roleKey, address targetAddress, bytes4 selector, uint8 options)",
      about: "Permission authority evidence, read from receipts and indexed.",
    },
    RevokeFunction: {
      signature: "RevokeFunction(bytes32 roleKey, address targetAddress, bytes4 selector)",
      about: "Permission authority evidence, read from receipts and indexed.",
    },
    ScopeFunction: {
      signature:
        "ScopeFunction(bytes32 roleKey, address targetAddress, bytes4 selector, (uint8 parent, uint8 paramType, uint8 operator, " +
        "bytes compValue)[] conditions, uint8 options)",
      about: "Decoded from its own ABI item by the indexer and the receipt reader (zodiac-abi.ts:164).",
    },
    SetAllowance: {
      signature:
        "SetAllowance(bytes32 allowanceKey, uint128 balance, uint128 maxRefill, uint128 refill, uint64 period, uint64 timestamp)",
      about: "An allowance set: Permission evidence and the indexer's allowance facts.",
    },
    SetUnwrapAdapter: {
      signature: "SetUnwrapAdapter(address to, bytes4 selector, address adapter)",
      about: "The MultiSend unwrapper registered, checked in setup's receipt (authority-contract.ts:177).",
    },
    ConsumeAllowance: {
      signature: "ConsumeAllowance(bytes32, uint128, uint128)",
      about: "An invitation's one-use counter consumed; the EOA invitation proof requires exactly one (invitation-events.ts:48).",
    },
  },
});

// ── Protocol v4 contracts (packages/contracts/v4/src) ───────────────────────────────────────

const V4_NOTE =
  "The address is the v4 address book's devnet deployment, the only one it lists (chain 84532, the devnet's fork of Base Sepolia).";
const CLONE_NOTE =
  "The Installer clones it once per company (EIP-1167), so the listed address is the implementation, not a company's contract.";

export const contract_companies_house_claimer = defineContract({
  id: "companies-house-claimer",
  title: "CompaniesHouseClaimer: a personal Safe claimed for its signer",
  about:
    "The one thing a tier's claim role may do. Companies House's Roles delegatecalls `claim` with the tier's personal " +
    "namespace pinned, so it runs as Companies House: it deploys the email's personal Safe if it is not there and swaps " +
    "Companies House out for the person's signer. The backend's service key sends the role call (personalClaimCall, " +
    "buildCompaniesHouseClaimCall); the indexer records CapxulSafeClaimed. The beta claimer (packages/contracts/src, the same " +
    "interface) has a pinned CREATE2 address, 0x74d0bf6b2aa41642666c1338207855e3ac76dc54, which claimerSafeDeployment treats " +
    `as the default claimer, compiled against Safe 1.4.1. ${V4_NOTE}`,
  was: [
    `${V4}/companies-house/CompaniesHouseClaimer.sol:58`,
    `${V4}/companies-house/CompaniesHouseClaimer.sol:98`,
    `${BETA}/CompaniesHouseClaimer.sol:58`,
    `${V4ADDR}:44`,
    `${EVM}/companies-house-roles.ts:65`,
    `${EVM}/companies-house-roles.ts:168`,
    `${EVM}/companies-house.ts:76`,
    `${HOUSE}/service.ts:116`,
    `${IDX}/v4/companies-house-claimer/source.ts:5`,
  ],
  addresses: { devnet: "0xd8e60BeB4C15a31E804D76878941ce569D0bCcA8" },
  functions: {
    claim: {
      signature: "claim(string namespace, string email, address signer) returns (address safe)",
      about: "Delegatecalled by Companies House's claim role: the email's Safe, deployed if needed, with `signer` its sole owner.",
    },
  },
  events: {
    CapxulSafeClaimed: {
      signature: "CapxulSafeClaimed(address indexed safe, address indexed signer, bool deployed)",
      about: "A personal Safe was claimed; indexed as Companies House evidence.",
    },
  },
});

export const contract_company_safe_minter = defineContract({
  id: "company-safe-minter",
  title: "CompanySafeMinter: a company Safe for its founder",
  about:
    "The one thing a tier's company role may do: delegatecalled by Companies House's Roles with the tier's company namespace " +
    "pinned, it deploys the company's Safe if it is not there and swaps Companies House out for the founder's personal Safe. " +
    "Organization setup sends the role call through the service key (companyMintCall, sendServiceCall); the indexer records " +
    `CompanySafeMinted. companySafeAddress derives the same address off chain. ${V4_NOTE}`,
  was: [
    `${V4}/companies-house/CompanySafeMinter.sol:47`,
    `${V4}/companies-house/CompanySafeMinter.sol:84`,
    `${V4ADDR}:45`,
    `${HOUSE}/service.ts:131`,
    `${SRC}/organizations/setups/external/deploys.ts:23`,
    `${IDX}/v4/company-safe-minter/source.ts:5`,
  ],
  addresses: { devnet: "0xCB2658277FD101424aa82344B7B4a473F6D01831" },
  functions: {
    mint: {
      signature: "mint(string namespace, string company, address founderSafe) returns (address safe)",
      about: "Delegatecalled by Companies House's company role: the company's Safe, deployed if needed, owned by the founder's Safe.",
    },
  },
  events: {
    CompanySafeMinted: {
      signature: "CompanySafeMinted(address indexed safe, address indexed founderSafe, string company, bool deployed)",
      about: "A company Safe was minted; indexed as Companies House evidence.",
    },
  },
});

export const contract_agreements = defineContract({
  id: "agreements",
  title: "Protocol v4 Agreements: recurring pay against a budget",
  about:
    "The agreement half of beta PayrollDepartments, with its accrual and release maths kept: a wearer of the budget's hat " +
    "offers, the payee's Safe accepts the exact terms, pay accrues by the Calendar and is released in steps the payee " +
    "collects. Every reservation lives in Budgets and every collection is paid by Budgets.payReserved; authority is " +
    "Budgets.authorised. Payroll encodes offers and changes from the company Safe and collects from the payee's, reads an " +
    "agreement's terms, earned and available pay, and decodes its events from a receipt; the indexer records " +
    `AgreementOffered. ${V4_NOTE}`,
  was: [
    `${V4}/money/Agreements.sol:15`,
    `${V4ADDR}:48`,
    `${EVM}/agreements-v4-abi.ts:10`,
    `${EVM}/agreements-v4.ts:52`,
    `${EVM}/agreements-v4-writes.ts:23`,
    `${EVM}/agreements-v4-reads.ts:79`,
    `${EVM}/agreements-v4-reads.ts:153`,
    `${EVM}/agreements-v4-payee-calls.ts:30`,
    `${IDX}/v4/agreements/handlers.ts:1`,
  ],
  addresses: { devnet: "0x9122a17335e8aa9f1d3661a04458b963bb39302C" },
  functions: {
    offer: {
      signature:
        "offer(uint256 budgetId, address payee, uint128 rate, uint8 period, uint64 startsAt, uint64 endsAt, uint64 step, " +
        "uint64 offerExpiresAt, bytes32 documentHash) returns (uint256 id)",
      about: "An offer from a budget, reserving its cost there (agreements-v4.ts:52).",
    },
    accept: {
      signature: "accept(uint256 id, bytes32 termsHash)",
      about: "The payee's Safe accepts the exact terms (agreements-v4-payee-calls.ts:30).",
    },
    collect: {
      signature: "collect(uint256 id, uint128 amount)",
      about: "The payee's Safe collects released pay, paid through Budgets.payReserved (agreements-v4-writes.ts:58).",
    },
    withdrawOffer: { signature: "withdrawOffer(uint256 id)", about: "Withdraws an offer not yet accepted (agreements-v4-writes.ts:27)." },
    changeRate: {
      signature: "changeRate(uint256 id, uint128 newRate, uint64 effectiveAt)",
      about: "A rate change from a date (agreements-v4-writes.ts:29).",
    },
    cancelChange: { signature: "cancelChange(uint256 id)", about: "Cancels a pending rate change (agreements-v4-writes.ts:35)." },
    pause: { signature: "pause(uint256 id)", about: "Pauses accrual (agreements-v4-writes.ts:37)." },
    resume: { signature: "resume(uint256 id)", about: "Resumes accrual (agreements-v4-writes.ts:39)." },
    end: { signature: "end(uint256 id, uint64 endsAt)", about: "Ends the agreement at a time (agreements-v4-writes.ts:41)." },
    agreementOf: {
      signature:
        "agreementOf(uint256 id) view returns ((address safe, uint256 budgetId, address token, address payee, uint128 rate, " +
        "uint8 period, uint128 collected, uint128 reserved, uint256 earnedScaled, uint256 releasedScaled, uint64 startsAt, " +
        "uint64 step, uint64 offerExpiresAt, uint64 accruedAt, uint64 endsAt, uint64 pendingAt, uint128 pendingRate, " +
        "uint64 collections, bool accepted, bool paused, bool closed, bytes32 documentHash))",
      about: "An agreement's whole state (agreements-v4-reads.ts:79).",
    },
    earnedOf: { signature: "earnedOf(uint256 id) view returns (uint128)", about: "Pay accrued so far (agreements-v4-reads.ts:84)." },
    availableOf: {
      signature: "availableOf(uint256 id) view returns (uint128)",
      about: "Pay released and not yet collected (agreements-v4-reads.ts:89).",
    },
    openOf: {
      signature: "openOf(uint256 budgetId) view returns (uint256[])",
      about: "A budget's open agreements (agreements-v4.ts:120).",
    },
    reservation: {
      signature: "reservation(uint128 rate, uint8 period, uint8 budgetPeriod, uint64 startsAt, uint64 endsAt) pure returns (uint128)",
      about: "What an offer would reserve in its budget, read before it is offered (agreements-v4.ts:138).",
    },
  },
  events: {
    AgreementOffered: {
      signature:
        "AgreementOffered(address indexed safe, uint256 indexed budgetId, uint256 indexed id, address token, address payee, " +
        "uint128 rate, uint8 period, uint64 startsAt, uint64 step, uint64 offerExpiresAt, bytes32 documentHash)",
      about: "An offer made: indexed, and decoded from the offer's receipt for its id (agreements-v4-reads.ts:158).",
    },
    AgreementAccepted: {
      signature: "AgreementAccepted(address indexed safe, uint256 indexed id, address indexed payee, uint64 startsAt)",
      about: "Decoded from a receipt by payroll.",
    },
    AgreementEnded: {
      signature: "AgreementEnded(address indexed safe, uint256 indexed id, uint64 endsAt)",
      about: "Decoded from a receipt by payroll.",
    },
    AgreementPaused: { signature: "AgreementPaused(address indexed safe, uint256 indexed id)", about: "Decoded from a receipt by payroll." },
    AgreementResumed: {
      signature: "AgreementResumed(address indexed safe, uint256 indexed id)",
      about: "Decoded from a receipt by payroll.",
    },
    Collected: {
      signature: "Collected(address indexed safe, uint256 indexed id, address indexed payee, address token, uint128 amount, bytes32 paymentId)",
      about: "A collection paid; decoded from a receipt by payroll.",
    },
    OfferWithdrawn: { signature: "OfferWithdrawn(address indexed safe, uint256 indexed id)", about: "Decoded from a receipt by payroll." },
    RateChangeCancelled: {
      signature: "RateChangeCancelled(address indexed safe, uint256 indexed id)",
      about: "Decoded from a receipt by payroll.",
    },
    RateChanged: {
      signature: "RateChanged(address indexed safe, uint256 indexed id, uint128 rate, uint64 effectiveAt)",
      about: "Decoded from a receipt by payroll.",
    },
  },
});

const ESCROW_TERMS =
  "(address ownerSafe, address payeeSafe, address token, uint256 amount, bytes32 jobNonce, uint16 kind, bytes32 documentHash, uint8 condition)";

export const contract_escrow_factory = defineContract({
  id: "escrow-factory",
  title: "Protocol v4 EscrowFactory: fixed-term escrows",
  about:
    "Deploys a fixed-term Escrow at a deterministic address (ported from beta). Requests predicts an invoice escrow's address " +
    "off chain (predictV4EscrowAddress) and the relayer deploys it, when it has no code yet, in the same batch as its payout; " +
    `the indexer records EscrowDeployed. ${V4_NOTE}`,
  was: [
    `${V4}/money/EscrowFactory.sol:13`,
    `${V4ADDR}:49`,
    `${EVM}/escrows-v4.ts:38`,
    `${SRC}/requests/checkouts/external/escrows.ts:99`,
    `${IDX}/v4/escrow-factory/source.ts:1`,
  ],
  addresses: { devnet: "0x012aD00897a439A966Aa1396144b71E2f669082f" },
  functions: {
    deploy: {
      signature: `deploy(${ESCROW_TERMS} terms, bytes32 salt) returns (address escrow)`,
      about: "Deploys the escrow for fixed terms and a salt; the relayer sends it before payout when there is no code yet.",
    },
  },
  events: {
    EscrowDeployed: {
      signature:
        "EscrowDeployed(address indexed escrow, address indexed ownerSafe, address indexed payeeSafe, bytes32 paymentId, bytes32 salt)",
      about: "An escrow was deployed; indexed.",
    },
  },
});

export const contract_escrow = defineContract({
  id: "escrow",
  title: "Protocol v4 Escrow: one fixed payment held",
  about:
    "Holds one fixed payment until its release condition is met (ported from beta CapxulEscrow with the v4 renames and the " +
    "D11 claim condition). The relayer pays a funded invoice escrow out with `payout`, encoded with the beta escrow's ABI " +
    "(CAPXUL_ESCROW_ABI): the generated ESCROW_V4_ABI is not used. One escrow per job, so no address is listed.",
  was: [`${V4}/money/Escrow.sol:12`, `${SRC}/requests/checkouts/external/escrows.ts:67`, `${V4ABI}:14291`],
  functions: {
    payout: { signature: "payout()", about: "Releases a funded invoice escrow through Payments.send (requests/checkouts/external/escrows.ts:67)." },
  },
  events: {},
});

const VESTING_GRANT =
  "(address captable, uint8 classId, address shareholder, uint128 amount, uint64 start, uint64 cliff, uint64 end, " +
  "uint64 offerExpiresAt, uint64 revokedAt, uint128 burned, bool accepted, bool accelerateOnExit, bytes32 documentHash)";

export const contract_vesting = defineContract({
  id: "vesting",
  title: "Protocol v4 Vesting: locked unvested shares",
  about:
    "One shared contract that locks the unvested part of a shareholder's shares in their own wallet (ported from Firm " +
    "VestingController): calendar-month steps, revocation burns back into the authorised headroom, and a grant on shares " +
    "already owned needs the shareholder's acceptance. A share transfer reads lockedOf before it offers; the indexer records " +
    `every grant event and reads getGrant for an offer that lapsed. ${V4_NOTE}`,
  was: [
    `${V4}/equity/Vesting.sol:20`,
    `${V4ADDR}:50`,
    `${EVM}/share-transfer-v4-abis.ts:203`,
    `${EVM}/company-share-transfers.ts:170`,
    `${IDX}/v4/vesting/handlers.ts:82`,
  ],
  addresses: { devnet: "0x5E032cc2B9757585B15cC029ACEC5AE46fF5Ec1a" },
  functions: {
    lockedOf: {
      signature: "lockedOf(address captable, uint8 classId, address account, uint64 t) view returns (uint128)",
      about: "The shares still locked at a time (company-share-transfers.ts:170).",
    },
    getGrant: {
      signature: `getGrant(uint256 id) view returns (${VESTING_GRANT})`,
      about: "A grant's terms, read by the indexer when an offer lapses (apps/indexer/src/v4/vesting/handlers.ts:82).",
    },
  },
  events: {
    Granted: {
      signature: `Granted(address indexed safe, uint256 indexed id, address indexed shareholder, ${VESTING_GRANT} grant)`,
      about: "Indexed.",
    },
    GrantOffered: {
      signature: `GrantOffered(address indexed safe, uint256 indexed id, address indexed shareholder, ${VESTING_GRANT} grant)`,
      about: "Indexed.",
    },
    GrantAccepted: { signature: "GrantAccepted(address indexed safe, uint256 indexed id)", about: "Indexed." },
    OfferLapsed: { signature: "OfferLapsed(address indexed safe, uint256 indexed id)", about: "Indexed, with a getGrant read." },
    Accelerated: {
      signature: "Accelerated(address indexed safe, uint256 indexed id, uint64 newEnd, bytes32 documentHash)",
      about: "Indexed.",
    },
    Released: { signature: "Released(address indexed safe, uint256 indexed id)", about: "Indexed." },
    Revoked: { signature: "Revoked(address indexed safe, uint256 indexed id, uint64 effectiveAt)", about: "Indexed." },
    RevocationSettled: {
      signature: "RevocationSettled(address indexed safe, uint256 indexed id, uint128 burned)",
      about: "Indexed.",
    },
  },
});

const CLASS_PARAMS =
  "(string name, string ticker, uint16 weight, uint8 convertsInto, uint8 rule, address customRule, uint128 authorised, " +
  "uint128 originalIssuePrice, uint128 conversionFloorPrice, uint128 preferenceMultipleBps, bool participating, " +
  "uint8 seniority, bytes32 termsHash)";

export const contract_captable = defineContract({
  id: "captable",
  title: "Protocol v4 Captable: a company's share classes",
  about:
    "One registry per company holding every share class (ported from Firm Captable). Organization equity issues shares, " +
    "sets a class's authorised amount (through a vote), consents to transfers, and reads classes, reserved convertibles, the " +
    "exit flag, votes and the Vesting contract; the indexer records every class, issue, transfer and vote event. " +
    `${CLONE_NOTE} ${V4_NOTE}`,
  was: [
    `${V4}/equity/Captable.sol:19`,
    `${V4ADDR}:51`,
    `${EVM}/company-equity-issue.ts:34`,
    `${EVM}/company-votes.ts:66`,
    `${EVM}/company-share-transfers.ts:39`,
    `${EVM}/company-rounds.ts:64`,
    `${IDX}/v4/captable/handlers.ts:1`,
  ],
  addresses: { devnet: "0xC0e3Ac47f0e59AD627ED36F9146D6F366e47eeC1" },
  functions: {
    issue: {
      signature: "issue(uint8 classId, address to, uint128 amount, bytes32 reason)",
      about: "Issues shares of a class (company-equity-issue.ts:34).",
    },
    setAuthorised: {
      signature: "setAuthorised(uint8 classId, uint128 amount)",
      about: "A class's authorised amount, proposed through the Governor (company-votes.ts:66).",
    },
    consentToTransfer: {
      signature: "consentToTransfer(uint8 classId, address to, uint128 amount, bytes32 reason)",
      about: "The Board's consent to a share transfer, before the Exits offer (company-share-transfers.ts:39).",
    },
    getClass: {
      signature:
        "getClass(uint8 classId) view returns ((address token, uint16 weight, uint8 convertsInto, uint8 rule, address customRule, " +
        "address classGovernor, bool frozen, uint128 authorised, uint128 originalIssuePrice, uint128 conversionFloorPrice, " +
        "uint128 preferenceMultipleBps, bool participating, uint8 seniority, bytes32 termsHash))",
      about: "A class's token and terms, read before an issue (company-equity-issue.ts:64).",
    },
    numberOfClasses: { signature: "numberOfClasses() view returns (uint8)", about: "Read before a priced round (company-rounds.ts:64)." },
    convertibleReserved: {
      signature: "convertibleReserved(uint8 classId) view returns (uint256 reserved)",
      about: "Headroom held for conversions, read before an issue (company-equity-issue.ts:74).",
    },
    closedForExit: { signature: "closedForExit() view returns (bool)", about: "Whether a sale closed the Captable (company-equity-issue.ts:83)." },
    getVotes: { signature: "getVotes(address account) view returns (uint256 total)", about: "A holder's votes (company-votes.ts:182)." },
    vesting: { signature: "vesting() view returns (address)", about: "The Vesting contract it locks with (company-share-transfers.ts:179)." },
  },
  events: {
    ClassCreated: {
      signature: `ClassCreated(uint8 indexed classId, address indexed token, ${CLASS_PARAMS} params)`,
      about: "Indexed; the indexer also starts reading the class's ShareClass token from it (share-class/source.ts:8).",
    },
    Issued: { signature: "Issued(uint8 indexed classId, address indexed to, uint128 amount, bytes32 reason)", about: "Indexed." },
    AuthorisedSet: { signature: "AuthorisedSet(uint8 indexed classId, uint128 authorised)", about: "Indexed." },
    BurnedForExit: { signature: "BurnedForExit(uint8 indexed classId, address indexed from, uint128 amount)", about: "Indexed." },
    BurnedUnvested: { signature: "BurnedUnvested(uint8 indexed classId, address indexed from, uint128 amount)", about: "Indexed." },
    ClassFrozen: { signature: "ClassFrozen(uint8 indexed classId)", about: "Indexed." },
    ClassGovernorSet: { signature: "ClassGovernorSet(uint8 indexed classId, address indexed classGovernor)", about: "Indexed." },
    ClosedForExit: { signature: "ClosedForExit()", about: "Indexed." },
    ConversionPriceSet: { signature: "ConversionPriceSet(uint8 indexed classId, uint128 price)", about: "Indexed." },
    Converted: {
      signature: "Converted(address indexed shareholder, uint8 indexed fromClassId, uint8 indexed toClassId, uint128 amount, uint128 minted)",
      about: "Indexed.",
    },
    DelegateChanged: {
      signature: "DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate)",
      about: "Indexed.",
    },
    DelegateVotesChanged: {
      signature: "DelegateVotesChanged(address indexed delegate, uint256 previousVotes, uint256 newVotes)",
      about: "Indexed.",
    },
    ForcedTransfer: {
      signature: "ForcedTransfer(uint8 indexed classId, address indexed from, address indexed to, uint128 amount, bytes32 reason)",
      about: "Indexed.",
    },
    IssuerAllowanceSet: {
      signature: "IssuerAllowanceSet(address indexed module, uint8 indexed classId, uint128 amount)",
      about: "Indexed.",
    },
    TransferConsented: {
      signature:
        "TransferConsented(bytes32 indexed consentId, uint8 indexed classId, address indexed from, address to, uint128 amount, bytes32 reason)",
      about: "Indexed.",
    },
    TransferRuleSet: { signature: "TransferRuleSet(uint8 indexed classId, uint8 rule, address customRule)", about: "Indexed." },
  },
});

export const contract_share_class = defineContract({
  id: "share-class",
  title: "Protocol v4 ShareClass: one ERC20Votes token per class",
  about:
    "One ERC20Votes token per share class (ported from Firm EquityToken): whole shares, a timestamp clock, votes " +
    "self-delegated on first receipt, and the company Safe's shares never vote. Equity reads a holder's balance and a " +
    "class's supply; the indexer follows each class's token from Captable ClassCreated. Each class is its own clone, so the " +
    `listed address is the implementation. ${V4_NOTE}`,
  was: [
    `${V4}/equity/ShareClass.sol:26`,
    `${V4ADDR}:52`,
    `${EVM}/company-equity-cap-table.ts:11`,
    `${EVM}/company-equity-issue.ts:89`,
    `${IDX}/v4/share-class/source.ts:8`,
  ],
  addresses: { devnet: "0x620703c74ea59fdAcc275363cdab122930bE4022" },
  functions: {
    balanceOf: { signature: "balanceOf(address account) view returns (uint256)", about: "A holder's shares (company-equity-cap-table.ts:11)." },
    totalSupply: { signature: "totalSupply() view returns (uint256)", about: "A class's issued shares (company-equity-issue.ts:89)." },
  },
  events: {
    Transfer: { signature: "Transfer(address indexed from, address indexed to, uint256 value)", about: "Indexed." },
    Approval: { signature: "Approval(address indexed owner, address indexed spender, uint256 value)", about: "Indexed." },
    DelegateChanged: {
      signature: "DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate)",
      about: "Indexed.",
    },
    DelegateVotesChanged: {
      signature: "DelegateVotesChanged(address indexed delegate, uint256 previousVotes, uint256 newVotes)",
      about: "Indexed.",
    },
  },
});

export const contract_options = defineContract({
  id: "options",
  title: "Protocol v4 Options: a company's option pool",
  about:
    "A company's option pool on one class: the Board sets the pool and grants from it, the grantee accepts the exact terms " +
    "and exercises what has vested, the strike going to the Safe through Payments (kind 7) and Captable.issue minting the " +
    "shares. Equity grants options and reads the pool, what is allocated and the pool's class; the indexer records every " +
    `grant event. ${CLONE_NOTE} ${V4_NOTE}`,
  was: [`${V4}/equity/Options.sol:23`, `${V4ADDR}:53`, `${EVM}/company-options.ts:62`, `${EVM}/company-equity-cap-table.ts:21`],
  addresses: { devnet: "0x48C9BF7b1993e1E4Dc0FEE06a402B2193428A0bA" },
  functions: {
    grant: {
      signature:
        "grant(address grantee, uint128 shares, address strikeToken, uint128 strikePrice, uint64 start, uint64 cliff, uint64 end_, " +
        "uint64 offerExpiresAt, uint64 expiresAt, uint32 exerciseWindowDays, bytes32 documentHash) returns (uint256 id)",
      about: "An option grant from the pool (company-options.ts:62).",
    },
    pool: { signature: "pool() view returns (uint128)", about: "The pool's size (company-equity-cap-table.ts:21)." },
    allocated: { signature: "allocated() view returns (uint128)", about: "Options granted from the pool (company-equity-cap-table.ts:28)." },
    classId: { signature: "classId() view returns (uint8)", about: "The pool's share class (company-options.ts:94)." },
  },
  events: {
    OptionsGranted: {
      signature:
        "OptionsGranted(uint256 indexed id, address indexed grantee, (address grantee, uint128 shares, uint128 exercised, " +
        "address strikeToken, uint128 strikePrice, uint64 start, uint64 cliff, uint64 end, uint64 offerExpiresAt, uint64 expiresAt, " +
        "uint64 endedAt, uint32 exerciseWindowDays, bool accepted, bool cancelled, bytes32 documentHash) grant)",
      about: "Indexed.",
    },
    OptionsAccepted: { signature: "OptionsAccepted(uint256 indexed id, address indexed grantee)", about: "Indexed." },
    Exercised: { signature: "Exercised(uint256 indexed id, uint128 shares, uint256 paid, bytes32 paymentId)", about: "Indexed." },
    OptionsEnded: { signature: "OptionsEnded(uint256 indexed id, uint64 endedAt, uint128 returned)", about: "Indexed." },
    OptionsLapsed: { signature: "OptionsLapsed(uint256 indexed id, uint128 returned)", about: "Indexed." },
    AllEndedForExit: { signature: "AllEndedForExit()", about: "Indexed." },
    PoolSet: { signature: "PoolSet(uint128 pool)", about: "Indexed." },
  },
});

export const contract_rounds = defineContract({
  id: "rounds",
  title: "Protocol v4 Rounds: SAFE and priced fundraising",
  about:
    "A company's own fundraising: post-money SAFE rounds and priced rounds with broad-based weighted-average anti-dilution; " +
    "money leaves only through Payments (kinds 5 and 6) to the Safe. Equity creates both kinds of round from the company " +
    `Safe; the indexer records every round event. ${CLONE_NOTE} ${V4_NOTE}`,
  was: [`${V4}/equity/Rounds.sol:23`, `${V4ADDR}:54`, `${EVM}/company-rounds.ts:25`, `${EVM}/company-safe-rounds.ts:32`],
  addresses: { devnet: "0xBADe818Cc6527e27Ad073cE7f82429ceC0605e02" },
  functions: {
    createPricedRound: {
      signature:
        "createPricedRound(uint8 classId, address token, uint128 price, uint128 maxShares, uint64 payBy, bytes32 documentHash) " +
        "returns (uint256 roundId)",
      about: "A priced round on a class (company-rounds.ts:25).",
    },
    createSafeRound: {
      signature:
        "createSafeRound(address token, uint128 valuationCap, uint16 discountBps, uint64 closesAt, bytes32 documentHash) " +
        "returns (uint256 roundId)",
      about: "A SAFE round (company-safe-rounds.ts:32).",
    },
  },
  events: {
    PricedRoundCreated: {
      signature:
        "PricedRoundCreated(uint256 indexed roundId, uint8 indexed classId, address token, uint128 price, uint128 maxShares, " +
        "uint64 payBy, bytes32 documentHash)",
      about: "Indexed.",
    },
    SafeRoundCreated: {
      signature:
        "SafeRoundCreated(uint256 indexed roundId, address token, uint128 valuationCap, uint16 discountBps, uint64 closesAt, bytes32 documentHash)",
      about: "Indexed.",
    },
    Invited: { signature: "Invited(uint256 indexed roundId, address indexed investor, uint128 maxAmount)", about: "Indexed." },
    SafeInvited: { signature: "SafeInvited(uint256 indexed roundId, address indexed investor, uint128 maxAmount)", about: "Indexed." },
    Committed: {
      signature: "Committed(uint256 indexed roundId, address indexed investor, uint128 amount, bytes32 documentHash)",
      about: "Indexed.",
    },
    Allocated: { signature: "Allocated(uint256 indexed roundId, address indexed investor, uint128 shares)", about: "Indexed." },
    Paid: {
      signature: "Paid(uint256 indexed roundId, address indexed investor, uint128 shares, uint256 amount, bytes32 paymentId)",
      about: "Indexed.",
    },
    ConsentGiven: { signature: "ConsentGiven(uint256 indexed roundId, uint8 indexed classId)", about: "Indexed." },
    RoundClosed: {
      signature: "RoundClosed(uint256 indexed roundId, (uint8 classId, uint128 oldPrice, uint128 newPrice)[] adjustments)",
      about: "Indexed.",
    },
    RoundCancelled: { signature: "RoundCancelled(uint256 indexed roundId)", about: "Indexed." },
    SafeSigned: {
      signature:
        "SafeSigned(uint256 indexed roundId, uint256 indexed noteId, address indexed investor, uint128 amount, bytes32 documentHash, bytes32 paymentId)",
      about: "Indexed.",
    },
    SafeRoundClosed: { signature: "SafeRoundClosed(uint256 indexed roundId)", about: "Indexed." },
    SafesConverted: {
      signature: "SafesConverted(uint256 indexed pricedRoundId, uint256[] noteIds, uint128[] shares)",
      about: "Indexed.",
    },
  },
});

export const contract_exits = defineContract({
  id: "exits",
  title: "Protocol v4 Exits: company sales and share transfers",
  about:
    "A company sale and secondary sales: shareholders approve a sale, the Board pays every payout in one Payments.sendBatch " +
    "and settles in the same batch. Equity's share transfer offers, approves, buys and reads a transfer here (the slice " +
    `EXITS_V4_TRANSFER_ABI); the indexer records every sale and transfer event. ${CLONE_NOTE} ${V4_NOTE}`,
  was: [
    `${V4}/equity/Exits.sol:31`,
    `${V4ADDR}:55`,
    `${EVM}/share-transfer-v4-abis.ts:8`,
    `${EVM}/company-share-transfers.ts:48`,
    `${IDX}/v4/exits/handlers.ts:1`,
  ],
  addresses: { devnet: "0x3560eab3FC06C631f0309f6f1b0F2Ac3E54d22C6" },
  functions: {
    offerTransfer: {
      signature:
        "offerTransfer(uint8 classId, address buyer, uint128 shares, uint128 price, address token, bytes32 documentHash) " +
        "returns (uint256 transferId)",
      about: "A seller's offer of shares (company-share-transfers.ts:48).",
    },
    approveTransfer: { signature: "approveTransfer(uint256 transferId)", about: "The Board approves it (company-share-transfers.ts:69)." },
    buy: { signature: "buy(uint256 transferId)", about: "The buyer pays after an ERC-20 approve (company-share-transfers.ts:98)." },
    transfer: {
      signature:
        "transfer(uint256 transferId) view returns ((address seller, address buyer, uint8 classId, uint128 shares, uint128 price, " +
        "address token, bytes32 documentHash, bool approved, bool bought))",
      about: "An offer's state (company-share-transfers.ts:134).",
    },
  },
  events: {
    TransferOffered: {
      signature:
        "TransferOffered(uint256 indexed transferId, address indexed seller, address indexed buyer, uint8 classId, uint128 shares, " +
        "uint128 price, address token, bytes32 documentHash)",
      about: "Indexed.",
    },
    TransferApproved: { signature: "TransferApproved(uint256 indexed transferId)", about: "Indexed." },
    Bought: { signature: "Bought(uint256 indexed transferId, uint256 amount, bytes32 paymentId)", about: "Indexed." },
    SaleApproved: {
      signature: "SaleApproved(uint256 indexed saleId, address token, uint256 proceeds, bytes32 termsHash)",
      about: "Indexed.",
    },
    ClaimRecorded: {
      signature:
        "ClaimRecorded(uint256 indexed saleId, uint256 indexed index, address indexed payee, address escrow, address token, uint256 amount)",
      about: "Indexed.",
    },
    ClaimRedirected: {
      signature: "ClaimRedirected(uint256 indexed saleId, uint256 indexed index, address newPayee, address newEscrow)",
      about: "Indexed.",
    },
    Claimed: { signature: "Claimed(uint256 indexed saleId, uint256 indexed index, address to)", about: "Indexed." },
    Settled: { signature: "Settled(uint256 indexed saleId)", about: "Indexed." },
  },
});

export const contract_governor = defineContract({
  id: "governor",
  title: "Protocol v4 Governor: shareholder votes",
  about:
    "An OpenZeppelin 5 Governor per company (votes are the Captable's) and per class vote, with a basis-point quorum and no " +
    "timelock. Organization votes propose, cast votes with a reason and execute, and read a proposal's state, snapshot, " +
    "deadline and votes, the clock, quorum and thresholds; the indexer records ProposalCreated. The proposal id is computed " +
    `off chain as OpenZeppelin's hashProposal. ${CLONE_NOTE} ${V4_NOTE}`,
  was: [`${V4}/equity/Governor.sol:32`, `${V4ADDR}:57`, `${EVM}/company-votes.ts:27`, `${EVM}/company-votes.ts:78`, `${IDX}/v4/governor/handlers.ts:1`],
  addresses: { devnet: "0x7aA1c8Df83D4F6d77DCe4799A15d9c177702c9eA" },
  functions: {
    propose: {
      signature: "propose(address[] targets, uint256[] values, bytes[] calldatas, string description) returns (uint256)",
      about: "A proposal (company-votes.ts:134).",
    },
    castVoteWithReason: {
      signature: "castVoteWithReason(uint256 proposalId, uint8 support, string reason) returns (uint256)",
      about: "A vote with its reason (company-votes.ts:165).",
    },
    execute: {
      signature: "execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) payable returns (uint256)",
      about: "Runs a passed proposal (company-votes.ts:113).",
    },
    state: { signature: "state(uint256 proposalId) view returns (uint8)", about: "A proposal's state (company-votes.ts:192)." },
    proposalSnapshot: { signature: "proposalSnapshot(uint256 proposalId) view returns (uint256)", about: "Read with a proposal (company-votes.ts:204)." },
    proposalDeadline: { signature: "proposalDeadline(uint256 proposalId) view returns (uint256)", about: "Read with a proposal (company-votes.ts:215)." },
    proposalVotes: {
      signature: "proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
      about: "The tally (company-votes.ts:232).",
    },
    proposalThreshold: { signature: "proposalThreshold() view returns (uint256)", about: "Read before a proposal (company-votes.ts:174)." },
    quorumNumerator: { signature: "quorumNumerator() view returns (uint256)", about: "The quorum in basis points (company-votes.ts:225)." },
    quorum: { signature: "quorum(uint256 timepoint) view returns (uint256)", about: "Votes needed at a time (company-votes.ts:258)." },
    clock: { signature: "clock() view returns (uint48)", about: "The vote clock (company-votes.ts:247)." },
    getVotes: {
      signature: "getVotes(address account, uint256 timepoint) view returns (uint256)",
      about: "A voter's weight at a time (company-votes.ts:266).",
    },
    hasVoted: { signature: "hasVoted(uint256 proposalId, address account) view returns (bool)", about: "Read before a vote (company-votes.ts:277)." },
  },
  events: {
    ProposalCreated: {
      signature:
        "ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, " +
        "bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
      about: "Indexed.",
    },
  },
});

const MONEY_DEPLOYMENT =
  "(uint256 boardTopHat, uint256 shareholdersTopHat, uint256 directorHat, uint256[] officerHats, address roles, address gate)";
const EQUITY_DEPLOYMENT = "(address captable, address governor, address options, address rounds, address exits, address elections)";
const TOKEN_CONFIG = "(address token, uint128 ceiling, uint8 budgetPeriod, uint128 topAmount, uint256 topHat)";
const CALLS = "(address to, uint256 value, bytes data)[]";

export const contract_installer = defineContract({
  id: "installer",
  title: "Protocol v4 Installer: Capxul installed on a company Safe",
  about:
    "Installs the protocol onto an existing company Safe; never delegatecalled, never a module or Roles member, holding no " +
    "token and wearing no hat after a call. Each install has a permissionless deploy* (the service key pays deployMoney's " +
    "gas) and a view build* that returns the Safe's batch. Its equity half is the EquityInstaller it creates and forwards " +
    "deployEquity and buildEquity to; EquityDeployed is emitted here. Setup and equity read MoneyDeployed and EquityDeployed " +
    `from receipts; the indexer records those and ElectionsDeployed. ${V4_NOTE}`,
  was: [
    `${V4}/authority/Installer.sol:17`,
    `${V4}/authority/InstallerMoney.sol:29`,
    `${V4}/authority/InstallerElections.sol:15`,
    `${V4ADDR}:58`,
    `${EVM}/company-install.ts:79`,
    `${EVM}/company-install.ts:117`,
    `${EVM}/company-equity.ts:126`,
    `${EVM}/department-budgets.ts:199`,
    `${IDX}/v4/installer/handlers.ts:1`,
  ],
  addresses: { devnet: "0xec0cB53F65B0F0BE3fD11ACB9B6005F6c9203E2F" },
  functions: {
    deployMoney: {
      signature:
        "deployMoney((address safe, address founderSafe, address[] coDirectors, (uint8 thresholdType, uint120 min, uint120 target) " +
        "threshold, (string details, uint32 maxSupply)[] officers, bytes32 salt) p) returns (" +
        MONEY_DEPLOYMENT +
        " d)",
      about: "Deploys a company's hats, Roles and Gate; sent by the Companies House service key (company-install.ts:79).",
    },
    buildMoney: {
      signature:
        `buildMoney((address safe, address founderSafe, address[] coDirectors, ${MONEY_DEPLOYMENT} deployment, ` +
        `${TOKEN_CONFIG}[] tokens) p) view returns (${CALLS} calls)`,
      about: "The company Safe's batch that finishes the money install (company-install.ts:149).",
    },
    deployEquity: {
      signature:
        `deployEquity((address safe, ${MONEY_DEPLOYMENT} money, string name, ${CLASS_PARAMS}[] initialClasses, uint8 poolClassId, ` +
        `(uint48 votingDelay, uint32 votingPeriod, uint256 proposalThreshold, uint256 quorumNumerator) governor) p) returns (` +
        `${EQUITY_DEPLOYMENT} e)`,
      about: "Clones and wires a company's equity contracts, forwarded to the EquityInstaller (company-equity.ts:126).",
    },
    buildEquity: {
      signature:
        `buildEquity((address safe, address founderSafe, ${MONEY_DEPLOYMENT} money, ${EQUITY_DEPLOYMENT} equity, (address shareholder, ` +
        "uint8 classId, uint128 amount, uint64 start, uint64 cliff, uint64 end, bool accelerateOnExit, bytes32 documentHash)[] " +
        `founders, uint128 optionPool)) view returns (${CALLS}, ${CALLS})`,
      about: "The Safe's two batches that finish the equity install (company-equity.ts:208).",
    },
    buildAddToken: {
      signature:
        `buildAddToken((address safe, address roles, ${TOKEN_CONFIG}[] existing, ${TOKEN_CONFIG} token) p) view returns (${CALLS} calls)`,
      about: "The batch that adds a token to a company's budgets (department-budgets.ts:199).",
    },
  },
  events: {
    MoneyDeployed: {
      signature: `MoneyDeployed(address indexed safe, address indexed founderSafe, ${MONEY_DEPLOYMENT} deployment)`,
      about: "Read from deployMoney's receipt for the company's hats, Roles and Gate (company-install.ts:117); indexed.",
    },
    EquityDeployed: {
      signature: `EquityDeployed(address indexed safe, ${EQUITY_DEPLOYMENT} deployment)`,
      about: "Read from deployEquity's receipt (company-equity.ts:178); the indexer starts each company's equity sources from it.",
    },
    ElectionsDeployed: {
      signature: "ElectionsDeployed(address indexed safe, address elections, uint256 directorHat, uint128 firstTermEnd)",
      about: "Indexed. The backend and SDK never call the Hats Elections clone it names.",
    },
  },
});

export const contract_equity_installer = defineContract({
  id: "equity-installer",
  title: "Protocol v4 EquityInstaller: the Installer's equity half",
  about:
    "Kept apart so the Installer stays under the 24,576-byte limit. The Installer creates it once in its constructor and " +
    "forwards deployEquity and buildEquity calldata to it unchanged, then emits EquityDeployed itself. The backend and SDK " +
    "never call it directly: the generated EQUITY_INSTALLER_V4_ABI is not used, and the address book does not list it.",
  was: [`${V4}/authority/EquityInstaller.sol:39`, `${V4}/authority/Installer.sol:17`, `${V4ABI}:13782`],
  functions: {},
  events: {},
});

export const contract_agent_owner = defineContract({
  id: "agent-owner",
  title: "Protocol v4 AgentOwner: an agent's Safe under its owner",
  about:
    "One contract for every agent: it gives an agent a Safe of its own, with the agent's key as its one signer, and gives the " +
    "agent's owner (a person's or an Organization's Safe) full control of it without the agent's consent, as Safe 1.5.0's " +
    "transaction and module guard. Accounts' agents create, freeze, unfreeze, swap the signer, sweep and remove from the " +
    `owner's Safe, read safeAddressFor, and read AgentSwept from a sweep's receipt; the indexer records every event. ${V4_NOTE}`,
  was: [
    `${V4}/agents/AgentOwner.sol:89`,
    `${V4ADDR}:59`,
    `${EVM}/agent-owner.ts:18`,
    `${SRC}/accounts/agents/external.ts:250`,
    `${IDX}/v4/agent-owner/handlers.ts:1`,
  ],
  addresses: { devnet: "0x6C4d321fB1Bc33BcE283a255a8fA20d0fFEfd8bE" },
  functions: {
    create: { signature: "create(address signer, address owner) returns (address safe)", about: "An agent's Safe (agent-owner.ts:18)." },
    freeze: { signature: "freeze(address safe)", about: "Freezes an agent (agent-owner.ts:31)." },
    unfreeze: { signature: "unfreeze(address safe)", about: "Unfreezes it (agent-owner.ts:31)." },
    swapSigner: {
      signature: "swapSigner(address safe, address oldSigner, address newSigner)",
      about: "Replaces the agent's key (agent-owner.ts:83).",
    },
    sweep: {
      signature: "sweep(address safe, address to, address token) returns (uint256 amount)",
      about: "Moves what the agent holds of a token to the owner (agent-owner.ts:47).",
    },
    remove: { signature: "remove(address safe, address[] tokens)", about: "Sweeps and removes the agent (agent-owner.ts:63)." },
    safeAddressFor: {
      signature: "safeAddressFor(address signer, address owner) view returns (address)",
      about: "An agent's Safe address before it exists (agent-owner.ts:93).",
    },
  },
  events: {
    AgentCreated: {
      signature: "AgentCreated(address indexed safe, address indexed owner, address indexed signer)",
      about: "Indexed.",
    },
    AgentFrozen: { signature: "AgentFrozen(address indexed safe)", about: "Indexed." },
    AgentUnfrozen: { signature: "AgentUnfrozen(address indexed safe)", about: "Indexed." },
    AgentSignerSwapped: {
      signature: "AgentSignerSwapped(address indexed safe, address oldSigner, address newSigner)",
      about: "Indexed.",
    },
    AgentSwept: {
      signature: "AgentSwept(address indexed safe, address indexed to, address indexed token, uint256 amount)",
      about: "Read from a sweep's receipt for the amount (accounts/agents/external.ts:250); indexed.",
    },
    AgentRemoved: { signature: "AgentRemoved(address indexed safe)", about: "Indexed." },
  },
});

// ── beta contracts still used (packages/contracts/src) ──────────────────────────────────────

export const contract_capxul_escrow_factory = defineContract({
  id: "capxul-escrow-factory",
  title: "CapxulEscrowFactory: beta fixed-job escrows",
  about:
    "Deploys one CapxulEscrow per fixed job at a CREATE2 address that binds the owner Safe, payee Safe, token, exact amount, " +
    "job nonce, kind, document hash, condition, the V3 router and the bootstrap owner. Requests predicts the address off " +
    "chain and the relayer deploys an escrow that has no code yet in the batch that pays it out, when the escrow names no v4 " +
    `factory. ${BASE_SEPOLIA_NOTE}`,
  was: [
    `${BETA}/CapxulEscrowFactory.sol:9`,
    `${EVM}/payments-v3.ts:153`,
    `${EVM}/payments-v3.ts:240`,
    `${EVM}/escrows.ts:64`,
    `${SRC}/requests/checkouts/external/escrows.ts:88`,
  ],
  addresses: {
    devnet: "0xC452db5a78c051AA068cf9fB7eD8D8abcD4f6CD9",
    staging: "0xC452db5a78c051AA068cf9fB7eD8D8abcD4f6CD9",
  },
  functions: {
    deploy: {
      signature: `deploy(${ESCROW_TERMS} terms, bytes32 salt) returns (address escrow)`,
      about: "Deploys the escrow for fixed terms and a salt (requests/checkouts/external/escrows.ts:91).",
    },
  },
  events: {},
});

export const contract_capxul_escrow = defineContract({
  id: "capxul-escrow",
  title: "CapxulEscrow: one beta fixed-job escrow",
  about:
    "Holds one fixed payment. An invoice escrow releases when its token balance reaches the fixed amount, and anyone may " +
    "call payout, which approves the amount and calls CapxulPaymentsV3.send; a payee-claim escrow releases only on the " +
    "payee's collect. The backend's relayer calls payout only, for invoices; its ABI also encodes a v4 escrow's payout. One " +
    "escrow per job, so no address is listed.",
  was: [`${BETA}/CapxulEscrow.sol:9`, `${EVM}/escrows.ts:71`, `${SRC}/requests/checkouts/external/escrows.ts:67`, "packages/contracts/README.md:41"],
  functions: {
    payout: { signature: "payout()", about: "Releases a funded invoice escrow (requests/checkouts/external/escrows.ts:67)." },
  },
  events: {},
});

export const contract_payroll_departments = defineContract({
  id: "payroll-departments",
  title: "PayrollDepartments: beta departments and pay agreements",
  about:
    "Holds every Organization's departments keyed by its Safe: a department is a payroll budget per token and the payment " +
    "agreements its holders made from it, paid through the Safe's Roles payout role and the router. Payroll still builds " +
    "its offers, changes, budgets and configuration, the payee's accept and collect, reads agreements, budgets and " +
    `configs, and decodes the agreement events from receipts; v4 Agreements replaces it. ${BASE_SEPOLIA_NOTE}`,
  was: [
    `${BETA}/PayrollDepartments.sol:71`,
    `${EVM}/payroll-departments.ts:30`,
    `${EVM}/payroll-departments-abi.ts:4`,
    `${EVM}/payroll-agreement-calls.ts:37`,
    `${EVM}/payroll-agreement-calls.ts:214`,
    `${EVM}/payroll-department-calls.ts:94`,
    `${EVM}/payroll-payee-calls.ts:17`,
    `${SRC}/payroll/agreements/external.ts:54`,
    `${SRC}/payroll/departments/external.ts:58`,
  ],
  addresses: {
    devnet: "0x0B7b320A467443a12dEB4dC93343Dfe57c24f3Fd",
    staging: "0x0B7b320A467443a12dEB4dC93343Dfe57c24f3Fd",
  },
  functions: {
    configure: {
      signature: "configure(address roles, bytes32 payoutRoleKey, address router)",
      about: "A Safe's Roles module, payout role and router (payroll-department-calls.ts:130).",
    },
    configs: {
      signature: "configs(address safe) view returns (address roles, bytes32 payoutRoleKey, address router)",
      about: "Read before a department change (payroll/departments/external.ts:58).",
    },
    setBudget: {
      signature: "setBudget(bytes32 department, address token, uint128 budget)",
      about: "A department's budget in a token (payroll-department-calls.ts:94).",
    },
    budgetOf: {
      signature: "budgetOf(address safe, bytes32 department, address token) view returns (uint128 budget, uint128 committed)",
      about: "A department's budget and what is committed (payroll/departments/external.ts:109).",
    },
    offer: {
      signature:
        "offer(bytes32 department, address token, address payee, uint128 rate, uint8 period, uint64 startsAt, uint64 endsAt, " +
        "uint64 step, uint64 offerExpiresAt, bytes32 documentHash) returns (uint256 id)",
      about: "An agreement offer from a department (payroll-agreement-calls.ts:37).",
    },
    accept: { signature: "accept(uint256 id, bytes32 termsHash)", about: "The payee's Safe accepts (payroll-payee-calls.ts:17)." },
    collect: { signature: "collect(uint256 id, uint128 amount)", about: "The payee's Safe collects released pay (payroll-payee-calls.ts:29)." },
    withdrawOffer: { signature: "withdrawOffer(bytes32 department, uint256 id)", about: "Withdraws an offer (payroll-agreement-calls.ts:93)." },
    changeRate: {
      signature: "changeRate(bytes32 department, uint256 id, uint128 newRate, uint64 effectiveAt)",
      about: "A rate change from a date (payroll-agreement-calls.ts:99).",
    },
    cancelChange: { signature: "cancelChange(bytes32 department, uint256 id)", about: "Cancels a pending change (payroll-agreement-calls.ts:103)." },
    pause: { signature: "pause(bytes32 department, uint256 id)", about: "Pauses accrual (payroll-agreement-calls.ts:107)." },
    resume: { signature: "resume(bytes32 department, uint256 id)", about: "Resumes accrual (payroll-agreement-calls.ts:111)." },
    end: { signature: "end(bytes32 department, uint256 id, uint64 endsAt)", about: "Ends an agreement (payroll-agreement-calls.ts:115)." },
    agreementOf: {
      signature:
        "agreementOf(uint256 id) view returns ((address safe, bytes32 department, address token, address payee, uint128 rate, " +
        "uint8 period, uint128 collected, uint128 reserved, uint256 earnedScaled, uint256 releasedScaled, uint64 startsAt, " +
        "uint64 step, uint64 offerExpiresAt, uint64 accruedAt, uint64 endsAt, uint64 pendingAt, uint128 pendingRate, " +
        "uint64 collections, bool accepted, bool paused, bool closed, bytes32 documentHash))",
      about: "An agreement's whole state (payroll/agreements/external.ts:54).",
    },
    earnedOf: { signature: "earnedOf(uint256 id) view returns (uint128)", about: "Pay accrued so far (payroll/agreements/external.ts:62)." },
    availableOf: {
      signature: "availableOf(uint256 id) view returns (uint128)",
      about: "Pay released and not collected (payroll/agreements/external.ts:70).",
    },
  },
  events: {
    AgreementOffered: {
      signature:
        "AgreementOffered(address indexed safe, bytes32 indexed department, uint256 indexed id, address token, address payee, " +
        "uint128 rate, uint8 period, uint64 startsAt, uint64 step, uint64 offerExpiresAt, bytes32 documentHash)",
      about: "Decoded from an offer's receipt (payroll-agreement-calls.ts:214).",
    },
    AgreementAccepted: {
      signature: "AgreementAccepted(address indexed safe, uint256 indexed id, address indexed payee, uint64 startsAt)",
      about: "Decoded from a receipt (payroll-agreement-calls.ts:240).",
    },
    AgreementEnded: { signature: "AgreementEnded(address indexed safe, uint256 indexed id, uint64 endsAt)", about: "Decoded from a receipt." },
    AgreementPaused: { signature: "AgreementPaused(address indexed safe, uint256 indexed id)", about: "Decoded from a receipt." },
    AgreementResumed: { signature: "AgreementResumed(address indexed safe, uint256 indexed id)", about: "Decoded from a receipt." },
    Collected: {
      signature:
        "Collected(address indexed safe, uint256 indexed id, address indexed payee, address token, uint128 amount, bytes32 settlementId)",
      about: "Decoded from a receipt (payroll-agreement-calls.ts:243).",
    },
    OfferWithdrawn: { signature: "OfferWithdrawn(address indexed safe, uint256 indexed id)", about: "Decoded from a receipt." },
    RateChangeCancelled: { signature: "RateChangeCancelled(address indexed safe, uint256 indexed id)", about: "Decoded from a receipt." },
    RateChanged: {
      signature: "RateChanged(address indexed safe, uint256 indexed id, uint128 rate, uint64 effectiveAt)",
      about: "Decoded from a receipt.",
    },
  },
});

export const contract_test_money_token = defineContract({
  id: "test-money-token",
  title: "TestMoneyToken: Capxul's test money on Base Sepolia",
  about:
    "The ERC-20 behind each of Capxul's Base Sepolia test assets (test-assets.ts), with open minting. The accounts faucet " +
    "grant mints test money to a holder, and the devnet mints into Safes it sets up; everything else treats these tokens as " +
    "any ERC-20 (contract `erc20`). One token per asset, so no single address is listed.",
  was: [
    `${BETA}/TestMoneyToken.sol:8`,
    `${BETA}/TestMoneyToken.sol:22`,
    `${EVM}/test-assets.ts:21`,
    `${SRC}/accounts/grants/external/mints.ts:46`,
    "packages/devnet/src/internal/org-roles.ts:151",
  ],
  functions: {
    mint: {
      signature: "mint(address recipient, uint256 amount)",
      about: "Mints test money; open to anyone (accounts/grants/external/mints.ts:46).",
    },
    decimals: { signature: "decimals() view returns (uint8)", about: "The asset's decimals, fixed per token." },
  },
  events: {},
});

export const contract_test_asset_exchange = defineContract({
  id: "test-asset-exchange",
  title: "TestAssetExchange: a test conversion fixture",
  about:
    "A candidate-only deterministic conversion fixture: it holds seeded inventory of the test tokens and moves real token " +
    "units, but it is not a production route or a source of quotes. The backend and SDK never call it; the devnet chain " +
    "check reads its operator, token list and admitted tokens by raw selector to confirm the fork holds it. " +
    BASE_SEPOLIA_NOTE,
  was: [
    `${BETA}/TestAssetExchange.sol:10`,
    `${EVM}/assets.ts:94`,
    "packages/devnet/src/modules/chain/service.ts:294",
    "packages/devnet/src/modules/chain/service.ts:311",
  ],
  addresses: {
    devnet: "0xc3f7408994dd4f534a69d73d068163317ddfe8e8",
    staging: "0xc3f7408994dd4f534a69d73d068163317ddfe8e8",
  },
  functions: {
    operator: { signature: "operator() view returns (address)", about: "Read by the devnet chain check (selector 0x570ca735)." },
    tokens: { signature: "tokens(uint256) view returns (address)", about: "Read by the devnet chain check (selector 0x4f64b2be)." },
    admitted: { signature: "admitted(address) view returns (bool)", about: "Read by the devnet chain check (selector 0x0020d939)." },
  },
  events: {},
});

// ── third-party contracts the backend, SDK and indexer reach ────────────────────────────────

export const contract_safe = defineContract({
  id: "safe",
  title: "Safe 1.5.0: every Capxul account",
  about:
    "Every Capxul Safe runs Safe 1.5.0's SafeL2 singleton; Safes created before 2 November 2026 came from Safe 1.4.1's " +
    "factory. Setup and claims build its setup and owner changes, proposals and directors read owners, threshold, nonce " +
    "and approved hashes and build Safe transactions, setup and evidence read its modules, and the indexer records its " +
    "setup, owner, module and execution events. The listed address is the 1.5.0 SafeL2 singleton.",
  was: [
    `${EVM}/safe-contracts.ts:26`,
    `${EVM}/safe-address.ts:123`,
    `${EVM}/safe-transactions.ts:16`,
    `${EVM}/safe-transactions.ts:262`,
    `${SRC}/organizations/proposals/rules/owner-changes.ts:22`,
    `${SRC}/organizations/proposals/external.ts:48`,
    `${SRC}/organizations/setups/external/install-checks.ts:62`,
    `${EVIDENCE}/internal/authority-contract.ts:44`,
    `${IDX}/abis.ts:13`,
  ],
  addresses: {
    devnet: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e",
    staging: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e",
  },
  functions: {
    setup: {
      signature:
        "setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, " +
        "uint256 payment, address paymentReceiver)",
      about: "A new Safe's initializer: one owner, MultiSend delegatecall enabling Safe4337Module, the module as fallback (safe-address.ts:123).",
    },
    execTransaction: {
      signature:
        "execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, " +
        "uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
      about: "A Safe transaction with zero gas fields, so any caller pays its own gas (safe-transactions.ts:171).",
    },
    approveHash: { signature: "approveHash(bytes32 hashToApprove)", about: "An owner approves a Safe transaction hash (safe-transactions.ts:141)." },
    approvedHashes: {
      signature: "approvedHashes(address owner, bytes32 hash) view returns (uint256)",
      about: "Which owners approved a proposal (organizations/proposals/external.ts:100).",
    },
    getOwners: { signature: "getOwners() view returns (address[])", about: "Read through chain-rpc fetchSafeOwners and by setup (install-checks.ts:62)." },
    getThreshold: { signature: "getThreshold() view returns (uint256)", about: "Read by proposals (organizations/proposals/external.ts:55)." },
    nonce: { signature: "nonce() view returns (uint256)", about: "Read by proposals and setup installs (setups/external/installs.ts:68)." },
    addOwnerWithThreshold: {
      signature: "addOwnerWithThreshold(address owner, uint256 _threshold)",
      about: "Adds a director as owner (proposals/rules/owner-changes.ts:140).",
    },
    removeOwner: {
      signature: "removeOwner(address prevOwner, address owner, uint256 _threshold)",
      about: "Removes an owner (proposals/rules/owner-changes.ts:175).",
    },
    swapOwner: {
      signature: "swapOwner(address prevOwner, address oldOwner, address newOwner)",
      about: "A claim swaps the bootstrap owner for the signer (safe-transactions.ts:262).",
    },
    changeThreshold: { signature: "changeThreshold(uint256 _threshold)", about: "A new threshold (proposals/rules/owner-changes.ts:250)." },
    enableModule: { signature: "enableModule(address module)", about: "Enables a Roles module at setup (roles-module.ts:143)." },
    disableModule: {
      signature: "disableModule(address prevModule, address module)",
      about: "Disables the old module when a Permission module is replaced (permission-replacement.ts:96).",
    },
    isModuleEnabled: {
      signature: "isModuleEnabled(address module) view returns (bool)",
      about: "Read at a receipt block by setup and chain evidence (authority-state.ts:72, setups/external/contracts.ts:31).",
    },
    getModulesPaginated: {
      signature: "getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
      about: "A Safe's modules, read by setup and the indexer (install-checks.ts:70).",
    },
  },
  events: {
    SafeSetup: {
      signature: "SafeSetup(address indexed initiator, address[] owners, uint256 threshold, address initializer, address fallbackHandler)",
      about: "Indexed.",
    },
    AddedOwner: { signature: "AddedOwner(address owner)", about: "Indexed." },
    RemovedOwner: { signature: "RemovedOwner(address owner)", about: "Indexed." },
    ChangedThreshold: { signature: "ChangedThreshold(uint256 threshold)", about: "Indexed." },
    EnabledModule: { signature: "EnabledModule(address indexed module)", about: "Indexed, and checked in setup receipts." },
    DisabledModule: { signature: "DisabledModule(address indexed module)", about: "Indexed, and checked in a replacement's receipt." },
    SafeReceived: { signature: "SafeReceived(address indexed sender, uint256 value)", about: "Native money received; indexed." },
    SafeMultiSigTransaction: {
      signature:
        "SafeMultiSigTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, " +
        "uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures, bytes additionalInfo)",
      about: "Indexed.",
    },
    SafeModuleTransaction: {
      signature: "SafeModuleTransaction(address module, address to, uint256 value, bytes data, uint8 operation)",
      about: "Indexed.",
    },
    ExecutionSuccess: { signature: "ExecutionSuccess(bytes32 indexed txHash, uint256 payment)", about: "Indexed." },
    ExecutionFailure: { signature: "ExecutionFailure(bytes32 indexed txHash, uint256 payment)", about: "Indexed." },
    ExecutionFromModuleSuccess: { signature: "ExecutionFromModuleSuccess(address indexed module)", about: "Indexed." },
    ExecutionFromModuleFailure: { signature: "ExecutionFromModuleFailure(address indexed module)", about: "Indexed." },
  },
});

export const contract_safe_proxy_factory = defineContract({
  id: "safe-proxy-factory",
  title: "SafeProxyFactory: where every Safe is created",
  about:
    "Safe 1.5.0's SafeProxyFactory creates every Capxul Safe and is part of each Safe's CREATE2 address. Accounts and setup " +
    "build createProxyWithNonce, chain-rpc's fetchProxyCreationLog finds a Safe's ProxyCreation, and the indexer discovers " +
    "Safes from it and from Safe 1.4.1's factory (0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67), which made the Safes before " +
    "2 November 2026. The listed address is the 1.5.0 factory, the same on Base Sepolia and Arbitrum One.",
  was: [`${EVM}/safe-contracts.ts:10`, `${EVM}/safe-contracts.ts:17`, `${EVM}/safe-address.ts:82`, `${EVM}/bootstrap.ts:116`, `${RPC}/internal/blockReads.ts:32`, `${IDX}/abis.ts:7`],
  addresses: {
    devnet: "0x14F2982D601c9458F93bd70B218933A6f8165e7b",
    staging: "0x14F2982D601c9458F93bd70B218933A6f8165e7b",
  },
  functions: {
    createProxyWithNonce: {
      signature: "createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
      about: "Creates a Safe at its derived address (bootstrap.ts:116, safe-address.ts:82).",
    },
  },
  events: {
    ProxyCreation: {
      signature: "ProxyCreation(address indexed proxy, address singleton)",
      about: "A Safe created: indexed, and read by fetchProxyCreationLog for a Safe's deployment.",
    },
  },
});

export const contract_safe_module_setup = defineContract({
  id: "safe-module-setup",
  title: "SafeModuleSetup: modules enabled at a Safe's setup",
  about: `Delegatecalled from a new Safe's setup (through MultiSend) to enable Safe4337Module. ${BASE_SEPOLIA_NOTE}`,
  was: [`${EVM}/safe-contracts.ts:28`, `${EVM}/safe-address.ts:102`],
  addresses: {
    devnet: "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47",
    staging: "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47",
  },
  functions: {
    enableModules: { signature: "enableModules(address[] modules)", about: "Enables the Safe's modules during setup (safe-address.ts:102)." },
  },
  events: {},
});

export const contract_multi_send = defineContract({
  id: "multi-send",
  title: "MultiSend: the batch a Safe's setup delegatecalls",
  about:
    "Safe's full MultiSend (which may delegatecall), used only as the `to` of a new Safe's setup, so the setup can " +
    `delegatecall SafeModuleSetup. Payment batches use MultiSendCallOnly instead. ${BASE_SEPOLIA_NOTE}`,
  was: [`${EVM}/safe-contracts.ts:35`, `${EVM}/safe-address.ts:117`, `${EVM}/safe-address.ts:124`],
  addresses: {
    devnet: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    staging: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
  },
  functions: {
    multiSend: { signature: "multiSend(bytes transactions) payable", about: "Packed calls run from the Safe's setup (safe-address.ts:117)." },
  },
  events: {},
});

export const contract_sign_message_lib = defineContract({
  id: "sign-message-lib",
  title: "SignMessageLib: a message signed by the Safe itself",
  about:
    "Safe's SignMessageLib v1.4.1: delegatecalled, it marks a message as signed by the Safe, so its EIP-1271 " +
    "isValidSignature answers for it. Seat permissions sign their change messages this way. The same bytecode is at this " +
    "address on Base Sepolia, Arbitrum Sepolia and Arbitrum One.",
  was: [`${EVM}/safe-contracts.ts:42`, `${EVM}/seat-permissions.ts:16`, `${EVM}/seat-permissions.ts:42`],
  addresses: {
    devnet: "0xd53cd0aB83D845Ac265BE939c57F53AD838012c9",
    staging: "0xd53cd0aB83D845Ac265BE939c57F53AD838012c9",
  },
  functions: {
    signMessage: { signature: "signMessage(bytes _data)", about: "Marks a seat change message signed by the Safe (seat-permissions.ts:42)." },
  },
  events: {},
});

export const contract_module_proxy_factory = defineContract({
  id: "module-proxy-factory",
  title: "Zodiac ModuleProxyFactory: Roles module proxies",
  about:
    "Deploys each Organization's Roles module proxy (deployModule with the mastercopy, its setUp initializer and a salt). " +
    "Setup builds the deploy, chain evidence checks ModuleProxyCreation in the receipt, and the indexer discovers Roles " +
    `modules from it. ${BASE_SEPOLIA_NOTE}`,
  was: [`${EVM}/organization-payments.ts:15`, `${EVM}/zodiac-abi.ts:47`, `${EVM}/roles-module.ts:120`, `${EVIDENCE}/internal/authority-contract.ts:177`, `${IDX}/abis.ts:10`],
  addresses: {
    devnet: "0x000000000000addb49795b0f9ba5bc298cdda236",
    staging: "0x000000000000addb49795b0f9ba5bc298cdda236",
  },
  functions: {
    deployModule: {
      signature: "deployModule(address masterCopy, bytes initializer, uint256 saltNonce) returns (address proxy)",
      about: "Deploys a Roles proxy (roles-module.ts:120).",
    },
  },
  events: {
    ModuleProxyCreation: {
      signature: "ModuleProxyCreation(address indexed proxy, address indexed masterCopy)",
      about: "A module proxy deployed: checked in setup's receipt and indexed.",
    },
  },
});

export const contract_hats = defineContract({
  id: "hats",
  title: "Hats Protocol v1: every permission is a hat",
  about:
    "Every v4 permission is a hat: Books, Invoicing and People are officer hats under the Board's top hat, and being a " +
    "Director is wearing the Director hat. Companies House's readWornHats reads isWearerOfHat; directors, handovers, seat " +
    "permissions and budgets build hat calls from the company Safe. The same address on every chain.",
  was: [
    `${EVM}/company-hats.ts:11`,
    `${EVM}/company-hats.ts:48`,
    `${EVM}/board-directors.ts:21`,
    `${EVM}/board-handover.ts:15`,
    `${EVM}/seat-permissions.ts:73`,
    `${EVM}/department-budgets.ts:42`,
    `${HOUSE}/hats.ts:15`,
  ],
  addresses: {
    devnet: "0x3bc1a0ad72417f2d411118085256fc53cbddd137",
    staging: "0x3bc1a0ad72417f2d411118085256fc53cbddd137",
  },
  functions: {
    isWearerOfHat: {
      signature: "isWearerOfHat(address wearer, uint256 hatId) view returns (bool isWearer)",
      about: "Whether a wearer holds a permission (company-hats.ts:48).",
    },
    viewHat: {
      signature:
        "viewHat(uint256 hatId) view returns (string details, uint32 maxSupply, uint32 supply, address eligibility, address toggle, " +
        "string imageURI, uint16 lastHatId, bool mutable_, bool active)",
      about: "A hat's supply and settings, read before a seat change (board-directors.ts:103).",
    },
    mintHat: { signature: "mintHat(uint256 hatId, address wearer) returns (bool success)", about: "Gives a hat (board-directors.ts:148)." },
    setHatWearerStatus: {
      signature: "setHatWearerStatus(uint256 hatId, address wearer, bool eligible, bool standing) returns (bool updated)",
      about: "Takes a hat away by eligibility (board-directors.ts:186).",
    },
    changeHatMaxSupply: {
      signature: "changeHatMaxSupply(uint256 hatId, uint32 newMaxSupply)",
      about: "Resizes a seat (board-directors.ts:136, board-elections.ts:13).",
    },
    transferHat: { signature: "transferHat(uint256 hatId, address from, address to)", about: "A handover (board-handover.ts:69)." },
    changeHatEligibility: {
      signature: "changeHatEligibility(uint256 hatId, address newEligibility)",
      about: "A handover's eligibility module (board-handover.ts:59).",
    },
    changeHatToggle: { signature: "changeHatToggle(uint256 hatId, address newToggle)", about: "A handover's toggle (board-handover.ts:64)." },
    createHat: {
      signature:
        "createHat(uint256 admin, string details, uint32 maxSupply, address eligibility, address toggle, bool mutable, string imageURI) " +
        "returns (uint256 newHatId)",
      about: "A budget's or department's hat (allowance-budgets.ts:126, department-budgets.ts:42).",
    },
    getNextId: { signature: "getNextId(uint256 admin) view returns (uint256 nextId)", about: "The hat id createHat will give (department-budgets.ts:73)." },
  },
  events: {},
});

export const contract_hats_signer_gate = defineContract({
  id: "hats-signer-gate",
  title: "Hats Signer Gate v2: who may sign for a company Safe",
  about:
    "Each v4 company's Gate (Installer.deployMoney makes it) lets Director hat wearers be the company Safe's signers and sets " +
    "its threshold. Directors claim signers, read and set the threshold config, check valid signers and remove a signer. " +
    "One Gate per company, so no address is listed.",
  was: [`${EVM}/company-gate.ts:17`, `${EVM}/company-gate.ts:98`, `${EVM}/company-gate.ts:119`, `${EVM}/board-directors.ts:73`],
  functions: {
    isValidSigner: { signature: "isValidSigner(address account) view returns (bool valid)", about: "Read before a signer change (company-gate.ts:78)." },
    thresholdConfig: {
      signature: "thresholdConfig() view returns ((uint8 thresholdType, uint120 min, uint120 target) config)",
      about: "The threshold rule (company-gate.ts:134).",
    },
    setThresholdConfig: {
      signature: "setThresholdConfig((uint8 thresholdType, uint120 min, uint120 target) thresholdConfig)",
      about: "A new threshold rule (company-gate.ts:119).",
    },
    removeSigner: { signature: "removeSigner(address signer)", about: "Removes a signer who no longer wears the hat (company-gate.ts:98)." },
    claimSigner: { signature: "claimSigner(uint256 hatId)", about: "A wearer claims a signer seat (board-directors.ts:224)." },
    claimSignerFor: {
      signature: "claimSignerFor(uint256 hatId, address signer)",
      about: "A signer seat claimed for a new Director (board-directors.ts:158).",
    },
  },
  events: {},
});

export const contract_chainlink_aggregator = defineContract({
  id: "chainlink-aggregator",
  title: "Chainlink aggregator: a price feed",
  about:
    "The five Arbitrum One feeds Books' price sync reads through integration chainlink: USDC/USD " +
    "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3, USDT/USD 0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7, EUR/USD " +
    "0xA14d53bC1F1c0F31B4aA3BD109344E5009051a84, ETH/USD 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612, BTC/USD " +
    "0x6ce185860a4963106506C203335A2910413708e9. The same feeds in every environment, so no address is listed by environment.",
  was: [`${SRC}/books/facts/rules.ts:119`, "packages/backend/src/integrations/chainlink/feeds.ts:11"],
  functions: {
    decimals: { signature: "decimals() view returns (uint8)", about: "The answer's decimals." },
    latestRoundData: {
      signature:
        "latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
      about: "The latest round: its answer and update time are kept.",
    },
  },
  events: {},
});
