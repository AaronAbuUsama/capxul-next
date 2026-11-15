// Where Core's data lives, and so where Core runs.
//
// Every database Core reaches (its own stage's, src/stack/database.ts, and every world's branch, packages/world's
// src/parts/database/Database.ts) is a Neon project in this region, and the fleet hub's containers sit beside it in
// WEUR. Core's Worker is pinned next to it (Aaron's decision D5, 15 November 2026, docs/design/run-time.md section
// 9: "we need to bring the Cloudflare to Europe instead of keeping it in America"). Left to itself, Cloudflare runs a
// Worker in the colo nearest its caller: GitHub's runners put Core in MSP, IAD and EWR, so each of a run's 2,400
// queries crossed the Atlantic (about 103 ms each), and its world lookups and chain calls with them.

import * as Str from "effect/String";

/** The Neon region of every database Core reaches: London. */
export const DATABASE_REGION = "aws-eu-west-2";

/**
 * Core's Worker placement: a region placement hint naming its database's cloud region, so Cloudflare runs its fetch
 * handler (every door Core serves) in the data centre with the lowest latency to that region, with no traffic
 * analysis. Smart Placement is not used: it moves a Worker only after enough traffic from several locations, and a
 * world lives for minutes. Neon writes a region `aws-eu-west-2`;
 * Cloudflare wants `provider:region`, `aws:eu-west-2`.
 */
export const CORE_PLACEMENT = { region: Str.replace("-", ":")(DATABASE_REGION) };
