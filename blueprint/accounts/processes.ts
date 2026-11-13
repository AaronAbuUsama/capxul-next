// The accounts concept's durable work: one process per personal Safe's setup, and the referral
// qualify that a Safe's claim on chain starts.
//
// The old system did both inside one Convex action the browser awaited (`accounts.claims.claim`),
// with a ten-minute claim lock, a service-key lane table and six internal store mutations, then
// scheduled the referral qualify and three telemetry posters. In the target the setup is one
// workflow instance per `personal-safes` row (A3), the service-signer integration keeps one send in
// flight per key and never sends a recorded transaction twice (CAP-1097), every state change is a
// transition of `personal-safe` whose event the runtime sends, and the qualify follows the chain.

import { budget, defineWorkflow } from "../../packages/blueprint-engine/src/index.ts";
import {
  contract_companies_house_claimer,
  contract_erc20,
  contract_escrow,
  contract_roles,
  contract_safe,
  integration_chain_rpc,
  integration_indexer,
  integration_service_signer,
} from "../shared/external.ts";
import { concept_accounts } from "../shared/foundation.ts";
import {
  machine_personal_safe,
  machine_referral,
  machine_waitlist_entry,
  table_personal_safes,
  table_referral_codes,
  table_referrals,
  table_admissions,
} from "./data.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { table_escrows, table_safe_balances } from "../indexing/data.ts";
import { rpc_accounts_setup_start } from "./setup.ts";
import { event_approval_transitioned } from "../approvals/data.ts";
import { table_indexer_progress } from "../indexing/data.ts";

const OLD = "packages/backend/src";
const CLAIMS = `${OLD}/accounts/claims`;

export const workflow_accounts_setup_personal_safe = defineWorkflow({
  id: "accounts.setup.personal-safe",
  title: "Set up a person's own Safe: claim it for their signer, collect what waits",
  about:
    "One instance per personal Safe, run after each setup start commits: it must wait for the chain, for Ponder and for " +
    "the person, and survive a crash between the claim's broadcast and its receipt, so it cannot be a step of the start. " +
    "First the chain decides: a Safe already owned by exactly the person's signer is adopted with no send only after its original indexed claim meets readiness and deployment finality; one owned by " +
    "anyone but Companies House or that signer fails WRONG_STATE. Otherwise the claim key sends, once, Companies House's " +
    "`Roles.execTransactionWithRole`, whose claim role may only delegatecall `CompaniesHouseClaimer.claim(namespace, " +
    "email, signer)` with the tier's namespace pinned; it deploys the Safe if it has no code and swaps Companies House out " +
    "for the signer. A revert fails the setup with the chain's code; a lost answer is looked up by hash, never sent again. " +
    "Once Ponder has the claim's block it drives `claim`. On staging, with welcome funding on, it mints the welcome assets " +
    "into the Safe from the faucet key. Then it reads the open claim escrows the Safe owns that hold their amount (an " +
    "email paid before it had a Safe: general escrows whose owner is the Safe, payments.general-escrow) and, if any, " +
    "opens one approval from the person's own Safe, sponsored by the paymaster, calling `Escrow.collect()` on each; the " +
    "web app hands the person to the approval page to sign it. When that approval has ended (collected, declined or " +
    "lapsed) it drives `finish` with what was paid to the Safe. Ready never waits on the collection: an escrow left " +
    "stays the Safe's to claim whenever it chooses (`payment claim`) and its sender's to take back until then.",
  concept: concept_accounts,
  priority: "normal",
  trigger: { after: rpc_accounts_setup_start },
  instance: { per: table_personal_safes },
  waits: [
    {
      name: "claim-mined",
      for: "chain",
      timeoutMs: 60_000,
      key: [{ on: [integration_service_signer.c.waitForReceipt], props: ["tx_hash"] }],
      about: "The claim transaction's receipt, through the service signer; past the deadline it is looked up again, never re-sent.",
    },
    {
      name: "claim-indexed",
      for: "indexer",
      events: [contract_companies_house_claimer.e.CapxulSafeClaimed],
      timeoutMs: 10_000,
      key: [{ on: [table_indexer_progress], props: ["chain_id"], reaches: "indexed_block" }],
      about: "Ponder has indexed the claim's block, so its CapxulSafeClaimed and the escrows that pay the Safe can be read.",
    },
    {
      name: "collection-signed",
      for: "person",
      timeoutMs: 1_800_000,
      key: [{ on: [event_approval_transitioned], props: ["opener", "subject_kind", "subject_id"] }],
      about: "The person signs the collection approval on the approval page; a decline or the approval's lapse ends the wait.",
    },
    {
      name: "collected",
      for: "chain",
      events: [contract_escrow.e.EscrowPaid],
      timeoutMs: 600_000,
      key: [
        { on: [event_approval_transitioned], props: ["opener", "subject_kind", "subject_id"] },
        { on: [contract_escrow.e.EscrowPaid], props: ["chain_id", "owner"] },
      ],
      about: "The collection approval ends on chain proof: EscrowPaid to the Safe for each escrow it collected.",
    },
  ],
  steps: [
    { name: "owners", about: "Reads the Safe's code and owners: exactly [signer] avoids a new send but still requires its indexed claim occurrence; another owner but Companies House fails WRONG_STATE." },
    { name: "claim", about: "Sends the claim role's call to CompaniesHouseClaimer.claim with the claim key, once per attempt; the signed bytes are recorded first." },
    { name: "receipt", about: "A revert fails it: SwapRefused is WRONG_STATE, EmailNotNormalized or InvalidSigner INVALID_INPUT, any other TRANSACTION_FAILED." },
    { name: "claimed", about: "After Ponder has the block: drives `claim` with the hash, the block and its time." },
    { name: "welcome", about: "Staging only, with welcome funding on: mints each welcome asset into the Safe from the faucet key, once per asset." },
    { name: "escrows", about: "Reads the open owner-collects escrows whose owner is the Safe and that hold their amount; none drives `finish` with 0 collected." },
    { name: "collect", about: "Opens one approval from the person's Safe carrying Escrow.collect() on each, through `approvals.open`, and keeps its id." },
    { name: "finish", about: "When the approval has ended: drives `finish` with the number of escrows paid to the Safe." },
  ],
  reads: [table_personal_safes, table_escrows, table_safe_balances],
  writes: [table_personal_safes],
  drives: [machine_personal_safe.t.claim, machine_personal_safe.t.fail, machine_personal_safe.t.finish],
  invokes: [procedure_approvals_open],
  emits: [],
  calls: [
    integration_chain_rpc.c.getCode,
    integration_chain_rpc.c.readContract,
    integration_service_signer.c.send,
    integration_service_signer.c.waitForReceipt,
    integration_indexer.c.awaitBlock,
  ],
  chain: [
    contract_safe.f.getOwners,
    contract_roles.f.execTransactionWithRole,
    contract_companies_house_claimer.f.claim,
    contract_erc20.f.mint,
    contract_escrow.f.collect,
  ],
  idempotency:
    "`setup:<person_id>:<attempt>`: the claim is one recorded service-signer send per attempt, looked up by hash and never " +
    "sent twice; a Safe already owned by the signer is adopted; one collection approval per attempt.",
  timeoutMs: 3_600_000,
  retries: { max: 5, backoff: "exponential" },
  compensation:
    "Nothing to undo. A refused claim changes nothing on chain, and the Party keeps its Safe, which is a pure function of " +
    "the email. A run that dies after five retries leaves the setup claiming; the next start resumes the same attempt. A " +
    "send that never left fails it PROVIDER_ERROR, and a new start retries.",
  budget: {
    ...budget("background"),
    excludes: ["wait.claim-mined", "wait.claim-indexed", "wait.collection-signed", "wait.collected"],
  },
  was: [
    `${CLAIMS}/operations/claim.ts:34`,
    `${CLAIMS}/external/ownership.ts:23`,
    `${CLAIMS}/external/submissions.ts:45`,
    `${CLAIMS}/external/recovery.ts:37`,
    `${OLD}/accounts/grants/operations/mint-welcome-grants.ts:20`,
    "apps/docs/factory/operations/account.retry.yaml",
  ],
});
