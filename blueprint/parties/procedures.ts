// Parties' door: the procedures other concepts invoke inside their own transaction. Each writes
// the directory together with the invoker's record because the two are one money fact: a name, or
// a mailbox or address, and the Safe its money routes to. A concept that only needs to show or
// check a counterparty reads `parties` directly (its concept depends on parties) and invokes
// nothing. No procedure makes an outside call: a person's Safe address is a pure function of their
// mailbox, computed in the backend.

import { Schema } from "effect";
import { defineProcedure } from "../../packages/blueprint-engine/src/index.ts";
import { concept_parties } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { machine_party, table_parties } from "./data.ts";

const OLD = "packages/backend/src/parties";

const PartyId = Schema.String;
const Address = Schema.String;
const OwnerKind = Schema.Literals(["person", "organization"]);

/** What a record names a counterparty by: an `@handle`, a mailbox, a 0x address or a Party id. */
const Locator = Schema.Union([
  Schema.TaggedStruct("handle", { handle: Schema.String }),
  Schema.TaggedStruct("mailbox", { mailbox: Schema.String }),
  Schema.TaggedStruct("address", { address: Address }),
  Schema.TaggedStruct("party", { party_id: PartyId }),
]);

// ── an Organization's or agent's birth ──────────────────────────────────────────────────────

export const procedure_parties_register = defineProcedure({
  id: "parties.register",
  title: "Register an Organization's or agent's Party at its birth",
  about:
    "Money fact: a handle and the Safe it routes money to are one fact, so an Organization or an agent is born with its " +
    "Party or not at all (dependencies.parties-registration). Organizations invokes it in `org create`'s birth transaction " +
    "with the company Safe's predicted address (`companySafeAddressFor`); agents in an ordinary self-run `agent create`'s " +
    "birth transaction with the agent's " +
    "predicted Safe (`AgentOwner.safeAddressFor`). The handle is trimmed, lowercased and stripped of a leading `@`, then " +
    "must be 3 to 30 of a-z, 0-9, `_` or `-` and not reserved (admin, api, capxul, help, root, support, system, www). A " +
    "handle ending in `-fde` or starting with `fde-` is kept for its Organization's FDE: `<p>-fde` only for an agent an " +
    "Organization owns whose own Party's handle, cut to its first 26 characters, is `<p>`; `fde-<x>` only when `<x>` is the " +
    "last ten characters of the owning Organization's id, lowercased; any other registration of either is reserved " +
    "(parties.fde-handles). A " +
    "malformed, reserved or taken handle, or a Safe some Party that is not released already holds, refuses with " +
    "`INVALID_INPUT` and the " +
    "invoker's birth rolls back with it: no handle is ever held by a birth that did not happen. The Party is born " +
    "`pending` with its owner (the Organization; an agent's owning person or Organization) and the display name given. " +
    "A second call with the same handle, Safe and owner answers the Party it made.",
  concept: concept_parties,
  input: Schema.Struct({
    kind: Schema.Literals(["organization", "agent"]),
    handle: Schema.String,
    display_name: Schema.String,
    safe_address: Address,
    owner_kind: OwnerKind,
    owner_id: Schema.String,
  }),
  output: Schema.Struct({
    party_id: PartyId,
    handle: Schema.String,
    safe_address: Address,
    state: Schema.Literal("pending"),
  }),
  errors: [error_INVALID_INPUT],
  reads: [table_parties],
  writes: [table_parties],
  drives: [machine_party.t.register],
  invokes: [],
  emits: [],
  was: [
    `${OLD}/writes/parties.ts:121`,
    `${OLD}/writes/parties.ts:218`,
    "packages/protocol/src/parties/model.ts:22",
    "apps/docs/factory/operations/org.create.yaml",
    "apps/docs/factory/operations/agent.create.yaml",
  ],
});

export const procedure_parties_activate = defineProcedure({
  id: "parties.activate",
  title: "An Organization's or agent's Safe is live: its handle starts routing money",
  about:
    "Money fact: a handle routes money to its Safe only once that Safe is live, so the Party turns `active` in the same " +
    "transaction that makes its Organization or agent live. Organizations invokes it when its setup sees the company Safe " +
    "minted (the Organization's Party); agents when the self-run agent's create lands. Until then resolution answers " +
    "the Party as `pending`, and a payment " +
    "can refuse it, because parties cannot read whether an agent's Safe exists. Activating an active Party is a no-op; a " +
    "released one refuses with `WRONG_STATE`, which is a defect in the invoker.",
  concept: concept_parties,
  input: Schema.Struct({ party_id: PartyId }),
  output: Schema.Struct({ party_id: PartyId, state: Schema.Literal("active") }),
  errors: [error_WRONG_STATE],
  reads: [table_parties],
  writes: [table_parties],
  drives: [machine_party.t.activate],
  invokes: [],
  emits: [],
  was: [`${OLD}/writes/parties.ts:246`],
});

export const procedure_parties_release = defineProcedure({
  id: "parties.release",
  title: "A birth failed for good: its Party is released and its handle freed",
  about:
    "Money fact: a handle whose Safe will never exist must stop naming it, so no payment is routed to a Safe nobody can " +
    "deploy; the release commits with the transition that ends the birth. Agents invokes it when a create the chain " +
    "refused, or one whose approval lapsed unsent, fails ('fails and frees its handle'); organizations when a setup " +
    "fails for good, only while the Organization's Party is still pending (a " +
    "setup that fails after its company Safe was minted keeps the Organization's handle). The handle is cleared, the id " +
    "is kept for the records that point at it. Releasing a released " +
    "Party is a no-op; an active one refuses with `WRONG_STATE`: a live Safe's handle is never freed, so a removed agent's " +
    "handle stays taken.",
  concept: concept_parties,
  input: Schema.Struct({ party_id: PartyId }),
  output: Schema.Struct({ party_id: PartyId, state: Schema.Literal("released") }),
  errors: [error_WRONG_STATE],
  reads: [table_parties],
  writes: [table_parties],
  drives: [machine_party.t.release],
  invokes: [],
  emits: [],
  was: [`${OLD}/writes/parties.ts:257`, "apps/docs/factory/operations/agent.create.yaml", "apps/docs/factory/operations/agent.remove.yaml"],
});

// ── naming a counterparty ───────────────────────────────────────────────────────────────────

export const procedure_parties_resolve_recipient = defineProcedure({
  id: "parties.resolve-recipient",
  title: "Resolve a counterparty to its Party and Safe, naming it if it is new",
  about:
    "Money fact: the counterparty a record names and the Safe its money routes to are bound once, with the record that " +
    "first names it: one Party per mailbox, Safe and handle, so every later naming, the person's claim and every chain " +
    "view agree on whose Safe it is. For a write that keys its record on a Party id: a contact, a request's payer, an " +
    "agreement's payee, an invitee, a sweep's destination, a CRM entry's person or company (contact add, a recorded " +
    "entry's link, a lead's conversion). The locator's shape decides the lookup: `@handle` (normalized " +
    "as at registration), mailbox (trimmed and lowercased, then digested), 0x address (lowercased) or Party id; nothing is " +
    "scanned. A mailbox no Party holds is named `provisional` at its derived Safe, or adopts the outside Party already " +
    "there; an address no Party holds is named `outside`. It never refuses: a locator that names nothing comes back " +
    "`resolved: false` with its reason (malformed, the zero address, an unknown handle or Party id, a released Party), and " +
    "the invoker refuses in its own surface's words (`INVALID_INPUT` for most commands, `INVALID_RECIPIENT` for a " +
    "payment). A `pending` Party is answered as such; whether to accept one, and how much of the answer the caller is " +
    "shown, are the invoker's rules.",
  concept: concept_parties,
  input: Schema.Struct({ locator: Locator }),
  output: Schema.Union([
    Schema.Struct({
      resolved: Schema.Literal(true),
      party_id: PartyId,
      kind: Schema.Literals(["person", "agent", "organization", "address"]),
      state: Schema.Literals(["provisional", "outside", "pending", "active"]),
      handle: Schema.NullOr(Schema.String),
      display_name: Schema.NullOr(Schema.String),
      safe_address: Address,
      named: Schema.Boolean,
    }),
    Schema.Struct({
      resolved: Schema.Literal(false),
      reason: Schema.Literals(["malformed", "zero-address", "unknown-handle", "unknown-party", "released"]),
    }),
  ]),
  errors: [],
  reads: [table_parties],
  writes: [table_parties],
  drives: [machine_party.t.name_person, machine_party.t.name_address, machine_party.t.adopt_mailbox],
  invokes: [],
  emits: [],
  was: [
    `${OLD}/reads/recipients.ts:73`,
    `${OLD}/writes/parties.ts:79`,
    `${OLD}/writes/parties.ts:105`,
    `${OLD}/recipients/reads.ts:47`,
  ],
});
