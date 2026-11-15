// A deployed world's handle: what its stage's outputs record and the secrets worked out from them, each secret kept
// for the life of the process under what it was worked out from (src/lifecycle/kept.ts).
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { BUNDLER_PATH, ENTRY_POINT, TEST_PAYMASTER } from "../bundler/Keys.ts";
import { TEST_USDC } from "../chain/faucet.ts";
import { OPERATOR_TOKEN_ID } from "../core/Core.ts";
import { connectionOf, projectId } from "../database/neon.ts";
import { query } from "../database/sql.ts";
import { openHub, worldToken } from "../hub/hub.ts";
import { secretOf } from "../stack/engine.ts";
import { nameOf, PLATFORM } from "../stack/names.ts";
import { kept, remember } from "./kept.ts";
import type { World } from "./spec.ts";

/** What a deployed world's stack outputs hold. No secret is among them. */
export const WorldOutput = Schema.Struct({
  world: Schema.String,
  owner: Schema.String,
  expiresAt: Schema.String,
  forkedFrom: Schema.String,
  coreUrl: Schema.String,
  doorUrl: Schema.String,
  branch: Schema.String,
  /** The platform stage whose bench holds the world's sites, or `none`. */
  bench: Schema.optional(Schema.String),
  /** The fleet hub its chain, index and bundler live on (src/hub), and the expiry its token there was made for. */
  hub: Schema.String,
  registeredUntil: Schema.String,
});
export type WorldOutput = typeof WorldOutput.Type;

/** The world's two secrets: its token on its hub and its database's connection string. */
export interface Secrets {
  readonly token: Redacted.Redacted;
  readonly database: Redacted.Redacted;
}

/** The connection string of a world's branch, asked of Neon once per world and branch. */
export const keptConnection = (stage: string, branch: string) =>
  kept(
    "connection",
    [stage, branch],
    Effect.flatMap(kept("project", [PLATFORM], projectId), (project) => connectionOf(project, branch)),
  );

/** A hub's admin token, read from the hub's state once per hub. */
const keptAdmin = (hub: string) =>
  kept(
    "hubAdmin",
    [hub],
    Effect.map(openHub(hub), (found) => found.admin),
  );

/**
 * The world's handle, built from its outputs and its secrets: the token worked out again under its hub's admin token
 * (src/hub/hub.ts), the connection string asked of Neon and the operator token read from the shared state. A caller
 * that already holds the token and the connection string (a create, a renewal) gives them, and they are kept for the
 * next handle. The three are independent, so they are worked out side by side.
 */
export const handle = Effect.fn("world.handle")(function* (output: WorldOutput, known?: Secrets) {
  const stage = output.world;
  const tokenKey = [stage, output.hub, output.owner, output.registeredUntil];
  const connectionKey = [stage, output.branch];
  if (known !== undefined)
    yield* Effect.all([
      remember("doorToken", tokenKey, known.token),
      remember("connection", connectionKey, known.database),
    ]);
  const { token, database, operatorToken } = yield* Effect.all(
    {
      token:
        known === undefined
          ? kept(
              "doorToken",
              tokenKey,
              Effect.flatMap(keptAdmin(output.hub), (admin) =>
                worldToken({ admin }, { stage, owner: output.owner, expiresAt: output.registeredUntil }),
              ),
            )
          : Effect.succeed(known.token),
      database: known === undefined ? keptConnection(stage, output.branch) : Effect.succeed(known.database),
      operatorToken: kept("operatorToken", [stage, output.branch], secretOf(stage, OPERATOR_TOKEN_ID, "text")),
    },
    { concurrency: 3 },
  );
  const door = `${output.doorUrl}/${Redacted.value(token)}`;
  const world: World = {
    name: nameOf(output.world),
    stage: output.world,
    owner: output.owner,
    expiresAt: output.expiresAt,
    forkedFrom: output.forkedFrom,
    coreUrl: output.coreUrl,
    testUsdc: TEST_USDC,
    funded: [],
    sites: [],
    doorToken: token,
    operatorToken,
    rpcUrl: Redacted.make(`${door}/rpc`),
    bundlerUrl: Redacted.make(`${door}${BUNDLER_PATH}`),
    entryPoint: ENTRY_POINT,
    paymaster: TEST_PAYMASTER,
    door: Redacted.make(door),
    database,
    sql: (statement, params) => query(database, statement, params),
  };
  return world;
});
