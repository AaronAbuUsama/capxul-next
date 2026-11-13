// The world package's own failures, declared here once. They are faults of the infrastructure or of how a command
// was asked, not refusals of the contract: the contract's refusals (WorldExists, WorldQuotaReached, WorldNotFound)
// are the blueprint's, and are imported from it. Nothing here carries a secret.
import * as Schema from "effect/Schema";
import { StepName } from "./stack/names.ts";

type Brand = { readonly brand: unique symbol };

// What was asked for cannot be made.

export class InvalidWorldName extends Schema.TaggedError<InvalidWorldName, Brand>()("InvalidWorldName", {
  given: Schema.String,
  message: Schema.String,
}) {}

export class InvalidOwner extends Schema.TaggedError<InvalidOwner, Brand>()("InvalidOwner", {
  given: Schema.String,
  message: Schema.String,
}) {}

/** A private world may live at most 7 days (Aaron, 13 November 2026). The blueprint has no refusal for this yet. */
export class LifetimeTooLong extends Schema.TaggedError<LifetimeTooLong, Brand>()("LifetimeTooLong", {
  world: Schema.String,
  askedMs: Schema.Finite,
  mostMs: Schema.Finite,
  message: Schema.String,
}) {}

export class InvalidLifetime extends Schema.TaggedError<InvalidLifetime, Brand>()("InvalidLifetime", {
  given: Schema.String,
  message: Schema.String,
}) {}

export class InvalidMint extends Schema.TaggedError<InvalidMint, Brand>()("InvalidMint", {
  given: Schema.String,
  message: Schema.String,
}) {}

// The platform and the shared state.

export class PlatformMissing extends Schema.TaggedError<PlatformMissing, Brand>()("PlatformMissing", {
  message: Schema.String,
}) {}

export class WorldsStillExist extends Schema.TaggedError<WorldsStillExist, Brand>()("WorldsStillExist", {
  worlds: Schema.Array(Schema.String),
  message: Schema.String,
}) {}

export class StateUnreadable extends Schema.TaggedError<StateUnreadable, Brand>()("StateUnreadable", {
  stage: Schema.String,
  what: Schema.String,
  message: Schema.String,
}) {}

export class WorldSettingsMissing extends Schema.TaggedError<WorldSettingsMissing, Brand>()("WorldSettingsMissing", {
  message: Schema.String,
}) {}

export class AccountUnreadable extends Schema.TaggedError<AccountUnreadable, Brand>()("AccountUnreadable", {
  what: Schema.String,
  status: Schema.Int,
  message: Schema.String,
}) {}

export class DatabaseRefused extends Schema.TaggedError<DatabaseRefused, Brand>()("DatabaseRefused", {
  status: Schema.Int,
  message: Schema.String,
}) {}

// A world's life.

export class StepTimedOut extends Schema.TaggedError<StepTimedOut, Brand>()("StepTimedOut", {
  step: StepName,
  afterMs: Schema.Finite,
  message: Schema.String,
}) {}

export class WorldNotReady extends Schema.TaggedError<WorldNotReady, Brand>()("WorldNotReady", {
  part: Schema.Literals(["chain", "index", "core", "fork"]),
  message: Schema.String,
}) {}

/** The sweep ran to the end, but something that should have gone is still there. */
export class SweepIncomplete extends Schema.TaggedError<SweepIncomplete, Brand>()("SweepIncomplete", {
  worlds: Schema.Array(Schema.String),
  images: Schema.Array(Schema.String),
  message: Schema.String,
}) {}

export class FaucetFailed extends Schema.TaggedError<FaucetFailed, Brand>()("FaucetFailed", {
  step: Schema.Literals(["deploy", "mint", "read"]),
  message: Schema.String,
}) {}

export class ProofFailed extends Schema.TaggedError<ProofFailed, Brand>()("ProofFailed", {
  message: Schema.String,
}) {}

// Inside a world's Durable Objects.

export class ChainFailed extends Schema.TaggedError<ChainFailed, Brand>()("ChainFailed", {
  step: Schema.Literals(["start", "rpc", "save", "restore", "stop", "asleep", "adopt"]),
  message: Schema.String,
}) {}

export class IndexerFailed extends Schema.TaggedError<IndexerFailed, Brand>()("IndexerFailed", {
  step: Schema.Literals(["start", "stop", "status"]),
  message: Schema.String,
}) {}
