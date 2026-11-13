// The world package's own failures, declared here once. They are faults of the infrastructure or of how a command
// was asked, not refusals of the contract: the contract's refusals (WorldExists, WorldQuotaReached, WorldNotFound)
// are the blueprint's and are imported from it where they are raised. Nothing here carries a secret, and nothing
// here imports another package: the Workers' bundles include this file.
import * as Schema from "effect/Schema";
import { StepName } from "./stack/names.ts";

// What was asked for cannot be made.

export class InvalidWorldName extends Schema.TaggedError<InvalidWorldName, { readonly brand: unique symbol }>()(
  "InvalidWorldName",
  { given: Schema.String, message: Schema.String },
) {}

export class InvalidOwner extends Schema.TaggedError<InvalidOwner, { readonly brand: unique symbol }>()(
  "InvalidOwner",
  { given: Schema.String, message: Schema.String },
) {}

/** A private world may live at most 7 days (Aaron, 13 November 2026). The blueprint has no refusal for this yet. */
export class LifetimeTooLong extends Schema.TaggedError<LifetimeTooLong, { readonly brand: unique symbol }>()(
  "LifetimeTooLong",
  { world: Schema.String, askedMs: Schema.Finite, mostMs: Schema.Finite, message: Schema.String },
) {}

export class InvalidDuration extends Schema.TaggedError<InvalidDuration, { readonly brand: unique symbol }>()(
  "InvalidDuration",
  { given: Schema.String, message: Schema.String },
) {}

export class InvalidMint extends Schema.TaggedError<InvalidMint, { readonly brand: unique symbol }>()("InvalidMint", {
  given: Schema.String,
  message: Schema.String,
}) {}

// The platform, the shared state and the two accounts.

export class PlatformMissing extends Schema.TaggedError<PlatformMissing, { readonly brand: unique symbol }>()(
  "PlatformMissing",
  { message: Schema.String },
) {}

export class WorldsStillExist extends Schema.TaggedError<WorldsStillExist, { readonly brand: unique symbol }>()(
  "WorldsStillExist",
  { worlds: Schema.Array(Schema.String), message: Schema.String },
) {}

export class StateUnreadable extends Schema.TaggedError<StateUnreadable, { readonly brand: unique symbol }>()(
  "StateUnreadable",
  { stage: Schema.String, what: Schema.String, message: Schema.String },
) {}

export class WorldSettingsMissing extends Schema.TaggedError<WorldSettingsMissing, { readonly brand: unique symbol }>()(
  "WorldSettingsMissing",
  { message: Schema.String },
) {}

export class AccountUnreadable extends Schema.TaggedError<AccountUnreadable, { readonly brand: unique symbol }>()(
  "AccountUnreadable",
  { what: Schema.String, status: Schema.Int, message: Schema.String },
) {}

export class DatabaseRefused extends Schema.TaggedError<DatabaseRefused, { readonly brand: unique symbol }>()(
  "DatabaseRefused",
  { status: Schema.Int, message: Schema.String },
) {}

// A world's life.

export class StepTimedOut extends Schema.TaggedError<StepTimedOut, { readonly brand: unique symbol }>()(
  "StepTimedOut",
  { step: StepName, afterMs: Schema.Finite, message: Schema.String },
) {}

export class WorldNotReady extends Schema.TaggedError<WorldNotReady, { readonly brand: unique symbol }>()(
  "WorldNotReady",
  { part: Schema.Literals(["chain", "index", "core", "fork"]), message: Schema.String },
) {}

/** The sweep ran to the end, but something that should have gone is still there. */
export class SweepIncomplete extends Schema.TaggedError<SweepIncomplete, { readonly brand: unique symbol }>()(
  "SweepIncomplete",
  { worlds: Schema.Array(Schema.String), images: Schema.Array(Schema.String), message: Schema.String },
) {}

export class FaucetFailed extends Schema.TaggedError<FaucetFailed, { readonly brand: unique symbol }>()(
  "FaucetFailed",
  { step: Schema.Literals(["deploy", "mint", "read"]), message: Schema.String },
) {}

/** A proof's check did not hold, or no proof has the name asked for. */
export class ProofFailed extends Schema.TaggedError<ProofFailed, { readonly brand: unique symbol }>()("ProofFailed", {
  message: Schema.String,
}) {}

// Inside a world's Durable Objects.

export class ChainFailed extends Schema.TaggedError<ChainFailed, { readonly brand: unique symbol }>()("ChainFailed", {
  step: Schema.Literals(["start", "rpc", "save", "restore", "stop", "asleep", "adopt"]),
  message: Schema.String,
}) {}

/** The world's bundler: inside its Durable Object (start, ready, rpc, stop, status), and from outside (setup, call). */
export class BundlerFailed extends Schema.TaggedError<BundlerFailed, { readonly brand: unique symbol }>()(
  "BundlerFailed",
  {
    step: Schema.Literals(["start", "ready", "rpc", "stop", "status", "setup", "call"]),
    message: Schema.String,
  },
) {}

export class IndexerFailed extends Schema.TaggedError<IndexerFailed, { readonly brand: unique symbol }>()(
  "IndexerFailed",
  { step: Schema.Literals(["start", "stop", "status"]), message: Schema.String },
) {}
