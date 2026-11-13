// The world's one address for its chain and its index. Nothing reaches a container except through here, and only
// with the world's token as the first path segment.
//   POST /rpc             JSON-RPC for people and programs: wakes the chain and keeps it awake
//   POST /quiet-rpc       JSON-RPC for the index: does neither
//   GET  /chain/status
//   POST /chain/stop      save the chain, stop it and the index
//   POST /chain/idle?seconds=N   how long the chain may sit unused before that happens by itself
//   GET  /chain/dump      the chain's whole state, for a world that is being made from this one
//   POST /chain/adopt     take another world's state as this chain's first state
//   POST /index/start     start Ponder against this door's quiet-rpc
//   POST /index/stop
//   GET  /index/status
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Redacted from "effect/Redacted";
import Chain, { WORLD } from "../chain/Chain.ts";
import Indexer from "../index/Indexer.ts";

/** The logical id of the world's token, as the state store keys it. */
export const DOOR_TOKEN_ID = "door-token";

const json = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(body), { status, contentType: "application/json" });

const text = (value: unknown): string => (Redacted.isRedacted(value) ? String(Redacted.value(value)) : String(value));

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

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const env = yield* Cloudflare.WorkerEnvironment;
        const url = new URL(request.url, "http://door");
        const [, given, ...rest] = url.pathname.split("/");
        if (given === undefined || given === "" || given !== text(env["DOOR_TOKEN"])) return json({ error: "not found" }, 404);
        const chain = chains.getByName(WORLD);
        const indexer = indexers.getByName(WORLD);
        const route = `${request.method} /${rest.join("/")}`;
        if (route === "POST /rpc") {
          return HttpServerResponse.text(yield* chain.rpc(yield* request.text), { contentType: "application/json" });
        }
        if (route === "POST /quiet-rpc") {
          return HttpServerResponse.text(yield* chain.quietRpc(yield* request.text), { contentType: "application/json" });
        }
        if (route === "GET /chain/status") return json(yield* chain.status());
        if (route === "POST /chain/stop") return json(yield* chain.stop());
        if (route === "POST /chain/idle") {
          yield* chain.setIdle(Number(url.searchParams.get("seconds") ?? "600"));
          return json(yield* chain.status());
        }
        if (route === "GET /chain/dump") return HttpServerResponse.text(yield* chain.dump());
        if (route === "POST /chain/adopt") return json(yield* chain.adopt(yield* request.text));
        if (route === "POST /index/start") {
          return json(yield* indexer.start(`https://${request.headers["host"]}/${given}/quiet-rpc`));
        }
        if (route === "POST /index/stop") return json(yield* indexer.stop());
        if (route === "GET /index/status") return json(yield* indexer.status());
        return json({ error: "no such route", route }, 404);
      }).pipe(
        Effect.catch((error) => Effect.succeed(json({ error }, "step" in error && error.step === "asleep" ? 503 : 502))),
      ),
    };
  }),
) {}
