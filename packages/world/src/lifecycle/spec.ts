// What a caller says about the world it wants, what it is handed back, and the declared timeout of every step.
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { Mint } from "../chain/faucet.ts";
import type { DatabaseRefused } from "../database/sql.ts";
import type { HttpClientError } from "effect/http/HttpClientError";
import type * as HttpClient from "effect/http/HttpClient";
import { StepName } from "./record.ts";

export interface WorldSpec {
  /** The world's name: lower case letters, digits and dashes, at most 15 characters. */
  readonly name: string;
  readonly owner: string;
  /** How long the world may exist. Past this, Neon deletes its branch by itself and the sweeper deletes the rest. */
  readonly lifetime: Duration.Duration;
  /** Make the world from another: its database is a copy-on-write fork of that world's, and its chain starts from that world's state. */
  readonly from?: string;
  /** Leave a world whose run did not pass in place, stopped, until its expiry, so it can be looked into. Never applies to a passing run. */
  readonly keepOnFailure?: boolean;
  /** The directory of `.sql` files applied to the world's database when it is created. Defaults to the placeholder Core's. */
  readonly migrations?: string;
  /** Test USDC to mint from the faucet when the world is created: who is funded is the caller's decision (the cast). */
  readonly mint?: ReadonlyArray<Mint>;
  /** The most the use step may take, in place of the declared default. */
  readonly useTimeout?: Duration.Duration;
  /** Where the run's record is written, outside the world. Defaults to the package's records directory. */
  readonly records?: string;
  /** The record's file name, without `.json`. Defaults to the world's name. */
  readonly recordAs?: string;
}

/** A world that answers. Everything a run needs to use it; nothing in it prints a secret. */
export interface World {
  readonly name: string;
  readonly stage: string;
  readonly owner: string;
  readonly expiresAt: string;
  readonly forkedFrom: string;
  /** Where the world's Core answers. */
  readonly coreUrl: string;
  /** The world's test USDC, and what the faucet minted when the world was created. */
  readonly testUsdc: string;
  readonly funded: ReadonlyArray<{
    readonly to: string;
    readonly minted: string;
    readonly holds: string;
    readonly tx: string;
  }>;
  /** The chain's JSON-RPC address. It carries the world's token, so it is a secret. */
  readonly rpcUrl: Redacted.Redacted<string>;
  /** The door's address with the world's token: the chain's and the index's controls live under it. */
  readonly door: Redacted.Redacted<string>;
  /** The database's connection string, for a driver. Prefer `sql`. */
  readonly database: Redacted.Redacted<string>;
  /** One statement on the world's database, over HTTPS. */
  readonly sql: (
    statement: string,
    params?: ReadonlyArray<unknown>,
  ) => Effect.Effect<
    ReadonlyArray<unknown>,
    DatabaseRefused | HttpClientError | Schema.SchemaError,
    HttpClient.HttpClient
  >;
}

export class StepTimedOut extends Schema.TaggedError<StepTimedOut>()("StepTimedOut", {
  step: StepName,
  afterMs: Schema.Number,
  message: Schema.String,
}) {}

export class WorldNotReady extends Schema.TaggedError<WorldNotReady>()("WorldNotReady", {
  part: Schema.Literals(["chain", "index", "core", "fork"]),
  message: Schema.String,
}) {}

export class WorldNotFound extends Schema.TaggedError<WorldNotFound>()("WorldNotFound", {
  world: Schema.String,
  message: Schema.String,
}) {}

export class LifetimeTooLong extends Schema.TaggedError<LifetimeTooLong>()("LifetimeTooLong", {
  world: Schema.String,
  askedMs: Schema.Number,
  mostMs: Schema.Number,
  message: Schema.String,
}) {}

export class TooManyWorlds extends Schema.TaggedError<TooManyWorlds>()("TooManyWorlds", {
  owner: Schema.String,
  live: Schema.Number,
  most: Schema.Number,
  message: Schema.String,
}) {}

/**
 * The limits on private worlds (Aaron, 13 November 2026): a world may live at most 7 days, and an owner may have at
 * most 5 live worlds. Both are declared settings.
 */
export const Limits = Config.all({
  maxLifetime: Config.Duration("WORLD_MAX_LIFETIME").pipe(Config.withDefault(Duration.days(7))),
  maxPerOwner: Config.Int("WORLD_MAX_PER_OWNER").pipe(Config.withDefault(5)),
});

const limit = (step: string, fallback: Duration.Duration) =>
  Config.Duration(`WORLD_TIMEOUT_${step.toUpperCase()}`).pipe(Config.withDefault(fallback));

/** The declared timeout of every step. Each can be set in the environment, as WORLD_TIMEOUT_<STEP>. */
export const Timeouts = Config.all({
  claim: limit("claim", Duration.seconds(45)),
  deploy: limit("deploy", Duration.minutes(4)),
  migrate: limit("migrate", Duration.seconds(45)),
  chain: limit("chain", Duration.minutes(3)),
  fund: limit("fund", Duration.minutes(1)),
  index: limit("index", Duration.minutes(3)),
  core: limit("core", Duration.minutes(1)),
  use: limit("use", Duration.minutes(10)),
  park: limit("park", Duration.minutes(1)),
  destroy: limit("destroy", Duration.minutes(4)),
  release: limit("release", Duration.seconds(45)),
});
export type Timeouts = Config.Success<typeof Timeouts>;
