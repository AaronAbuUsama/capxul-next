// The names every part of the hub agrees on. Nothing here touches the outside world, and nothing here imports another
// package: the hub's Worker bundles this file.

/** The Alchemy stack of the fleet hub: one stage per hub, each deployed once (src/hub/stack.ts). */
export const HUB_STACK = "CapxulWorldHub";

/** The hub a world is made on when `WORLD_HUB` names none. */
export const DEFAULT_HUB = "fleet";

/** The logical id of the hub's admin token: it registers and forgets worlds (src/door/Door.ts, `/admin`). */
export const ADMIN_TOKEN_ID = "admin-token";

/**
 * How many containers of each kind may run at once on one hub: one chain, one index and one bundler per running
 * world. Cloudflare bills a container only while it runs; this caps what a hub can spend at once.
 */
export const HUB_CAPACITY = 10;

/**
 * Where every world's objects and containers are placed: western Europe, next to the worlds' Neon project
 * (aws-eu-west-2). Ponder and alto talk to the chain on every block and Ponder to the database on every write;
 * with the chain's object where its first caller was (a container in the US), Ponder spent 9 s of its 12 s start on
 * 22 calls to the chain (`records/hub`, f5). A hint only places an object when it is first made.
 */
export const PLACE = { locationHint: "weur" } as const;
export const REGIONS = ["WEUR"];
