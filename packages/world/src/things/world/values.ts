// What a caller says about the world it wants, what it is handed back, and the declared settings every world lives
// by: the limits on private worlds and the timeout of every step.
import { World } from "@capxul/blueprint";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import type { Funded, Mint } from "../../parts/chain/faucet.ts";
import type { query } from "../../parts/database/sql.ts";
import type { PlatformFailed, SiteFailed, WorldNotReady } from "../../common/failures.ts";
import type { SharedState } from "../../stack/engine.ts";
import type { StepName } from "../../stack/names.ts";
import type { SiteState } from "../site/bench.ts";

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
   * Make the world from a snapshot of `from` (src/account): its database forks the snapshot's branch, and its chain
   * starts from the chain state the snapshot saved, by its name.
   */
  readonly snapshot?: { readonly branch: string; readonly name: string };
  /**
   * Send everything that makes the world with the chain's clock just after the seed's last block, so the world's
   * own start can be any time after that (src/things/world/cast.ts). For a world made from nothing.
   */
  readonly atSeed?: boolean;
  /**
   * When the world starts, in epoch milliseconds: its chain's first block of its own is mined at this time, after
   * everything that makes the world, the caller's `onChain` included (src/things/world/cast.ts, `mineStart`).
   */
  readonly startAtMs?: number;
  /** The token of the operator who owns the world, which its Core accepts as the owner's (decisions.md, 36). */
  readonly operatorToken?: Redacted.Redacted;
  /**
   * Keep a world whose run did not pass, stopped, for this long, so it can be looked into. Never applies to a
   * passing run. At most `Limits.maxKeep`, and never past the world's own expiry: the sweeper deletes it then.
   */
  readonly keepOnFailure?: Duration.Duration;
  /** The directory of `.sql` files applied to the world's database when it is created. Defaults to Core's. */
  readonly migrations?: string;
  /** Test USDC to mint from the faucet when the world is created: who is funded is the caller's decision (the cast). */
  readonly mint?: ReadonlyArray<Mint>;
  /**
   * The companies whose Frappe sites the world gets on its bench when it is created (`WORLD_BENCH`), each at
   * `<label>-<world>.<domain>`. Left out, none: a site takes about 100 s, and a world with no bench has none.
   */
  readonly companies?: ReadonlyArray<Company>;
  /** The fleet hub the world lives on (src/things/cluster); `WORLD_HUB`, or `fleet`, when left out. */
  readonly hub?: string;
  /**
   * What the caller does on the world's chain while the world is made, beside the bundler and before the index and
   * Core are waited for: the platform's cast (src/account/worlds.ts). It runs after the faucet.
   */
  readonly onChain?: (
    world: Pick<World, "door">,
  ) => Effect.Effect<void, PlatformFailed | WorldNotReady, HttpClient.HttpClient>;
  /**
   * What the caller does once the world's deploy is done (its stack's secrets exist), beside Core's start, the
   * migrations and the index rather than after them, as the create's `site` step: a restore's sites made again from
   * their backup (src/account/snapshots.ts). Its failure fails the create, which takes down what it made, sites
   * included.
   */
  readonly onDeployed?: (stage: string) => Effect.Effect<void, SiteFailed, HttpClient.HttpClient | SharedState>;
  /** The most the use step may take, in place of the declared default. */
  readonly useTimeout?: Duration.Duration;
  /** Where the run's record is written, outside the world. Defaults to the package's records directory. */
  readonly records?: string;
  /** The record's file name, without `.json`. Defaults to the world's name. */
  readonly recordAs?: string;
}

/** A company of the world, and so a site on its bench: its label in the site's address, and its name. */
export interface Company {
  /** 1 to 12 of a-z and 0-9. */
  readonly label: string;
  readonly name: string;
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
  /** The world's company sites, as the bench's site door holds them; empty for a world with no bench. */
  readonly sites: ReadonlyArray<SiteState>;
  /** The world's door token, which Core's world door and its chain reads accept: a secret. */
  readonly doorToken: Redacted.Redacted;
  /**
   * The token the world minted for its owner operator: Core's platform door, and the world's door as its owner
   * (decisions.md, 36). A world the platform made binds its owner's own token instead, and this one is unused.
   */
  readonly operatorToken: Redacted.Redacted;
  /** The chain's JSON-RPC address. It carries the world's token, so it is a secret. */
  readonly rpcUrl: Redacted.Redacted;
  /**
   * The bundler's JSON-RPC address (ERC-4337: eth_sendUserOperation and the rest), beside the chain's under the same
   * door and token, so it is a secret too. A call to it wakes the chain and starts the bundler if either is stopped.
   */
  readonly bundlerUrl: Redacted.Redacted;
  /** The EntryPoint the bundler serves, and the test paymaster that sponsors every UserOperation sent to it. */
  readonly entryPoint: string;
  readonly paymaster: string;
  /** The door's address with the world's token: the chain's and the index's controls live under it. */
  readonly door: Redacted.Redacted;
  /** The database's connection string, for a driver. Prefer `sql`. */
  readonly database: Redacted.Redacted;
  /** One statement on the world's database, over HTTPS. */
  readonly sql: (statement: string, params?: ReadonlyArray<unknown>) => ReturnType<typeof query>;
}

/**
 * The limits on private worlds (Aaron, 13 November 2026): a world may live at most 7 days, and an owner may have at
 * most 5 live worlds, as the blueprint declares them (`WORLD_LIMITS`). A failed world may be kept for at most a day.
 * Each is a declared setting.
 */
export const Limits = Config.all({
  maxLifetime: Config.Duration("WORLD_MAX_LIFETIME").pipe(
    Config.withDefault(Duration.minutes(World.WORLD_LIMITS.lifetimeMinutes)),
  ),
  maxPerOwner: Config.Int("WORLD_MAX_PER_OWNER").pipe(Config.withDefault(World.WORLD_LIMITS.liveWorldsPerOwner)),
  maxKeep: Config.Duration("WORLD_MAX_KEEP").pipe(Config.withDefault(Duration.days(1))),
  /** The most company sites a world may hold on a shared bench: its site token's quota. */
  maxSites: Config.Int("WORLD_MAX_SITES").pipe(Config.withDefault(3)),
});

/** How often a create on a full hub asks again for a place on it (src/things/registry/reserve.ts, `admit`). */
export const AdmitEvery = Config.Duration("WORLD_ADMIT_EVERY").pipe(Config.withDefault(Duration.seconds(10)));

const limit = (step: StepName, fallback: Duration.Duration) =>
  Config.Duration(`WORLD_TIMEOUT_${Str.toUpperCase(step)}`).pipe(Config.withDefault(fallback));

/** The declared timeout of every step. Each can be set in the environment, as WORLD_TIMEOUT_<STEP>. */
// A step that waits on a container holds its Durable Object's patience with a refused start (src/parts/containers/patience.ts)
// and the time the part takes once started; test/patience.test.ts checks that each step's default holds both.
export const Timeouts = Config.all({
  // The name held and a place on the hub (src/things/registry/reserve.ts, `admit`), waiting while the hub is full: a world on a
  // full hub waits for another to go. A CI run's quota-full phase holds five places for about five minutes (docs/cluster.md,
  // "Capacity"), so three such waits fit.
  admit: limit("admit", Duration.minutes(15)),
  claim: limit("claim", Duration.seconds(45)),
  register: limit("register", Duration.seconds(30)),
  branch: limit("branch", Duration.minutes(1)),
  deploy: limit("deploy", Duration.minutes(4)),
  migrate: limit("migrate", Duration.seconds(45)),
  // CHAIN_START, 2 minutes, and a minute for a fork or a restore to copy its source's chain state (up to 46.7 s seen).
  chain: limit("chain", Duration.minutes(3)),
  fund: limit("fund", Duration.minutes(1)),
  // A new container application refuses starts for a while (records/spike-bundler): alto has BUNDLER_START, 4 minutes,
  // inside its Durable Object, and the paymaster's setup comes before.
  bundler: limit("bundler", Duration.minutes(5)),
  // INDEX_START, 4 minutes, for Cloudflare to accept Ponder's start, then a minute for Ponder's own start, twice the
  // slowest of nineteen measured (29.8 s from the accepted start to ready). Was 3 minutes: see records/README.md, "Before the cluster".
  index: limit("index", Duration.minutes(5)),
  core: limit("core", Duration.minutes(1)),
  site: limit("site", Duration.minutes(8)),
  use: limit("use", Duration.minutes(10)),
  park: limit("park", Duration.minutes(1)),
  unsite: limit("unsite", Duration.minutes(3)),
  destroy: limit("destroy", Duration.minutes(4)),
  release: limit("release", Duration.seconds(45)),
});
export type Timeouts = Config.Success<typeof Timeouts>;
