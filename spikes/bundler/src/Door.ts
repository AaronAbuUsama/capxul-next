// The world's one address. Nothing reaches a container except through here, and only with the world's token as the
// first path segment.
//   POST /rpc                   JSON-RPC to the chain for people and programs: wakes the chain and keeps it awake
//   POST /quiet-rpc             JSON-RPC to the chain for the bundler: does neither
//   POST /bundler               JSON-RPC to the bundler: wakes the chain, keeps it awake, starts alto if it is stopped
//   GET  /bundler/status
//   POST /chain/stop            stop the bundler, save the chain and stop it
//   POST /chain/idle?seconds=N  how long the chain may sit unused before that happens by itself
//   GET  /chain/status
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Redacted from "effect/Redacted";
import Bundler from "./bundler/Bundler.ts";
import Chain, { WORLD } from "./chain/Chain.ts";

const json = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(body), { status, contentType: "application/json" });
const rpcAnswer = (answer: string) => HttpServerResponse.text(answer, { contentType: "application/json" });

export default class Door extends Cloudflare.Worker<Door>()(
  "Door",
  { main: import.meta.url, observability: { enabled: true } },
  Effect.gen(function* () {
    const chains = yield* Chain;
    const bundlers = yield* Bundler;
    const token = yield* Config.Redacted("BD_DOOR_TOKEN");

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://door");
        const [, given, ...rest] = url.pathname.split("/");
        if (given !== Redacted.value(token)) return json({ error: "not found" }, 404);
        const chain = chains.getByName(WORLD);
        const bundler = bundlers.getByName(WORLD);
        const route = `${request.method} /${rest.join("/")}`;
        if (route === "POST /rpc") return rpcAnswer(yield* chain.rpc(yield* request.text));
        if (route === "POST /quiet-rpc") return rpcAnswer(yield* chain.quietRpc(yield* request.text));
        if (route === "POST /bundler") {
          const body = yield* request.text;
          yield* chain.awake();
          // alto reaches the chain the way Ponder does in spikes/containers: through this door's public address.
          return rpcAnswer(yield* bundler.rpc(body, `https://${request.headers["host"]}/${given}/quiet-rpc`));
        }
        if (route === "GET /bundler/status") return json(yield* bundler.status());
        if (route === "POST /chain/stop") return json(yield* chain.stop());
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
