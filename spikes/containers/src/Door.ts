// The world's one address. Nothing reaches a container except through here, and only with the world's token as the
// first path segment.
//   POST /rpc                       JSON-RPC for people and programs: wakes the chain and keeps it awake
//   POST /quiet-rpc                 JSON-RPC for the indexer: does neither
//   POST /chain/stop                save the chain, stop it and the indexer
//   POST /chain/kill                stop the chain's container without saving, as a crash would (for the proof)
//   POST /chain/idle?seconds=N      how long the chain may sit unused before that happens by itself
//   GET  /chain/status
//   POST /indexer/start?from=BLOCK  start Ponder against this door's quiet-rpc
//   POST /indexer/stop
//   GET  /indexer/status
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Redacted from "effect/Redacted";
import Chain, { WORLD } from "./chain/Chain.ts";
import Indexer from "./indexer/Indexer.ts";

const json = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(body), { status, contentType: "application/json" });

export default class Door extends Cloudflare.Worker<Door>()(
  "Door",
  { main: import.meta.url, observability: { enabled: true } },
  Effect.gen(function* () {
    const chains = yield* Chain;
    const indexers = yield* Indexer;
    const token = yield* Config.Redacted("CT_DOOR_TOKEN");

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://door");
        const [, given, ...rest] = url.pathname.split("/");
        if (given !== Redacted.value(token)) return json({ error: "not found" }, 404);
        const chain = chains.getByName(WORLD);
        const indexer = indexers.getByName(WORLD);
        const route = `${request.method} /${rest.join("/")}`;
        if (route === "POST /rpc") {
          const answer = yield* chain.rpc(yield* request.text);
          return HttpServerResponse.text(answer, { contentType: "application/json" });
        }
        if (route === "POST /quiet-rpc") {
          const answer = yield* chain.quietRpc(yield* request.text);
          return HttpServerResponse.text(answer, { contentType: "application/json" });
        }
        if (route === "POST /indexer/start") {
          const rpcUrl = `https://${request.headers["host"]}/${given}/quiet-rpc`;
          return json(yield* indexer.start({ rpcUrl, startBlock: Number(url.searchParams.get("from") ?? "0") }));
        }
        if (route === "POST /indexer/stop") return json(yield* indexer.stop());
        if (route === "GET /indexer/status") return json(yield* indexer.status());
        if (route === "POST /chain/stop") return json(yield* chain.stop());
        if (route === "POST /chain/kill") {
          yield* chain.kill();
          return json(yield* chain.status());
        }
        if (route === "POST /chain/idle") {
          yield* chain.setIdle(Number(url.searchParams.get("seconds") ?? "600"));
          return json(yield* chain.status());
        }
        if (route === "GET /chain/status") return json(yield* chain.status());
        return json({ error: "no such route", route }, 404);
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(json({ error }, "step" in error && error.step === "asleep" ? 503 : 502)),
        ),
      ),
    };
  }),
) {}
