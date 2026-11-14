// The names every part of the hub agrees on. Nothing here touches the outside world, and nothing here imports another
// package: the hub's Worker bundles this file.

/** The Alchemy stack of the fleet hub: one stage per hub, each deployed once (src/hub/stack.ts). */
export const HUB_STACK = "CapxulWorldHub";

/** The hub a world is made on when `WORLD_HUB` names none. */
export const DEFAULT_HUB = "fleet";

/** The logical id of the hub's admin token: it registers and forgets worlds (src/door/Door.ts, `/admin`). */
export const ADMIN_TOKEN_ID = "admin-token";

/**
 * How many worlds one hub admits at once (src/lifecycle/claim.ts, `admit`): each holds at most one chain, one index
 * and one bundler, so this many of each kind can run. A world created on a full hub waits for room, within its
 * declared `admit` timeout, rather than meeting Cloudflare's "Maximum number of running container instances" half-way.
 * 24 is four CI runs at once, each peaking at six worlds (its own, four more of its first operator up to the quota
 * of five, and its second operator's). Cloudflare bills a container only while it runs: a full hub costs at most
 * about $2.62 an hour (README, "Capacity"), and only while every world on it is in use.
 */
export const HUB_CAPACITY = 24;

/**
 * The containers of each kind a hub's application allows beyond its worlds: Cloudflare counts a container as running
 * for some seconds after its world is destroyed (16.4 s measured, records/hub.proof.json), when the next world may
 * already be starting its own. Never billed unless running.
 */
export const HUB_SPARE = 2;

/** Each container application's `maxInstances`. */
export const HUB_INSTANCES = HUB_CAPACITY + HUB_SPARE;

/** What a hub whose record says no capacity (deployed before it was recorded) admits: its applications' old cap. */
export const LEGACY_HUB_CAPACITY = 10;

/**
 * Where every world's objects and containers are placed: western Europe, next to the worlds' Neon project
 * (aws-eu-west-2). Ponder and alto talk to the chain on every block and Ponder to the database on every write;
 * with the chain's object where its first caller was (a container in the US), Ponder spent 9 s of its 12 s start on
 * 22 calls to the chain (`records/hub`, f5). A hint only places an object when it is first made.
 */
export const PLACE = { locationHint: "weur" } as const;
export const REGIONS = ["WEUR"];
