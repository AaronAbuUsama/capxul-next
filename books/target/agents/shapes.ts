// The input and output shapes of agents' rpcs, flows and operations. Not records: the area files,
// flows.ts and operations.ts hold them as values, so this module is not in index.ts' list. Field
// names are the camelCase the SDK and `--json` print; addresses and hashes are lowercase hex,
// raw amounts decimal strings in the token's smallest unit, display amounts decimal strings in the
// token's units (`312.50`), times ISO 8601 instants in UTC.

import { Schema } from "effect";
import { AgentState, CarrierKind, ChangeKind, ChangeOutcome, ChangeState, KeyStore, LocalKeyStore } from "./data.ts";

const S = Schema.String;
const Int = Schema.Int;
const NullOr = Schema.NullOr;
const Arr = Schema.Array;

// ── inputs ──────────────────────────────────────────────────────────────────────────────────

/** An agent as a command names it: its `agent_` id, or its `@handle` with or without the `@`. */
export const AgentRef = S;

export const CreateInput = Schema.Struct({
  name: S,
  /** Its `@handle`; null takes the name, lower case (parties normalizes it). */
  handle: NullOr(S),
  /** The new key's address. The key itself never leaves the machine that made it. */
  signer: S,
  keyStore: LocalKeyStore,
  /** `--org`: the owning Organization by handle or id; null for an agent the caller owns. */
  org: NullOr(S),
});

export const RefInput = Schema.Struct({ agent: AgentRef });

export const RotateInput = Schema.Struct({ agent: AgentRef, signer: S, keyStore: LocalKeyStore });

export const SweepInput = Schema.Struct({
  agent: AgentRef,
  /** An email, `@handle` or 0x address for the recipient resolver; null sweeps to the owner's Safe. */
  to: NullOr(S),
  /** One settlement asset by symbol; null selects every settlement asset the Safe holds. */
  asset: NullOr(S),
});

export const ChangeIdInput = Schema.Struct({ changeId: S });

// ── views ───────────────────────────────────────────────────────────────────────────────────

/** Who owns the agent: a person with their Account, email and Safe, or an Organization with its handle and Safe. */
export const OwnerView = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person"), accountId: S, email: S, safe: S }),
  Schema.Struct({ kind: Schema.Literal("organization"), orgId: S, handle: S, name: S, safe: S }),
]);

/** What carries a change: the owner's approval (with its page) or the owning Organization's Board proposal. */
export const CarrierView = Schema.Struct({ kind: CarrierKind, id: S, url: NullOr(S) });

/** One settlement asset as a change names it, with what the agent's Safe held of it at preparation. */
export const AssetView = Schema.Struct({ asset: S, token: S, decimals: Int, preparedRaw: S, prepared: S });

/** What one AgentSwept moved, as settlement reports it. */
export const SweptView = Schema.Struct({ asset: S, token: S, to: S, rawAmount: S, amount: S });

export const ChangeView = Schema.Struct({
  changeId: S,
  agentId: S,
  kind: ChangeKind,
  state: ChangeState,
  carrier: CarrierView,
  oldSigner: NullOr(S),
  signer: NullOr(S),
  recipient: NullOr(Schema.Struct({ partyId: S, safe: S, label: S })),
  assets: Arr(AssetView),
  swept: Arr(SweptView),
  txHash: NullOr(S),
  failure: NullOr(Schema.Struct({ outcome: ChangeOutcome, code: S, reason: S })),
  createdAt: S,
  endedAt: NullOr(S),
});

/** One agent, as `agent list` and every change print it. */
export const AgentView = Schema.Struct({
  agentId: S,
  name: S,
  handle: S,
  /** Its principal in access, bound at its first sign-in with its own key; null until then. */
  accountId: NullOr(S),
  safe: S,
  /** The address of the key it signs with now. The key itself never leaves where it was made. */
  signer: S,
  key: Schema.Struct({ kind: Schema.Literal("own-key"), store: KeyStore }),
  state: AgentState,
  owner: OwnerView,
  createdAt: S,
  activatedAt: NullOr(S),
  lastChange: NullOr(ChangeView),
});

/** What the agent's Safe holds of one settlement asset, read from the chain. */
export const PositionView = Schema.Struct({ asset: S, token: S, decimals: Int, raw: S, amount: S });

/** A Seat the agent's Safe holds, and what the Seat was given: the hats its Safe wears in that Organization. */
export const SeatView = Schema.Struct({ orgId: S, handle: S, name: S, permissions: Arr(S) });

/** `agent show`: the agent, what its Safe holds and the Seats it holds. */
export const AgentDetail = Schema.Struct({ ...AgentView.fields, positions: Arr(PositionView), seats: Arr(SeatView) });

/** What a preparing rpc answers: the agent as it stands, the waiting change and its carrier. */
export const Prepared = Schema.Struct({ agent: AgentView, change: ChangeView, carrier: CarrierView });

/** A change and its agent as the live follow pushes them. */
export const Followed = Schema.Struct({ agent: AgentView, change: ChangeView });

// ── what the CLI prints with --json ─────────────────────────────────────────────────────────

/** Where a new key lives: a private file here, or `env` with the key itself, shown this once. */
export const KeyJson = Schema.Union([
  Schema.Struct({ store: Schema.Literal("file") }),
  Schema.Struct({ store: Schema.Literal("env"), privateKey: S }),
]);

/** With `--no-wait` the command returns at the carrier; followed, at the change's end. Both name the change. */
const Followable = { changeId: S, carrier: CarrierView };

export const CreateJson = Schema.Struct({
  agentId: S,
  name: S,
  handle: S,
  accountId: NullOr(S),
  safe: S,
  state: AgentState,
  owner: OwnerView,
  key: KeyJson,
  ...Followable,
});

export const StateJson = Schema.Struct({ agentId: S, handle: S, state: AgentState, ...Followable });

export const RotateJson = Schema.Struct({
  agentId: S,
  handle: S,
  state: ChangeState,
  txHash: NullOr(S),
  oldSigner: S,
  signer: S,
  key: KeyJson,
  ...Followable,
});

export const SweepJson = Schema.Struct({
  agentId: S,
  handle: S,
  state: ChangeState,
  txHash: NullOr(S),
  to: S,
  swept: Arr(SweptView),
  ...Followable,
});

export const RemoveJson = Schema.Struct({
  agentId: S,
  handle: S,
  state: AgentState,
  txHash: NullOr(S),
  swept: Arr(SweptView),
  /** The Seats its Safe held at preparation, which organizations ends once AgentRemoved is on chain. */
  seatsEnded: Int,
  ...Followable,
});

export const ListJson = Schema.Struct({ agents: Arr(AgentView) });
