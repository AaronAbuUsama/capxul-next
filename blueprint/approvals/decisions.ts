// The approvals concept's own judgments, one decision record each. The architecture's decisions
// about approvals (concepts.approvals, dependencies.approvals-low, rules.procedures,
// rules.durable-processes, responsibilities.service-lanes, components.bundler-paymaster) are in
// shared/decisions.ts and are not repeated here.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { concept_approvals } from "../shared/foundation.ts";
import { integration_bundler, integration_indexer } from "../shared/external.ts";
import { table_feature_flags, table_principals } from "../access/data.ts";
import { event_approval_transitioned, machine_approval, table_approvals } from "./data.ts";
import { procedure_approvals_open, procedure_approvals_withdraw } from "./procedures.ts";
import {
  rpc_approvals_signing_decline,
  rpc_approvals_signing_get,
  rpc_approvals_signing_review,
  rpc_approvals_signing_sign,
} from "./signing.ts";
import { workflow_approvals_lifecycle_carry } from "./processes.ts";
import { flow_client_approvals_sign } from "./flows.ts";

const OLD = "packages/backend/src";
const t = machine_approval.t;

export const decision_approvals_unsponsored_replacement = defineDecision({
  id: "approvals.unsponsored-replacement-finality",
  title: "An inherited nonce can displace a replacement before sponsorship",
  question: "What ends an unsponsored replacement when the original approval has already consumed their shared nonce?",
  options: [
    { label: "finality", text: "A matching indexed final UserOperationEvent displaces the replacement even while it is sponsoring; chain wakes include sponsoring approvals with a persisted nonce." },
    { label: "wait", text: "Ignore final facts before sponsorship and keep rescheduling after the deadline when the nonce has moved." },
  ],
  chosen: "finality",
  why: "Opening a replacement already persists the original's nonce. If its first carrier run is late, a consumed nonce cannot become usable again, and waiting for sponsorship leaves its opener stuck forever. Another operation's finalized hash is displacement proof before or after sponsorship; a raw receipt or moved nonce alone is not. Without the indexed final fact it still waits. The terminal transition, opener callback and carrier deletion remain one transaction, so callback failure rolls back and retry applies the effect once without sponsoring or sending.",
  source: "approvals.lifecycle.carry; approvals replacement nonce; PR55 mirror4554855744 and native red control, 12 November 2026",
  affects: [t.displace, workflow_approvals_lifecycle_carry],
});

export const decision_approvals_carrier_isolation = defineDecision({
  id: "approvals.carrier-isolation",
  title: "One approval's failing step backs off alone",
  question: "What happens to a carrier batch when one approval's step throws (an indexed reader, a provider, its opener's callback or SQL)?",
  options: [
    { label: "isolate", text: "Roll back that step, move only its wake 30 seconds later in its own transaction unless a wake committed since the batch read it, and carry on with the rest of the batch." },
    { label: "abort", text: "Let the error end the batch; the approval keeps its wake and is tried first again next time." },
  ],
  chosen: "isolate",
  why: "Due approvals are taken in wake order, so an approval that fails every time would head every later batch and stop every other signer's approval with it. Rolling the step back keeps the opener callback, transition and carrier deletion atomic; the conditional back-off never overwrites a chain or signer wake that arrived meanwhile, so a lost wake cannot follow. Bounded sponsorship retries and send lookups keep their own rules inside the step.",
  source: "approvals.lifecycle.carry; PR55 integrator review P1 (carrier.ts carry), 13 November 2026",
  affects: [workflow_approvals_lifecycle_carry],
});

export const decision_approvals_signing_composition = defineDecision({
  id: "approvals.signing-composition",
  title: "The signer's routes ride with the carrier, and the carrier tells the opener",
  question:
    "Core mounts approvals.signing.* on its public transport. A decline ends the approval in the signer's own transaction, " +
    "on the tenant role, but some openers' follow-ups (an Organization's setup) are writable only by the worker. Who calls " +
    "the opener, and when are the routes mounted?",
  options: [
    { label: "carrier-delivers", text: "The routes call no opener: a decline commits with its event and wakes the carrier, which hands that ending to the opener on the worker role, in one transaction with deleting its carrier row, as for every chain ending. The routes mount only when the carrier is composed." },
    { label: "inline", text: "Call the opener inside the decline's transaction, and grant every opener's follow-up tables to the tenant role." },
  ],
  chosen: "carrier-delivers",
  why:
    "One delivery path means one role and one exactly-once guard (the carrier row's deletion) for every ending, so an opener " +
    "writes its follow-up as the worker whatever ended the approval, and a failing callback backs off alone " +
    "(approvals.carrier-isolation) instead of refusing the signer's no. The opener hears a decline a tick later; the decline " +
    "itself and its approval_transitioned commit at once. Without the carrier nothing is ever sponsored, so there is nothing " +
    "to sign and no route to mount. The view's link is SITE_URL's approval page, and the network's name and explorer are " +
    "the world's (NETWORK_NAME, EXPLORER_URL), since a devnet forks a public chain's id.",
  source: "approvals.signing-area; Organizations' install approval (organizations.approval-endings); integrator composition brief, 13 November 2026",
  affects: [rpc_approvals_signing_decline, rpc_approvals_signing_get, workflow_approvals_lifecycle_carry],
});

export const decision_approvals_signing_intent = defineDecision({
  id: "approvals.signing-intent",
  title: "Expose immutable intent independently of the sponsored operation",
  question: "Which public fields let a signer check the operation's nonce and window against the opener's intent?",
  options: [
    { label: "intent", text: "Expose the stored nonceKey, original deadline and replacement reference with the replaced approval's persisted nonce, separately from operation and expiresAt." },
    { label: "operation", text: "Derive the expected nonce and deadline from the operation being checked." },
  ],
  chosen: "intent",
  why: "Checking an operation against itself proves nothing. Ordinary approvals bind their stored lane without fixing a sequence; replacements bind the original approval's full nonce, not the new operation's nonce. Sponsor expiry may be shorter than the opener's deadline. Calls, sender, sendAfter and these immutable fields supply intent, while chain/module/EntryPoint/multiSend come from trusted deployment configuration and the actual client chain. This detects inconsistent builder output; the client's originally prepared intent is stronger than a view when the backend itself is malicious. The SDK transport remains wire-only until an independent canonical verifier and signer are composed.",
  source: "approvals.signing-area; approvals replacement nonce contract; signing builder owner contract, 12 November 2026",
  affects: [rpc_approvals_signing_get, flow_client_approvals_sign],
});

export const decision_approvals_public_transport = defineDecision({
  id: "approvals.public-transport",
  title: "Bearer-authenticated live signing releases SQL between frames",
  question: "How do the four signing rpcs reach a public client without exposing the collector's service authority?",
  options: [
    { label: "bearer", text: "GET /approvals/signing/get?approvalId=… returns a snapshot, or SSE with Accept: text/event-stream; POST /approvals/signing/review, /sign and /decline take the declared JSON inputs. Resolve the raw Bearer through Access on the caller transaction and canonical world time." },
    { label: "service", text: "Let a browser use the collector's private HMAC and identify its signer in the body." },
  ],
  chosen: "bearer",
  why: "A service credential is not a person's session. Each live frame reauthenticates and checks signer ownership and any approval gate before reading, using a short transaction that releases its connection before waiting or writing to the socket. Disconnect cancels the wait. Mutations carry X-Capxul-Trace and X-Capxul-Call-Id; same-Sql signer-scoped call metadata refuses reuse with different input and preserves the original trace, but stores no second approval state. Replays invoke the idempotent signing door, not open. The SDK transport follows these frames and sends signatures only when supplied by its caller; it does not invent a SafeOp digest, sponsorship policy or signing authority.",
  source: "approvals.signing-area; approvals.tenant-is-signer; integrator public transport contract, 12 November 2026",
  affects: [rpc_approvals_signing_get, rpc_approvals_signing_review, rpc_approvals_signing_sign, rpc_approvals_signing_decline],
});

export const decision_approvals_transactional_carrier = defineDecision({
  id: "approvals.transactional-carrier",
  title: "The caller's transaction persists the carrier and its wake",
  question: "How does a committed approval survive a crash before its process starts?",
  options: [
    { label: "transactional", text: "Persist the approval, transition event and durable wake on the caller's checked-out Sql connection; resolve the principal before opening and perform outside calls only after commit." },
    { label: "after-commit", text: "Enqueue the carrier after committing the opener's intent." },
  ],
  chosen: "transactional",
  why: "A crash must not leave an intent without its carrier or a carrier without its wake. A collector already holds a bounded-pool connection, so opening another transaction can deadlock. Principal context comes from the trusted access boundary, not client-supplied sender fields. Durable events and wakes are process infrastructure, not a second approval or send-attempt store.",
  source: "rules.procedures; approvals.open; approvals.lifecycle.carry; Core and approvals integration contract, 12 November 2026",
  affects: [procedure_approvals_open, workflow_approvals_lifecycle_carry, event_approval_transitioned],
});

export const decision_approvals_site_compatibility = defineDecision({
  id: "approvals.site-compatibility",
  title: "Preserve committed site payment answers while installing signer approvals",
  question: "How does the declared signer store replace the narrow site's prepared-payment table without losing committed answers?",
  options: [
    { label: "rename", text: "Rename the narrow table to site_payment_approvals in the migration transaction, preserve its existing API and row policies, and install the declared principal approvals table. All legacy reads and settlement go through the approvals door." },
    { label: "discard", text: "Discard the old prepared-payment rows and request answers." },
  ],
  chosen: "rename",
  why: "Existing collector answers, originating traces and lost-ACK replay remain facts. The compatibility store does not carry a UserOperation or replace approvals.open; new chain-writing intents use the declared signer carrier. A committed answer lookup reads site_request_answers, never infers collection from an approval row, and binds requested_by to the authenticated caller. Shared migration composition serializes rename, grants and callers.",
  source: "Core34 committed site-answer replay; approvals.tenant-is-signer; Core/Sites integration contract, 12 November 2026",
  affects: [table_approvals, procedure_approvals_open],
});

export const decision_approvals_one_table = defineDecision({
  id: "approvals.one-table",
  title: "One approvals table holds the approval and its one UserOperation",
  question:
    "The old system kept a prepared operation in three stores: accounts' `approvals` (the page's record and the " +
    "signature), payments' `moneyExecutions` (the operation, its nonce lane, the send claim, the outcome, the sweep's " +
    "holds; read at 19 sites by neighbours) and `providerSendAttempts` (one row per bundler call). Which stores does the target keep?",
  options: [
    { label: "one", text: "One `approvals` row per UserOperation: calls, summary, sponsorship, signature, send and chain proof." },
    { label: "two", text: "An approval table and an execution table, joined one to one, as accounts and payments had them." },
    { label: "three", text: "Keep a send-attempt log beside them, for counting bundler calls." },
  ],
  chosen: "one",
  why:
    "Every approval carries exactly one operation and every operation has exactly one approval (the old relayed kinds " +
    "already faked an execution id for theirs), so two tables only add a join and a second writer. A send attempt is a " +
    "span (`call.bundler.send`, P6) and the `claim_send`, `accept` and `bounce` transitions with their events; a log row " +
    "would be telemetry stored as data. The pre-v4 Attempt states the old validator kept for history (11 of 19), the " +
    "sweep's recovery holds and the optional fields 'for rows written before them' go (P9).",
  source: "docs/as-is/archive/accounts/data.ts (approvals); docs/as-is/archive/payments/data.ts (money-executions, provider-send-attempts); docs/as-is/payments.md",
  affects: [table_approvals, concept_approvals],
});

export const decision_approvals_tenant_is_signer = defineDecision({
  id: "approvals.tenant-is-signer",
  title: "An approval is its signer's row: tenancy person, keyed by person_id",
  question: "Whose row is an approval: its signer's, or the Organization's whose money it moves?",
  options: [
    { label: "signer", text: "Tenancy `person`, `person_id` the signing principal (a person, or an agent with its own key); `org_id` only names the Organization." },
    { label: "owner", text: "Tenancy `owner`: the Organization's when it moves an Organization's money, else the person's." },
  ],
  chosen: "signer",
  why:
    "Only the signer may read or answer an approval (the old page rows refused everyone else), and " +
    "other Directors follow a proposal, not each other's approvals. Access gives every principal, person or agent, one " +
    "`person_id`, so one tenant column covers both. An Organization tenant would let every member see each Director's " +
    "and payer's pending signatures. Three lookups must cross tenants and say why: by id alone (the process, the " +
    "openers' workflows, the page's link) and by a Safe's nonce (the indexed event names only the Safe). " +
    "A trusted worker replaying a stored command may read only approval_id, deadline, state, person_id and sender by " +
    "its stored approval id, on the caller's Sql connection. The database worker role is required even when a person " +
    "context exists; a later budget wearer must not reopen a terminal approval or impersonate its original signer. " +
    "The opener authorizes its command before this internal read; the read grants no signing or mutation authority.",
  source: `${OLD}/accounts/approvals/guards.ts:13; blueprint/access/data.ts (principals: person_id for both kinds); P8`,
  affects: [table_approvals, rpc_approvals_signing_get],
});

export const decision_approvals_sender_and_signer = defineDecision({
  id: "approvals.sender-and-signer",
  title: "The sender is the principal's own Safe; the signer is read from that Safe",
  question: "Where do the sender Safe and the key that must sign come from?",
  options: [
    { label: "principal-and-chain", text: "Sender from access' `principals.safe_address` at birth; signer from the Safe's owners on chain at sponsorship." },
    { label: "opener", text: "The opener passes both, as the old open-for-* rows took `signerAddress`." },
    { label: "accounts", text: "Read the person's signer from accounts' Safe setup." },
  ],
  chosen: "principal-and-chain",
  why:
    "v4 D1: every action comes from the actor's own Safe, so the opener should not be able to name another. Access already " +
    "holds each principal's Safe and approvals depends on it. Approvals sits below accounts, so it cannot read accounts' " +
    "setup; the Safe's one owner on chain is the truth the signature must match anyway, and an unclaimed Safe (its owner " +
    "still Companies House's claim role, or no code) is SMART_ACCOUNT_MISSING before anyone signs.",
  source: "blueprint/access/procedures.ts:13; docs/decisions/target-architecture.md (dependencies.of-approvals); packages/sdk/src/accounts/approvals.ts:70",
  affects: [procedure_approvals_open, workflow_approvals_lifecycle_carry, table_principals, table_approvals],
});

export const decision_approvals_machine = defineDecision({
  id: "approvals.machine",
  title: "Twelve states: before the signature anyone may end it, after it only the chain",
  question: "Which states does an approval have, and which ends may happen before and after the signature?",
  options: [
    {
      label: "split-at-signature",
      text:
        "sponsoring, pending (before a signature: refused, declined, withdrawn or expired end it); signed, sending, sent " +
        "(after: only landed, reverted, displaced or expired).",
    },
    { label: "old-five", text: "The old page states (pending, approved, rejected, consumed, expired) plus the old Attempt states on a second machine." },
  ],
  chosen: "split-at-signature",
  why:
    "A signed, sponsored operation can land whenever its window is open, whoever holds the bytes, so after the signature " +
    "only chain proof is safe (K6): a decline, a withdrawal or a refusal then would let the opener retry while the first " +
    "could still land, and the money would move twice. Before it, nothing exists that can land. The old page states map " +
    "for any operation that prints them: pending is sponsoring or pending, approved is signed or sending, consumed is " +
    "sent or later, rejected is declined, expired is expired; refused and withdrawn never reached the old page.",
  source: `${OLD}/payments/rules/attempts.ts:90-125 (K6); ${OLD}/accounts/approvals/rules.ts:47; blueprint/baseline/operations.ts (org.proposal.approve returns, state)`,
  affects: [machine_approval, event_approval_transitioned, table_approvals],
});

export const decision_approvals_nonce_key = defineDecision({
  id: "approvals.nonce-key",
  title: "Each approval rides its own nonce key; a void shares the nonce it replaces",
  question:
    "The old code put a Payment command on a key named for it and every Permission, invitation and setup on key 0, in " +
    "order, refusing a second live holder of a key. Which nonce does an approval use?",
  options: [
    { label: "own-key", text: "keccak256 of the approval id, cut to 192 bits (never 0), at its next sequence; a replacement takes the replaced approval's key and nonce." },
    { label: "named-lanes", text: "Keep lanes named by the opener's subject, with key 0 shared for ordered changes." },
  ],
  chosen: "own-key",
  why:
    "EntryPoint orders each key on its own, so no approval waits behind another or holds a lane for one. v4 has no ordered " +
    "Roles changes from a personal Safe (old key 0's reason); the Board's order is the company Safe's nonce, which board " +
    "owns. A retry of a lapsed approval is safe on a fresh key, because `expired` already proves the old nonce never " +
    "moved. The one case that must share a nonce is the void of a dated payment (payment cancel: 'on the payment's own " +
    "nonce lane'), so whichever lands first displaces the other.",
  source: `${OLD}/payments/executions/rules.ts:126-176; blueprint/baseline/operations.ts (payment.cancel about; payment.retry #1)`,
  affects: [procedure_approvals_open, workflow_approvals_lifecycle_carry, table_approvals],
});

export const decision_approvals_sponsor_in_process = defineDecision({
  id: "approvals.sponsor-in-process",
  title: "The approval's process sponsors it; refusals before signing end it refused",
  question: "Where does sponsorship happen: in the opener's prepare rpc, in an SDK step, or in the approval's process?",
  options: [
    { label: "process", text: "The process's first step, after the birth commits; the flow reads the approval live until it is pending." },
    { label: "opener-rpc", text: "The opener's prepare rpc calls the paymaster before invoking `approvals.open`." },
    { label: "sdk-step", text: "An approvals rpc the SDK flow calls after the prepare, which sponsors synchronously." },
  ],
  chosen: "process",
  why:
    "A procedure makes no outside call and approvals is the bundler's only caller, so the opener's rpc cannot sponsor. " +
    "Some approvals are opened by workflows with no flow waiting (the founder's install batch), so an SDK step would leave " +
    "them unsponsored until a page opened. In the process it is one path for all, retried on a paymaster outage and " +
    "durable. The simulation's refusal keeps the code the bundler's sponsor call maps it to (K18), in `refusal`: " +
    "INSUFFICIENT_BALANCE, PAYROLL_BUDGET_EXCEEDED (Budgets' OverBudget, or the payout ceiling's AllowanceExceeded), " +
    "CHILDREN_EXCEED_PARENT, AMOUNT_BELOW_USE, WRONG_STATE (BudgetIsClosed), ROLE_PERMISSION_DENIED (any other Roles, " +
    "Budgets or Gate refusal) or TRANSACTION_FAILED (updated at assembly to integrations.sponsor-refusals, which once " +
    "named only three). Each opener maps it to its own frozen refusal (board answers WRONG_STATE `execution_reverts`). " +
    "The cost is one workflow start on the chain-submit path, inside the operation's budget. Expiry is never a refusal: " +
    "with less than one whole second of window left (the sponsor's own boundary) the process does not ask, and an " +
    "expired answer is not an attempt; both wait for the lapse at the window's end plus grace, whose nonce guard ends it " +
    "expired or leaves an inherited, moved nonce to its indexed ending.",
  source: `${OLD}/payments/executions/external/builds.ts:76; blueprint/shared/external.ts (bundler.sponsor failures; integrations.sponsor-refusals); K18 in docs/as-is/payments.md; approvals.verified-sponsorship expired outcome, 13 November 2026`,
  affects: [workflow_approvals_lifecycle_carry, rpc_approvals_signing_get, integration_bundler, t.refuse, t.expire],
});

export const decision_approvals_send_once = defineDecision({
  id: "approvals.send-once",
  title: "One send per signed operation: claim, look up a lost answer, bounce a refusal",
  question: "How does the process send a signed operation so that it is never sent twice and never lost?",
  options: [
    {
      label: "claim-lookup-bounce",
      text:
        "Commit `sending` before the call; a lost answer is looked up by hash, never sent again; a definitive refusal the " +
        "bundler confirms it does not hold returns to `signed` and is sent again after 30 s while the window is open.",
    },
    { label: "refuse-on-reject", text: "A bundler refusal ends the approval refused at once." },
    { label: "retry-blind", text: "Retry the send on any failure." },
  ],
  chosen: "claim-lookup-bounce",
  why:
    "K4: a send whose answer was lost may be held, so only a lookup is safe. A definitive refusal of an operation the " +
    "bundler does not hold cannot land from that send, and the old agreement path already handed such a write back to " +
    "its approval (CAP-1018: 'A write the bundler refuses goes back to its approval'). Ending it refused would break K6: " +
    "the signed bytes stay valid until the window closes. The bundler's own `send` takes no retries.",
  source: `${OLD}/payments/executions/external/sends.ts:145-214; ${OLD}/payroll/agreements/external/sends.ts:76-99; K4 and K6 in docs/as-is/payments.md`,
  affects: [machine_approval, workflow_approvals_lifecycle_carry, integration_bundler],
});

export const decision_approvals_chain_proof = defineDecision({
  id: "approvals.chain-proof",
  title: "The indexed event at its nonce ends a signed approval; an unmoved nonce expires",
  question: "What proves how a signed approval ended, and when is it final?",
  options: [
    {
      label: "indexed-event-at-finality",
      text:
        "The UserOperationEvent at its sender and nonce, read through the indexer at the finality depth: its hash lands or " +
        "reverts it, another displaces it; at the window plus two minutes an unmoved nonce (getNonce) expires it.",
    },
    { label: "bundler-receipt", text: "The bundler's receipt for its hash, and a sweep that classifies the rest, as the old claim sweep did." },
  ],
  chosen: "indexed-event-at-finality",
  why:
    "The EntryPoint event is the chain's own answer, and it names whichever operation used the nonce, so one event " +
    "decides the approval it landed and every approval it displaced, with no sweep and no `unknown` state. At finality " +
    "a landing is never reversed, so approvals needs no reorg path; Payments still reverse their own facts. The " +
    "window's 2-minute grace is the old one, and an expiry needs the nonce unmoved, so 'chain proof overrides a ledger " +
    "expiry' can no longer happen. Ponder already indexes UserOperationEvent (concept indexing).",
  source: `${OLD}/payments/rules/attempts.ts:90-125; ${OLD}/payments/executions/rules.ts:33; ${OLD}/payments/executions/operations/recover-claims.ts:46; P3`,
  affects: [machine_approval, workflow_approvals_lifecycle_carry, integration_indexer, t.expire],
});

export const decision_approvals_held_sends = defineDecision({
  id: "approvals.held-sends",
  title: "A dated operation is held until its day and checked before it is sent",
  question:
    "A personal dated payment is 'a signed operation Capxul sends on the day' (payment send, designed). Approvals owns " +
    "the one send. What does the process do between the signature and the day, and on the day?",
  options: [
    {
      label: "hold-and-check",
      text:
        "Hold until `send_after`; then check each need (a holder's token balance) and the gate; while one fails, wait an " +
        "hour and check again inside the window; the window's end expires it.",
    },
    { label: "opener-sends", text: "Hand the signed bytes to payments' dated-payment process to send." },
    { label: "send-blind", text: "Send on the day without checking, and let a short Safe revert on chain." },
  ],
  chosen: "hold-and-check",
  why:
    "Keeps K16 (sent on the date, retried hourly while short inside the signed window, failed when it closes) where the " +
    "send is, so K4 stays in one place. A blind send would revert on chain at the paymaster's cost and fail the Payment " +
    "for a balance that arrives an hour later. The needs are data the opener gives (`needs`), so approvals still decides " +
    "no authority and reads no opener. The day-ahead warning stays the opener's (payments, through notices). The window " +
    "is the old three days from the day, so the process lives at most a year and four days (dates up to 366 days ahead).",
  source: `${OLD}/payments/schedules/rules.ts:23-78; packages/protocol/src/payments/schedule-window.ts:9-18; K16 in docs/as-is/payments.md`,
  affects: [workflow_approvals_lifecycle_carry, procedure_approvals_open, table_approvals],
});

export const decision_approvals_gate = defineDecision({
  id: "approvals.gate",
  title: "An approval may name a gate, checked at the signature and before a held send",
  question:
    "`org proposal approve` keeps 'With the owner-safe-proposals gate off, no approval opens, and a gate turned off later " +
    "stops the send.' The opener checks the gate before it opens; who stops the send?",
  options: [
    { label: "named-gate", text: "The opener names the gate (`gate`); the sign rpc refuses FEATURE_NOT_AVAILABLE and a held send waits while it is off." },
    { label: "per-kind", text: "Approvals keeps the old list of gated kinds (bank_payout, safe_proposal, payroll_agreement, payroll_run)." },
    { label: "opener-only", text: "Only the opener checks, at open." },
  ],
  chosen: "named-gate",
  why:
    "The send is approvals', so only approvals can stop it; naming the gate keeps approvals free of its openers' kinds. " +
    "Refusing at the signature keeps the frozen 'nothing is signed' wording true. A held operation whose gate is off on " +
    "its day is not sent and is checked again hourly, never ended early, because its signature exists (K6). Gates are " +
    "read from access' `feature-flags` through access' evaluator, as access' door says every gated concept does.",
  source: `${OLD}/accounts/approvals/operations/approve.ts:22-39; blueprint/baseline/operations.ts (org.proposal.approve #5); blueprint/access/procedures.ts:10`,
  affects: [rpc_approvals_signing_sign, workflow_approvals_lifecycle_carry, table_feature_flags, table_approvals],
});

export const decision_approvals_withdraw_procedure = defineDecision({
  id: "approvals.withdraw-procedure",
  title: "New procedure approvals.withdraw: an ended intent takes its unsigned carrier",
  question: "When an opener's intent ends before anyone signed its approval, how does the approval end with it?",
  options: [
    { label: "procedure", text: "`approvals.withdraw`, in the opener's transaction, for a sponsoring or pending approval; a signed one is replaced, not withdrawn." },
    { label: "outbox", text: "Approvals follows the opener's transition (it would have to depend on every opener: a cycle)." },
    { label: "let-expire", text: "Leave it pending until its window lapses." },
  ],
  chosen: "procedure",
  why:
    "Money fact (rules.procedures, 'a chain write and the approval that carries it'): if a cancelled Payment command and " +
    "its still-pending approval disagreed at a commit, the person could sign and move money Capxul records as cancelled. " +
    "Letting it lapse leaves that window open for up to the whole deadline. Approvals cannot follow its openers, which " +
    "sit above it. A signed approval cannot be withdrawn (K6), which is why the frozen cancel of a dated payment is a void.",
  source: `${OLD}/accounts/approvals/writes.ts:119; ${OLD}/payments/executions/operations/abandon.ts; ${OLD}/payments/executions/writes/failures.ts:33`,
  affects: [procedure_approvals_withdraw, t.withdraw, machine_approval],
});

export const decision_approvals_open_answers_live = defineDecision({
  id: "approvals.open-answers-live",
  title: "Opening the same subject again answers the signer's live approval",
  question: "Frozen lines say 'Asking twice answers with the same approval' and 'Asking again for the same proposal opens the same approval'. Where is that kept?",
  options: [
    { label: "by-subject", text: "`approvals.open` answers the signer's live approval of the same opener and subject (`opened: false`); an ended one lets a new one open." },
    { label: "opener", text: "Each opener stores its approval id and checks it before opening." },
  ],
  chosen: "by-subject",
  why:
    "One rule for every opener, and the old CAP-943 case (a rebuilt proposal step with a new digest) answers the open " +
    "approval instead of opening a second signature for one intent. The opener still decides what its subject id is (a " +
    "command, a proposal and step, an agent change).",
  source: `${OLD}/accounts/approvals/operations/open-for-proposal.ts:36; blueprint/baseline/operations.ts (org.proposal.approve #3, notes)`,
  affects: [procedure_approvals_open, table_approvals],
});

export const decision_approvals_summary_from_opener = defineDecision({
  id: "approvals.summary-from-opener",
  title: "The opener writes the page's summary once; approvals never reads its openers",
  question:
    "The old `request` built the page's summary by reading Payments, Permissions, Organizations, Profiles and Parties, " +
    "and branched on 13 approval kinds. What builds it now?",
  options: [
    { label: "opener", text: "The opener passes the summary and a free `subject_kind` label in `approvals.open`; approvals stores and shows it." },
    { label: "approvals-reads", text: "Approvals reads each opener's tables to build it, as the old code did." },
  ],
  chosen: "opener",
  why:
    "Approvals sits below every opener (dependencies.approvals-low), so it cannot read them, and the opener already has " +
    "every name and amount in the transaction that births the intent. The 13 kinds were dispatch for that reading and for " +
    "per-kind sends; with one send path nothing branches on kind, so it is only the page's label.",
  source: `${OLD}/accounts/approvals/operations/request.ts:34-76; packages/protocol/src/accounts/approval-schema.ts:44; dependencies.approvals-low`,
  affects: [procedure_approvals_open, table_approvals, rpc_approvals_signing_get],
});

export const decision_approvals_signing_area = defineDecision({
  id: "approvals.signing-area",
  title: "Four signer rpcs replace the old seven approval rows and four execution rows",
  question: "Which of the old public rows the signer used survive, and in what shape?",
  options: [
    {
      label: "four",
      text:
        "get (live, replacing get and observe), review (kept), sign (replacing approve, consume, submit and submitCommand), " +
        "decline (replacing reject and abandon).",
    },
    { label: "port", text: "Port every row: request, get, observe, review, approve, reject, consume, submit, submitCommand, abandon, readSendWitness." },
  ],
  chosen: "four",
  why:
    "The process sends, so a client never consumes or submits (A4: the SDK signs, the backend sends). A live read makes " +
    "`observe` and the SDK's polling wait one subscription. `request` is the opener's procedure now. `review` stays " +
    "because the frozen approval shape returns `reviewedAt` and the approval page has a caller for it. Recovering a key " +
    "is local CPU, so `sign` is one transaction (the old action existed only because viem's recovery failed inside a " +
    "Convex mutation). `readSendWitness` was an e2e probe; a send count is in the trace. Another principal's approval " +
    "and an unknown id are one answer, INVALID_INPUT `approvalId` (the vocabulary's 'names nothing you can see', and " +
    "`payment send`'s 'the execution is unknown'), not the old page rows' ROLE_PERMISSION_DENIED.",
  source: `${OLD}/accounts/approvals/operations/approve.ts:22; packages/protocol/src/accounts/operations.ts:162; packages/sdk/src/accounts/approvals.ts:106-239; P2`,
  affects: [rpc_approvals_signing_get, rpc_approvals_signing_review, rpc_approvals_signing_sign, rpc_approvals_signing_decline],
});

export const decision_approvals_dropped = defineDecision({
  id: "approvals.dropped",
  title: "The old internal steps, sweeps and per-kind relays are not ported",
  question: "What of old accounts' approvals and payments' executions has no target record, and why?",
  options: [
    {
      label: "drop",
      text:
        "Steps of the one process: record-approval, consume-approved, reschedule-approved, record-expiry, store, load, " +
        "load-active, load-lane-holders, claim, complete, fail, classify, reset-claim, record-send-attempt. Gone: the claim " +
        "sweep and hold-claim, list-expired-claims, the expire job, the five open-for-* rows and the per-kind sendSigned relays.",
    },
    { label: "port", text: "Book each as an internal rpc or workflow." },
  ],
  chosen: "drop",
  why:
    "P3: load, record and intent hops are steps, and every sweep is a process's own timer or chain event. The open-for-* " +
    "rows differed only in how they built the summary (now the opener's) and each relay to an area's send existed only " +
    "because each area sent its own kind; one send path ends that. `complete` is the opener following " +
    "`approval_transitioned`. The service-key lanes went to the service signer (responsibilities.service-lanes).",
  source: "docs/as-is/archive/accounts/approvals.ts; docs/as-is/archive/payments/executions.ts; docs/as-is/lane-reports/review-executions.json (designFindings); P3",
  affects: [workflow_approvals_lifecycle_carry, procedure_approvals_open, concept_approvals],
});

export const decision_approvals_no_mail = defineDecision({
  id: "approvals.no-mail",
  title: "Approvals sends no email",
  question: "The old `notify` workflow emailed the signer when an approval opened (approval-pending, pay-run-approval). Does approvals keep it?",
  options: [
    { label: "notices", text: "No: an email belongs to notices, triggered by the opener's transition that says who waits (a proposal waiting for a Director)." },
    { label: "keep", text: "Keep a notify workflow in approvals." },
  ],
  chosen: "notices",
  why:
    "Notices sends every email and depends on the openers, not on approvals, and the opener knows what the email should " +
    "say. No frozen line names an approval email; the person running a command is already looking at the page it opened.",
  source: `${OLD}/accounts/approvals/operations/notify.ts:20; blueprint/shared/foundation.ts (concept notices); P4`,
  affects: [concept_approvals, event_approval_transitioned],
});

export const decision_approvals_no_operations = defineDecision({
  id: "approvals.no-operations",
  title: "Approvals owns no operation; its rpcs are reached by flows and its process",
  question: "With no frozen operation of its own, how is each approvals rpc reached (P2), and which surface does its flow serve?",
  options: [
    {
      label: "steps-and-signals",
      text:
        "`get` is a step of every opener's flow, devnet's `dev approve` flow, payments' follow and this concept's page " +
        "flow; `review` a step of the page flow; `sign` and `decline` the process's signals and flow steps.",
    },
    { label: "operations", text: "Invent approval operations without commands." },
  ],
  chosen: "steps-and-signals",
  why:
    "Every signed command is owned by the concept of its intent (operations.owners), so approvals serves them. The page " +
    "flow `client.approvals.sign` serves the approval page (a React SDK surface, not the CLI), so the build lists it as " +
    "an unused flow until surface flows can say so; that gap is expected. Approvals introduces no world: it has no " +
    "refusal of its own; its openers name the worlds their refusals need.",
  source: "blueprint/shared/foundation.ts (OPERATION_OWNERS); P2 (a flow serving a named surface); blueprint/baseline/operations.ts (dev.approve)",
  affects: [flow_client_approvals_sign, rpc_approvals_signing_get, rpc_approvals_signing_review, rpc_approvals_signing_sign, rpc_approvals_signing_decline],
});

export const decision_approvals_budgets = defineDecision({
  id: "approvals.budgets",
  title: "Budgets at their class defaults",
  question: "Which budget class does each approvals record take?",
  options: [
    {
      label: "defaults",
      text:
        "get live-read; review, sign and decline write; the page flow vendor (the Openfort signer); the process " +
        "background. No overrides.",
    },
    { label: "chain-submit", text: "Give the signer rpcs and the flow chain-submit, as the commands they serve are." },
  ],
  chosen: "defaults",
  why:
    "None of the signer rpcs calls out: recovering a key is local, and sponsorship and the send are the process's. The " +
    "flow's only outside calls are the signer's, and the person's wait is excluded. The chain-submit budget belongs to " +
    "the operations that compose these rpcs; the process's system time (two node reads, sponsorship, one send, one facts " +
    "read) fits the background default.",
  source: "packages/blueprint-engine/src/budgets.ts; P5 (budget-class-fit)",
  affects: [
    rpc_approvals_signing_get,
    rpc_approvals_signing_review,
    rpc_approvals_signing_sign,
    rpc_approvals_signing_decline,
    flow_client_approvals_sign,
    workflow_approvals_lifecycle_carry,
  ],
});
