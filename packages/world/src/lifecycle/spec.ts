// What a caller says about the world it wants, what it is handed back, and the declared settings every world lives
// by: the limits on private worlds and the timeout of every step.
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import type * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import type { Funded, Mint } from "../chain/faucet.ts";
import type { query } from "../database/sql.ts";
import type { StepName } from "../stack/names.ts";

export interface WorldSpec {
  /** The world's name: lower case letters, digits and dashes, 2 to 15 characters (the blueprint's WorldName). */
  readonly name: string;
  /** Who the world belongs to (the blueprint's OperatorName). */
  readonly owner: string;
  /** How long the world may exist. Past this, Neon deletes its branch by itself and the sweeper deletes the rest. */
  readonly lifetime: Duration.Duration;
  /** Make the world from another: its database is a copy-on-write fork of that world's, and its chain starts from that world's state. */
  readonly from?: string;
  /**
   * Keep a world whose run did not pass, stopped, for this long, so it can be looked into. Never applies to a
   * passing run. At most `Limits.maxKeep`, and never past the world's own expiry: the sweeper deletes it then.
   */
  readonly keepOnFailure?: Duration.Duration;
  /** The directory of `.sql` files applied to the world's database when it is created. Defaults to Core's. */
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
  readonly funded: ReadonlyArray<Funded>;
  /** The chain's JSON-RPC address. It carries the world's token, so it is a secret. */
  readonly rpcUrl: Redacted.Redacted;
  /** The door's address with the world's token: the chain's and the index's controls live under it. */
  readonly door: Redacted.Redacted;
  /** The database's connection string, for a driver. Prefer `sql`. */
  readonly database: Redacted.Redacted;
  /** One statement on the world's database, over HTTPS. */
  readonly sql: (statement: string, params?: ReadonlyArray<unknown>) => ReturnType<typeof query>;
}

/**
 * The limits on private worlds (Aaron, 13 November 2026): a world may live at most 7 days, and an owner may have at
 * most 5 live worlds. A failed world may be kept for at most a day. Each is a declared setting.
 */
export const Limits = Config.all({
  maxLifetime: Config.Duration("WORLD_MAX_LIFETIME").pipe(Config.withDefault(Duration.days(7))),
  maxPerOwner: Config.Int("WORLD_MAX_PER_OWNER").pipe(Config.withDefault(5)),
  maxKeep: Config.Duration("WORLD_MAX_KEEP").pipe(Config.withDefault(Duration.days(1))),
});

const limit = (step: StepName, fallback: Duration.Duration) =>
  Config.Duration(`WORLD_TIMEOUT_${Str.toUpperCase(step)}`).pipe(Config.withDefault(fallback));

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
