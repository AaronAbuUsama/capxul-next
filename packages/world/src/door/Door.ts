// The world's one address for its chain and its index. Nothing reaches a container except through here, and only
// with the world's token as the first path segment.
//   POST /rpc             JSON-RPC for people and programs: wakes the chain and keeps it awake
//   POST /quiet-rpc       JSON-RPC for the index and the bundler: does neither
//   POST /bundler         JSON-RPC to the bundler: wakes the chain, keeps it awake, starts alto if it is stopped
//   GET  /bundler/status
//   GET  /chain/status
//   POST /chain/stop      stop the bundler and the index, save the chain and stop it
//   POST /chain/idle?seconds=N   how long the chain may sit unused before that happens by itself
//   GET  /chain/dump      the chain's whole state, for a world that is being made from this one
//   POST /chain/adopt     take another world's state as this chain's first state
//   POST /chain/snapshot/<name>   save the chain's whole state now under a snapshot's name
//   GET  /chain/snapshot/<name>   the state a snapshot saved, for a world restored from it
//   POST /index/start     start Ponder against this door's quiet-rpc
//   POST /index/stop
//   GET  /index/status
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import Bundler from "../bundler/Bundler.ts";
import Chain, { WORLD } from "../chain/Chain.ts";
import Indexer from "../index/Indexer.ts";
import { describeFailure } from "../lifecycle/describe.ts";

/** The logical id of the world's token, as the state store keys it. */
export const DOOR_TOKEN_ID = "door-token";

const DEFAULT_IDLE_SECONDS = 600;

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });
const rpcAnswer = (body: string) => HttpServerResponse.text(body, { contentType: "application/json" });

/** The token as the Worker's environment holds it: a secret binding, which may arrive wrapped or as plain text. */
const tokenOf = (value: unknown): string | undefined => {
  const inner = Redacted.isRedacted(value) ? Redacted.value(value) : value;
  return Predicate.isString(inner) ? inner : undefined;
};

const idleSecondsOf = (given: string | null): number => {
  const seconds = given === null ? Number.NaN : Number(given);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : DEFAULT_IDLE_SECONDS;
};

export default class Door extends Cloudflare.Worker<Door>()(
  "Door",
  Effect.gen(function* () {
    // Minted once when the world is created and kept in the stack's state; bound to the Worker as a secret.
    const token = yield* Alchemy.Random(DOOR_TOKEN_ID, { bytes: 16 });
    return { main: import.meta.url, observability: { enabled: true }, env: { DOOR_TOKEN: token.text } };
  }),
  Effect.gen(function* () {
    const chains = yield* Chain;
    const indexers = yield* Indexer;
    const bundlers = yield* Bundler;

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const env = yield* Cloudflare.WorkerEnvironment;
        const url = new URL(request.url, "http://door");
        const [, given = "", ...rest] = Str.split(url.pathname, "/");
        const token = tokenOf(env["DOOR_TOKEN"]);
        if (token === undefined || Str.isEmpty(given) || given !== token) return json({ error: "not found" }, 404);
        const chain = chains.getByName(WORLD);
        const indexer = indexers.getByName(WORLD);
        const bundler = bundlers.getByName(WORLD);
        // The index and the bundler reach the chain through this door's public address, on its quiet path.
        const quietRpc = `https://${pipe(request.headers["host"] ?? "", Str.trim)}/${given}/quiet-rpc`;
        const route = `${request.method} /${Arr.join(rest, "/")}`;
        const [part, action, snapshot = ""] = rest;
        if (part === "chain" && action === "snapshot" && /^[a-z0-9][a-z0-9-]{0,30}$/.test(snapshot)) {
          if (request.method === "POST") return json(yield* chain.saveAs(snapshot));
          if (request.method === "GET") return HttpServerResponse.text(yield* chain.snapshot(snapshot));
        }
        switch (route) {
          case "POST /rpc":
            return rpcAnswer(yield* chain.rpc(yield* request.text));
          case "POST /quiet-rpc":
            return rpcAnswer(yield* chain.quietRpc(yield* request.text));
          case "POST /bundler": {
            const body = yield* request.text;
            yield* chain.awake();
            return rpcAnswer(yield* bundler.rpc(body, quietRpc));
          }
          case "GET /bundler/status":
            return json(yield* bundler.status());
          case "GET /chain/status":
            return json(yield* chain.status());
          case "POST /chain/stop":
            return json(yield* chain.stop());
          case "POST /chain/idle":
            yield* chain.setIdle(idleSecondsOf(url.searchParams.get("seconds")));
            return json(yield* chain.status());
          case "GET /chain/dump":
            return HttpServerResponse.text(yield* chain.dump());
          case "POST /chain/adopt":
            return json(yield* chain.adopt(yield* request.text));
          case "POST /index/start":
            return json(yield* indexer.start(quietRpc));
          case "POST /index/stop":
            return json(yield* indexer.stop());
          case "GET /index/status":
            return json(yield* indexer.status());
          default:
            return json({ error: "no such route", route }, 404);
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            json(
              { error: describeFailure(error) },
              Predicate.hasProperty(error, "step") && error.step === "asleep" ? 503 : 502,
            ),
          ),
        ),
      ),
    };
  }),
) {}
