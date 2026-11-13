// The approvals concept's data: one table, `approvals`, and its one state machine, `approval`, with
// the machine's one event, `approval_transitioned` (P7).
//
// An approval is one UserOperation from a signer's own Safe (v4 D1): the calls its opener asked for,
// the summary the approval page shows, its sponsorship, the signer's signature, its one send and the
// chain proof that ends it. The row is born inside the opener's transaction (`approvals.open`, in
// ./procedures.ts) and moved from then on by its one durable process (`approvals.lifecycle.carry`, in
// ./processes.ts), by the signer's two signals (./signing.ts) and by its opener's withdrawal. Old
// accounts' approvals, old payments' money executions and provider send attempts become this one
// table (decision `approvals.one-table`). Timestamps are UTC instants (timestamptz).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_approvals } from "../shared/foundation.ts";

const OLD = "packages/backend/src";
const AS_IS = "docs/as-is/archive";

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

const S = Schema.String;
const NullOr = Schema.NullOr;
const Instant = Schema.DateTimeUtc;
/** A 20-byte address, 0x-prefixed and lowercased. */
export const Address = S;
/** 0x-prefixed bytes or a 32-byte hash. */
export const Hex = S;
/** An unsigned integer in its smallest unit, as a decimal string (a raw token amount, a nonce, a gas limit). */
export const Uint = S;

/** The concepts that open approvals (every chain-writing concept above approvals in the map). */
export const Opener = Schema.Literals(["accounts", "organizations", "board", "agents", "budgets", "payments", "payroll", "equity"]);

/** One call the operation makes from the sender Safe, in order. */
export const Call = Schema.Struct({ to: Address, value: Uint, data: Hex });

/** An asset and an amount as the page prints it: `USDC`, `250.00`. */
const AssetAmount = Schema.Struct({ asset: S, value: S });
const Warning = Schema.Struct({ code: S, message: S });

/** What the approval page shows before anyone signs. Written once by the opener; approvals never reads its opener. */
export const Summary = Schema.Struct({
  title: S,
  from: Schema.Struct({ label: S, address: Address }),
  to: Schema.Struct({ label: S }),
  amount: NullOr(AssetAmount),
  recipients: Schema.Array(
    Schema.Struct({
      label: S,
      amount: AssetAmount,
      requestedOutput: NullOr(Schema.Struct({ currency: S, value: S })),
      exact: Schema.Boolean,
      rail: Schema.Literals(["wallet", "bank"]),
      warning: NullOr(Warning),
    }),
  ),
  warnings: Schema.Array(Warning),
});

/** What a held operation needs on the day it is sent: `holder` must hold at least `amount` of `token`. */
export const Need = Schema.Struct({ token: Address, holder: Address, amount: Uint });

/** The sponsored ERC-4337 v0.7 UserOperation, unsigned: what the signature covers with the window. */
export const UserOperation = Schema.Struct({
  sender: Address,
  nonce: Uint,
  callData: Hex,
  callGasLimit: Uint,
  verificationGasLimit: Uint,
  preVerificationGas: Uint,
  maxFeePerGas: Uint,
  maxPriorityFeePerGas: Uint,
  paymaster: Address,
  paymasterVerificationGasLimit: Uint,
  paymasterPostOpGasLimit: Uint,
  paymasterData: Hex,
});

/** Why an approval ended without landing, or why its last send bounced: an error code of the shared vocabulary and its reason. */
export const Refusal = Schema.Struct({ code: S, reason: S });

// ── table ───────────────────────────────────────────────────────────────────────────────────

export const table_approvals = defineTable({
  id: "approvals",
  title: "Approvals: one UserOperation from a signer's own Safe",
  about:
    "One row per UserOperation Capxul carries from a person's or an agent's own Safe, from birth to chain proof. The " +
    "opener gives the calls, the summary, its subject, its deadline and any gate (and, for a dated operation, the day it " +
    "is sent and what it needs that day); the sender is the signer's own Safe, from access' principals; the process adds " +
    "the sponsorship (the signer read from the Safe, the " +
    "nonce on the approval's own key, the sponsored operation, its SafeOp digest, its UserOperation hash and window); the " +
    "signer adds the signature; the send and the chain add the rest. Calls, summary, digest and signature never change " +
    "once written. `person_id` is the principal whose key signs (a person, or an agent signing with its own key); `org_id` " +
    "names the Organization whose money or authority it moves, for the page only. A replacement (the void of a dated " +
    "payment) shares the replaced approval's nonce, so at most one of them can land. Openers read their approvals here by " +
    "id; the signer reads theirs through ./signing.ts. No other concept writes it.",
  concept: concept_approvals,
  tenancy: "person",
  tenantField: "person_id",
  fields: Schema.Struct({
    person_id: S,
    approval_id: S,
    state: Schema.Literals([
      "sponsoring", "pending", "signed", "sending", "sent", "landed", "reverted", "displaced", "expired", "declined",
      "refused", "withdrawn",
    ]),
    org_id: NullOr(S),
    opener: Opener,
    subject_kind: S,
    subject_id: S,
    chain_id: Schema.Int,
    sender: Address,
    calls: Schema.Array(Call),
    summary: Summary,
    deadline: Instant,
    send_after: NullOr(Instant),
    needs: Schema.Array(Need),
    gate: NullOr(S),
    replaces: NullOr(S),
    nonce_key: Uint,
    nonce: NullOr(Uint),
    signer_address: NullOr(Address),
    user_operation: NullOr(UserOperation),
    digest: NullOr(Hex),
    user_op_hash: NullOr(Hex),
    valid_after: NullOr(Instant),
    valid_until: NullOr(Instant),
    signature: NullOr(Hex),
    send_error: NullOr(Refusal),
    refusal: NullOr(Refusal),
    transaction_hash: NullOr(Hex),
    block_number: NullOr(Schema.Int),
    displaced_by: NullOr(Hex),
    created_at: Instant,
    reviewed_at: NullOr(Instant),
    signed_at: NullOr(Instant),
    sent_at: NullOr(Instant),
    ended_at: NullOr(Instant),
    updated_at: Instant,
  }),
  key: ["person_id", "approval_id"],
  indexes: [
    {
      name: "by-id",
      fields: ["approval_id"],
      unique: true,
      crossTenant: true,
      for:
        "One approval by its id alone: its process resuming, an opener's workflow following the approval its own row names, " +
        "and the approval page's link, which carries only the id (row-level security still scopes the page's read to its signer).",
    },
    {
      name: "by-subject",
      fields: ["person_id", "opener", "subject_id"],
      for: "The signer's live approval of one opener's subject, so asking twice answers with the same approval (`approvals.open`).",
    },
    {
      name: "by-sender-nonce",
      fields: ["chain_id", "sender", "nonce"],
      crossTenant: true,
      for:
        "The approvals that hold one nonce of a Safe, so the indexed UserOperationEvent at that sender and nonce resumes each " +
        "of them: the one whose hash it names, and any it displaced. Keyed by the chain's Safe, which is the only id the event carries.",
    },
  ],
  retention:
    "Kept: the record of what each signer signed and what the chain made of it. A row that ended unsigned (declined, " +
    "refused, withdrawn, expired before a signature) may be purged after 90 days.",
  was: [
    `${AS_IS}/accounts/data.ts`,
    `${AS_IS}/payments/data.ts`,
    `${OLD}/accounts/approvals/writes.ts:52`,
    `${OLD}/payments/executions/writes/stores.ts:67`,
    `${OLD}/payments/executions/writes/witnesses.ts:24`,
  ],
});

// ── state machine and its event ─────────────────────────────────────────────────────────────

const ApprovalState = table_approvals.fields.fields.state;

export const event_approval_transitioned = defineEvent({
  id: "approval_transitioned",
  about:
    "An approval changed state. Its opener's workflows are triggered by it (the opener's subject is on it) and the funnel " +
    "reads it; `from` is null at birth. The runtime writes it to the outbox in the transition's transaction.",
  props: Schema.Struct({
    from: NullOr(ApprovalState),
    to: ApprovalState,
    transition: Schema.Literals([
      "open", "sponsor", "refuse", "sign", "decline", "withdraw", "claim_send", "accept", "bounce", "land", "revert",
      "displace", "expire",
    ]),
    approval_id: S,
    person_id: S,
    org_id: NullOr(S),
    opener: Opener,
    subject_kind: S,
    subject_id: S,
  }),
  was: [`${AS_IS}/accounts/data.ts`],
});

const E = [event_approval_transitioned];

export const machine_approval = defineMachine({
  id: "approval",
  title: "Approval: from birth to chain proof",
  about:
    "approvals.state. Born `sponsoring` in its opener's transaction. Before a signature it can be refused (the paymaster's " +
    "simulation says the chain would refuse it), declined by its signer, withdrawn by its opener, or expire. Once signed, " +
    "only the chain ends it (decision `approvals.chain-proof`): landed or reverted when the indexed UserOperationEvent at its " +
    "nonce names its own hash, displaced when it names another, expired when its window has closed (with grace) and its " +
    "nonce has not moved. Every write to `state` is one of these transitions, and each sends `approval_transitioned`.",
  table: table_approvals,
  field: "state",
  initial: "sponsoring",
  states: [
    { id: "sponsoring", about: "Born with its calls and summary; its process is asking the paymaster to sponsor it." },
    { id: "pending", about: "Sponsored: its digest waits for the signer on the approval page, or for the agent's own key." },
    { id: "signed", about: "Holds a signature that recovers to the Safe's owner over its digest; sent at once, or held until its day." },
    { id: "sending", about: "Its one send is claimed: committed before the bundler is called, so a crash never sends it twice (K4)." },
    { id: "sent", about: "The bundler accepted it under its UserOperation hash; it waits for the chain." },
    { id: "landed", about: "The chain's UserOperationEvent at its nonce names its hash and says it succeeded.", terminal: true },
    { id: "reverted", about: "It landed and its calls reverted: nothing it carried happened.", terminal: true },
    { id: "displaced", about: "Another operation used its nonce (its replacement landed first): it can never land.", terminal: true },
    { id: "expired", about: "Its window closed, with grace, and its nonce never moved: it can never land.", terminal: true },
    { id: "declined", about: "Its signer said no before signing. Nothing was signed or sent.", terminal: true },
    { id: "refused", about: "The paymaster's simulation, or the paymaster itself, refused it before anyone signed.", terminal: true },
    { id: "withdrawn", about: "Its opener's intent ended before it was signed, and took the approval with it.", terminal: true },
  ],
  transitions: {
    open: {
      from: [],
      to: "sponsoring",
      about: "`approvals.open`, inside the opener's transaction: the row with its calls, summary, subject and deadline.",
      guard: "At least one call; a deadline (and a day, if dated) in the future; a replacement only of a signed, held approval of the same Safe.",
      emits: E,
    },
    sponsor: {
      from: ["sponsoring"],
      to: "pending",
      about: "The process recorded the signer, the nonce, the sponsored operation, its digest, its hash and its window.",
      emits: E,
    },
    refuse: {
      from: ["sponsoring"],
      to: "refused",
      about: "The simulation reverted (authority, balance or another revert), or the paymaster failed or answered unusably on every try.",
      guard: "Nothing is signed yet; `refusal` names the code the opener answers with.",
      emits: E,
    },
    sign: {
      from: ["pending"],
      to: "signed",
      about: "`approvals.signing.sign`: the signature recovers to the stored signer over the stored digest.",
      guard: "The caller is the signer, the window is still open, and the gate it names, if any, is on.",
      emits: E,
    },
    decline: {
      from: ["sponsoring", "pending"],
      to: "declined",
      about: "`approvals.signing.decline`: the signer said no on the approval page.",
      emits: E,
    },
    withdraw: {
      from: ["sponsoring", "pending"],
      to: "withdrawn",
      about: "`approvals.withdraw`, inside the opener's transaction, when the intent it carries ended first.",
      emits: E,
    },
    claim_send: {
      from: ["signed"],
      to: "sending",
      about: "The process claims its one send, at once or on its day once its needs and gate hold.",
      guard: "The window is open and nothing holds its nonce but itself or the approval it replaces.",
      emits: E,
    },
    accept: {
      from: ["sending"],
      to: "sent",
      about: "The bundler answered its own hash, or, after a lost answer, a lookup by hash found it held.",
      emits: E,
    },
    bounce: {
      from: ["sending"],
      to: "signed",
      about: "The bundler refused it in validation and a lookup confirms it does not hold it; it is sent again after a pause (CAP-1018).",
      guard: "Only a definitive refusal the bundler does not hold; an unanswered send is looked up, never sent again.",
      emits: E,
    },
    land: {
      from: ["signed", "sending", "sent"],
      to: "landed",
      about: "The UserOperationEvent at its sender and nonce names its hash with success, indexed at the deployment's finality depth.",
      emits: E,
    },
    revert: {
      from: ["signed", "sending", "sent"],
      to: "reverted",
      about: "The UserOperationEvent at its nonce names its hash without success: it landed and reverted.",
      emits: E,
    },
    displace: {
      from: ["sponsoring", "pending", "signed", "sending", "sent"],
      to: "displaced",
      about: "The final indexed UserOperationEvent at its persisted nonce names another hash; `displaced_by` keeps it. A replacement may already inherit that nonce while sponsoring.",
      emits: E,
    },
    expire: {
      from: ["sponsoring", "pending", "signed", "sending", "sent"],
      to: "expired",
      about: "Its window's timer: the window plus two minutes' grace has passed and the nonce read on chain has not moved (K6).",
      guard: "Never while the nonce has moved: then the indexed event decides it.",
      emits: E,
    },
  },
  was: [
    `${AS_IS}/accounts/data.ts`,
    `${AS_IS}/payments/data.ts`,
    `${OLD}/payments/rules/attempts.ts:90`,
    `${OLD}/accounts/approvals/rules.ts:47`,
  ],
});
