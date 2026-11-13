// The parts of a deployed world, reached from outside: its door (chain and index), its Core, and its record in the
// shared state. Bringing a world up is waiting, with a limit, until each part answers.
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { TEST_USDC } from "../chain/faucet.ts";
import { BRANCH_ID } from "../database/Db.ts";
import { query } from "../database/sql.ts";
import { DOOR_TOKEN_ID } from "../door/Door.ts";
import { recordedOutput, secretOf } from "../stack/engine.ts";
import { nameOf, stageOf } from "../stack/names.ts";
import { type World, WorldNotFound, WorldNotReady } from "./spec.ts";

/** What a deployed world's stack outputs hold. No secret is among them. */
export const WorldOutput = Schema.Struct({
  world: Schema.String,
  owner: Schema.String,
  expiresAt: Schema.String,
  forkedFrom: Schema.String,
  coreUrl: Schema.String,
  doorUrl: Schema.String,
  branch: Schema.String,
});
export type WorldOutput = typeof WorldOutput.Type;

/** The world's handle, built from its outputs and from the two secrets kept in its resources' state. */
export const handle = Effect.fn("world.handle")(function* (output: WorldOutput) {
  const token = yield* secretOf(output.world, DOOR_TOKEN_ID, "text");
  const database = yield* secretOf(output.world, BRANCH_ID, "connectionUri");
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
    rpcUrl: Redacted.make(`${door}/rpc`),
    door: Redacted.make(door),
    database,
    sql: (statement, params) => query(database, statement, params),
  };
  return world;
});

/** An existing world, by name, from the shared state alone. */
export const open = Effect.fn("world.open")(function* (name: string) {
  const stage = stageOf(name);
  const output = yield* recordedOutput(stage);
  const decoded = yield* Schema.decodeUnknownEffect(WorldOutput)(output).pipe(
    Effect.mapError(
      () =>
        new WorldNotFound({
          world: stage,
          message: `no deployed world called ${nameOf(stage)} is recorded in the shared state`,
        }),
    ),
  );
  return yield* handle(decoded);
});

const send = (request: HttpClientRequest.HttpClientRequest) =>
  HttpClient.execute(request).pipe(
    Effect.flatMap((response) => Effect.map(response.text, (body) => ({ status: response.status, body }))),
    Effect.scoped,
  );

/** One call to the world's door. */
export const door = (world: Pick<World, "door">, method: "GET" | "POST", path: string, body?: string) =>
  send(
    HttpClientRequest.make(method)(`${Redacted.value(world.door)}${path}`).pipe(
      body === undefined ? (request) => request : HttpClientRequest.bodyText(body, "application/json"),
    ),
  );

const RpcAnswer = Schema.Struct({ result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Unknown) });

/** One JSON-RPC call to the world's chain; fails unless the chain gives a result. */
export const rpc = (world: Pick<World, "door">, method: string, params: ReadonlyArray<unknown> = []) =>
  door(world, "POST", "/rpc", JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })).pipe(
    Effect.flatMap(({ status, body }) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(RpcAnswer))(body).pipe(
        Effect.mapError(
          () => new WorldNotReady({ part: "chain", message: `${method}: HTTP ${status}: ${body.slice(0, 160)}` }),
        ),
      ),
    ),
    Effect.flatMap((answer) =>
      answer.result === undefined || answer.result === null
        ? Effect.fail(
            new WorldNotReady({
              part: "chain",
              message: `${method}: ${JSON.stringify(answer.error ?? "no result")}`.slice(0, 200),
            }),
          )
        : Effect.succeed(answer.result),
    ),
  );

const patient = <A, E, R>(attempt: Effect.Effect<A, E, R>) =>
  attempt.pipe(
    Effect.tapError((error) => Effect.logDebug(`not ready: ${String(error).slice(0, 200)}`)),
    Effect.retry(Schedule.spaced("2 seconds")),
  );

/**
 * Waits until the chain answers. A new container application answers "Container exited" until its first instance
 * has the image, and a start made in that time is lost, so the call is made again until it holds.
 */
export const chainAnswers = (world: Pick<World, "door">) => patient(rpc(world, "eth_chainId"));

/** Hands the new world the chain state of the world it is made from, before its own chain first starts. */
export const adoptChain = (child: Pick<World, "door">, parent: Pick<World, "door">) =>
  Effect.gen(function* () {
    const dump = yield* door(parent, "GET", "/chain/dump");
    if (dump.status !== 200)
      return yield* new WorldNotReady({
        part: "fork",
        message: `the parent's chain gave no state: HTTP ${dump.status}`,
      });
    const adopted = yield* door(child, "POST", "/chain/adopt", dump.body);
    if (adopted.status !== 200)
      return yield* new WorldNotReady({
        part: "fork",
        message: `the new chain refused the state: ${adopted.body.slice(0, 160)}`,
      });
    return dump.body.length;
  });

const IndexStatus = Schema.Struct({
  running: Schema.Boolean,
  ready: Schema.NullOr(Schema.Number),
  indexed: Schema.NullOr(Schema.String),
});

/** What the index says about itself now. */
export const indexStatus = (world: Pick<World, "door">) =>
  door(world, "GET", "/index/status").pipe(
    Effect.flatMap(({ status, body }) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(IndexStatus))(body).pipe(
        Effect.mapError(
          () => new WorldNotReady({ part: "index", message: `status: HTTP ${status}: ${body.slice(0, 160)}` }),
        ),
      ),
    ),
  );

/** Starts the index and waits until Ponder says its backfill is done. A start that did not hold is made again. */
export const indexReady = (world: Pick<World, "door">) =>
  patient(
    Effect.gen(function* () {
      const status = yield* indexStatus(world);
      if (!status.running) yield* door(world, "POST", "/index/start");
      if (status.ready !== 200)
        return yield* new WorldNotReady({ part: "index", message: `running ${status.running}, ready ${status.ready}` });
      return status.indexed;
    }),
  );

/** Waits until the world's Core answers. A new Worker's address answers 404 until Cloudflare has routed it. */
export const coreAnswers = (world: Pick<World, "coreUrl">) =>
  patient(
    send(HttpClientRequest.get(`${world.coreUrl}/`)).pipe(
      Effect.flatMap(({ status, body }) =>
        status === 200
          ? Effect.succeed(body)
          : Effect.fail(new WorldNotReady({ part: "core", message: `Core answered ${status}` })),
      ),
    ),
  );

/** Saves the chain and stops both containers, so a kept world costs nothing while it waits for its expiry. */
export const stop = (world: Pick<World, "door">) =>
  door(world, "POST", "/index/stop").pipe(Effect.andThen(door(world, "POST", "/chain/stop")));
