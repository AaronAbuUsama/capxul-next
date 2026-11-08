// The approvals concept's durable process: one instance per approval (A3), from its birth in its
// opener's transaction to the chain proof that ends it. It is the only caller of the bundler and
// paymaster (decision components.bundler-paymaster) and the only writer of an approval's state after
// birth, but for the signer's two signals and the opener's withdrawal.
//
// Old shape, for a reader who knows it: the old system spread this over a prepare action's build
// (payments' executions store), accounts' approvals (request, approve, record-approval,
// consume-approved, reschedule-approved, send-approved), the scheduled expire job, payments' send
// path (load, classify, reset-claim, claim, record-send-attempt, complete) and the 10-minute claim
// sweep. Here every hop is a step of one instance, and every sweep is the instance's own timer or the
// indexed chain event it waits for (P3).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_approvals } from "../shared/foundation.ts";
import {
  contract_entry_point,
  contract_erc20,
  contract_multi_send_call_only,
  contract_safe,
  contract_safe_4337_module,
  integration_bundler,
  integration_chain_rpc,
  integration_indexer,
} from "../shared/external.ts";
import { table_feature_flags } from "../access/data.ts";
import { machine_approval, table_approvals } from "./data.ts";
import { rpc_approvals_signing_decline, rpc_approvals_signing_sign } from "./signing.ts";

const OLD = "packages/backend/src";
const t = machine_approval.t;

const DAY_MS = 86_400_000;

export const workflow_approvals_lifecycle_carry = defineWorkflow({
  id: "approvals.lifecycle.carry",
  title: "Carry one approval from sponsorship to chain proof",
  about:
    "Started by the `open` transition's event, one instance per approval id. It sponsors the operation, waits for the " +
    "signer, sends it once on its own nonce, and ends it only on chain proof or an answer before signing. Sponsorship: " +
    "the Safe's one owner is the signer (an undeployed Safe, or one whose owner is still Companies House's claim role, is " +
    "refused SMART_ACCOUNT_MISSING); the nonce is the next on the approval's own key (a replacement keeps the replaced " +
    "one's); the calls become one `executeUserOpWithErrorString` (a MultiSendCallOnly delegatecall for several); the " +
    "paymaster sponsors it for its window (from `send_after`, or now, to the deadline) and its simulation is where the " +
    "chain refuses before anyone signs: INSUFFICIENT_BALANCE, ROLE_PERMISSION_DENIED or TRANSACTION_FAILED, kept in " +
    "`refusal`. The send: claimed first (`sending`, committed before the call, K4), then sent once; an unanswered send is " +
    "looked up by hash and never sent again; a definitive refusal the bundler confirms it does not hold bounces back to " +
    "`signed` and is sent again 30 seconds later while the window is open (CAP-1018). A dated operation is held until its " +
    "day; then each need (a holder's balance of a token) and the gate are checked, and while one fails the send waits an " +
    "hour and checks again inside its window (K16). The end: the indexed UserOperationEvent at its sender and nonce, at " +
    "the deployment's finality depth, lands or reverts it (its hash) or displaces it (another hash); at the window's end " +
    "plus two minutes' grace an unmoved nonce expires it (K6). Each end is one transition whose event its opener follows.",
  concept: concept_approvals,
  priority: "critical",
  trigger: { transition: t.open },
  instance: { per: table_approvals },
  signals: [rpc_approvals_signing_sign, rpc_approvals_signing_decline],
  waits: [
    {
      name: "signer",
      for: "person",
      about:
        "The signer's answer: `approvals.signing.sign` or `.decline`. The opener's withdrawal also ends it (the `withdraw` " +
        "transition's event resumes the instance), and so does the window.",
    },
    { name: "day", for: "timer", about: "A signed, dated operation: until its `send_after`, the first moment its window lets it land." },
    {
      name: "needs",
      for: "timer",
      timeoutMs: 3_600_000,
      about: "A held operation short of a need, or whose gate is off on its day: an hour, then both are checked again.",
    },
    {
      name: "bounce",
      for: "timer",
      timeoutMs: 30_000,
      about: "After a definitive bundler refusal of an operation it does not hold: 30 seconds, then the one send again.",
    },
    {
      name: "chain",
      for: "indexer",
      about:
        "The UserOperationEvent at its sender and nonce, indexed by Ponder at the finality depth (index by-sender-nonce " +
        "finds every approval on that nonce); a bundler receipt only says which block to wait for.",
    },
    {
      name: "window",
      for: "timer",
      about: "Its window's end (the paymaster's `validUntil`, or the deadline before sponsorship) plus two minutes' grace.",
    },
  ],
  steps: [
    { name: "read-safe", about: "Reads the sender Safe's owners and the next nonce on the approval's own key (`getOwners`, `getNonce`)." },
    { name: "build", about: "Encodes the calls: one `executeUserOpWithErrorString`, or a `multiSend` delegatecall for several, in order." },
    { name: "sponsor", about: "Asks the paymaster to sponsor it for its window; records the signer, the operation, its SafeOp digest, its hash and window." },
    { name: "refuse", about: "A simulation revert, or a paymaster that failed or answered unusably on every try, ends it `refused` with the code." },
    { name: "await-signer", about: "Waits for the signer, the opener's withdrawal or the window; a decline or withdrawal ends the instance." },
    { name: "hold", about: "A dated operation waits for its day, then checks each need's balance and the gate, hourly while one fails." },
    { name: "claim-send", about: "Commits `sending` before the call, so a resumed instance looks the operation up instead of sending it again." },
    { name: "send", about: "Sends the signed operation once; the bundler must answer its own hash." },
    { name: "recover-send", about: "After a lost answer: looks it up by hash; held is `sent`, a definitive refusal not held bounces to `signed`." },
    { name: "follow", about: "Waits for the indexed event at its nonce; with a bundler receipt, waits for Ponder to reach that block first." },
    { name: "classify", about: "Reads the transaction's facts at finality: its own hash lands or reverts it, another hash displaces it." },
    { name: "lapse", about: "At the window's end plus grace, reads the nonce: unmoved expires it, moved waits for the event that decides it." },
  ],
  reads: [table_approvals, table_feature_flags],
  writes: [table_approvals],
  drives: [t.sponsor, t.refuse, t.claim_send, t.accept, t.bounce, t.land, t.revert, t.displace, t.expire],
  invokes: [],
  emits: [],
  calls: [
    integration_chain_rpc.c.readContract,
    integration_bundler.c.sponsor,
    integration_bundler.c.send,
    integration_bundler.c.lookup,
    integration_indexer.c.awaitBlock,
    integration_indexer.c.factsOf,
  ],
  chain: [
    contract_safe.f.getOwners,
    contract_entry_point.f.getNonce,
    contract_safe_4337_module.f.executeUserOpWithErrorString,
    contract_multi_send_call_only.f.multiSend,
    contract_erc20.f.balanceOf,
  ],
  idempotency:
    "One instance per approval id; each transition is guarded by the state it leaves, so a replayed step writes nothing; " +
    "`sending` is committed before the send, so a resumed instance looks it up by hash and never sends twice (K4).",
  timeoutMs: 370 * DAY_MS,
  retries: { max: 3, backoff: "exponential" },
  compensation:
    "None is needed: nothing is sent before the signature, a signed operation is ended only by the chain or its closed " +
    "window, and the opener compensates its own intent when it follows the end (a Payment fails, a setup needs attention).",
  budget: budget("background"),
  was: [
    "books/as-is/accounts/approvals.ts",
    "books/as-is/payments/executions.ts",
    `${OLD}/accounts/approvals/operations/send-approved.ts:214`,
    `${OLD}/accounts/approvals/operations/expire.ts:31`,
    `${OLD}/payments/executions/external/sends.ts:145`,
    `${OLD}/payments/executions/writes/claims.ts:116`,
    `${OLD}/payments/executions/operations/recover-claims.ts:46`,
    `${OLD}/payments/executions/external/builds.ts:76`,
    `${OLD}/payments/rules/attempts.ts:90`,
    `${OLD}/payments/executions/rules.ts:33`,
    `${OLD}/payments/schedules/rules.ts:23`,
    `${OLD}/payroll/agreements/external/sends.ts:76`,
  ],
});
