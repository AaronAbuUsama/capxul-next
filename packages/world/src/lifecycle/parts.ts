// The parts of a deployed world, reached from outside: its door (chain and index), its Core, and its record in the
// shared state. Bringing a world up is waiting, with a limit, until each part answers.
import { Errors } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { BUNDLER_PATH, ENTRY_POINT, TEST_PAYMASTER } from "../bundler/Keys.ts";
import { TEST_USDC } from "../chain/faucet.ts";
import { OPERATOR_TOKEN_ID } from "../core/Core.ts";
import { CORE_HEALTH } from "../core/health.ts";
import { BRANCH_ID } from "../database/Db.ts";
import { query } from "../database/sql.ts";
import { DOOR_TOKEN_ID } from "../door/Door.ts";
import { WorldNotReady } from "../failures.ts";
import { recordedOutput, secretOf } from "../stack/engine.ts";
import { nameOf, stageOf } from "../stack/names.ts";
import { describeFailure } from "./describe.ts";
import type { World } from "./spec.ts";
import { checkName } from "./validate.ts";

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
});
export type WorldOutput = typeof WorldOutput.Type;

/** The world's handle, built from its outputs and from the two secrets kept in its resources' state. */
export const handle = Effect.fn("world.handle")(function* (output: WorldOutput) {
  const token = yield* secretOf(output.world, DOOR_TOKEN_ID, "text");
  const database = yield* secretOf(output.world, BRANCH_ID, "connectionUri");
  const door = `${output.doorUrl}/${Redacted.value(token)}`;
  const operatorToken = yield* secretOf(output.world, OPERATOR_TOKEN_ID, "text");
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

/** An existing world, by name, from the shared state alone. */
export const open = Effect.fn("world.open")(function* (name: string) {
  const checked = yield* checkName(name);
  const output = yield* recordedOutput(stageOf(checked));
  const decoded = yield* Schema.decodeUnknownEffect(WorldOutput)(output).pipe(
    Effect.mapError(() => Errors.WorldNotFound.make({ world: checked })),
  );
  return yield* handle(decoded);
});

type Door = Pick<World, "door">;

/** One call to the world's door, its answer decoded with `schema`. A door that does not answer so is not ready. */
const doorCall = <S extends Schema.Constraint>(
  world: Door,
  part: WorldNotReady["part"],
  request: HttpClientRequest.HttpClientRequest,
  schema: S,
) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(request.pipe(HttpClientRequest.prependUrl(Redacted.value(world.door))));
    if (response.status !== 200) {
      const body = yield* response.text;
      return yield* WorldNotReady.make({ part, message: `HTTP ${response.status}: ${Str.slice(0, 160)(body)}` });
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response);
  }).pipe(
    Effect.mapError((error) =>
      Predicate.isTagged(error, "WorldNotReady")
        ? error
        : WorldNotReady.make({ part, message: describeFailure(error) }),
    ),
    Effect.scoped,
  );

/** One call to the world's door whose answer is text: the chain's saved state. */
const doorText = (world: Door, part: WorldNotReady["part"], request: HttpClientRequest.HttpClientRequest) =>
  HttpClient.execute(request.pipe(HttpClientRequest.prependUrl(Redacted.value(world.door)))).pipe(
    Effect.flatMap((response) => Effect.map(response.text, (body) => ({ status: response.status, body }))),
    Effect.mapError((error) => WorldNotReady.make({ part, message: describeFailure(error) })),
    Effect.flatMap(({ status, body }) =>
      status === 200
        ? Effect.succeed(body)
        : Effect.fail(WorldNotReady.make({ part, message: `HTTP ${status}: ${Str.slice(0, 160)(body)}` })),
    ),
    Effect.scoped,
  );

const RpcAnswer = Schema.Struct({ result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Unknown) });

/** One JSON-RPC call to the world's chain; fails unless the chain gives a result. */
export const rpc = (world: Door, method: string, params: ReadonlyArray<unknown> = []) =>
  doorCall(
    world,
    "chain",
    HttpClientRequest.post("/rpc").pipe(HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", id: 1, method, params })),
    RpcAnswer,
  ).pipe(
    Effect.flatMap((answer) =>
      Predicate.isNullish(answer.result)
        ? Effect.fail(
            WorldNotReady.make({
              part: "chain",
              message: `${method}: ${describeFailure(answer.error ?? "no result")}`,
            }),
          )
        : Effect.succeed(answer.result),
    ),
  );

/** A JSON-RPC result that must be hex text: a block number, a hash, a chain id. */
export const rpcHex = (world: Door, method: string, params: ReadonlyArray<unknown> = []) =>
  rpc(world, method, params).pipe(
    Effect.filterOrFail(Predicate.isString, (result) =>
      WorldNotReady.make({ part: "chain", message: `${method} answered ${describeFailure(result)}, not hex` }),
    ),
  );

const patient = <A, E, R>(attempt: Effect.Effect<A, E, R>) =>
  attempt.pipe(
    Effect.tapError((error) => Effect.logDebug(`not ready: ${describeFailure(error)}`)),
    Effect.retry(Schedule.spaced("2 seconds")),
  );

/**
 * Waits until the chain answers. A new container application answers "Container exited" until its first instance
 * has the image, and a start made in that time is lost, so the call is made again until it holds.
 */
export const chainAnswers = (world: Door) => patient(rpcHex(world, "eth_chainId"));

const Adopted = Schema.Struct({ adopted: Schema.Boolean, bytes: Schema.Finite });

/** Hands the new world the chain state of the world it is made from, before its own chain first starts. */
export const adoptChain = (child: Door, parent: Door) =>
  Effect.gen(function* () {
    const dump = yield* doorText(parent, "fork", HttpClientRequest.get("/chain/dump"));
    const adopted = yield* doorCall(
      child,
      "fork",
      HttpClientRequest.post("/chain/adopt").pipe(HttpClientRequest.bodyText(dump)),
      Adopted,
    );
    return adopted.bytes;
  });

const PartStatus = Schema.Struct({ running: Schema.Boolean });
const IndexStatus = Schema.Struct({
  running: Schema.Boolean,
  ready: Schema.NullOr(Schema.Finite),
  indexed: Schema.NullOr(Schema.String),
});

/** Whether the chain's or the index's container is running now. Never starts either. */
export const isRunning = (world: Door, part: "chain" | "index") =>
  doorCall(world, part, HttpClientRequest.get(`/${part}/status`), PartStatus).pipe(
    Effect.map((status) => status.running),
  );

/** What the index says about itself now. */
export const indexStatus = (world: Door) =>
  doorCall(world, "index", HttpClientRequest.get("/index/status"), IndexStatus);

/** Starts the index and waits until Ponder says its backfill is done. A start that did not hold is made again. */
export const indexReady = (world: Door) =>
  patient(
    Effect.gen(function* () {
      const status = yield* indexStatus(world);
      if (!status.running) yield* doorCall(world, "index", HttpClientRequest.post("/index/start"), Schema.Unknown);
      if (status.ready !== 200)
        return yield* WorldNotReady.make({
          part: "index",
          message: `running ${status.running}, ready ${status.ready ?? "no answer"}`,
        });
      return status.indexed;
    }),
  );

const CoreHealth = Schema.Struct({ world: Schema.String });

/** Waits until the world's Core answers its health check. A new Worker's address answers 404 until it is routed. */
export const coreAnswers = (world: Pick<World, "coreUrl">) =>
  patient(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(`${world.coreUrl}${CORE_HEALTH}`);
      if (response.status !== 200)
        return yield* WorldNotReady.make({ part: "core", message: `Core answered ${response.status}` });
      return yield* HttpClientResponse.schemaBodyJson(CoreHealth)(response);
    }).pipe(Effect.scoped),
  );

/** Saves the chain and stops both containers, so a kept world costs nothing while it waits for its expiry. */
export const stop = (world: Door) =>
  doorCall(world, "index", HttpClientRequest.post("/index/stop"), Schema.Unknown).pipe(
    Effect.andThen(doorCall(world, "chain", HttpClientRequest.post("/chain/stop"), Schema.Unknown)),
    Effect.asVoid,
  );
