// The hub's door (src/things/cluster): the one address of every world's chain, index and bundler on the hub. Nothing reaches a
// container except through here.
//
// A world's routes start with its token, `<stage>.<secret>` (src/things/cluster/registration.ts); the world's chain object checks
// the secret and the world's expiry first (`admit`), so a caller reaches a world exactly as it reached a world's own
// door before the hub, at `<door>/<token>/rpc`:
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
//   DELETE /chain/snapshot/<name> forget the state a snapshot saved, once the snapshot is deleted
//   POST /chain/reset/<name>      rewind the chain to the state a snapshot saved (src/things/world/reset.ts)
//   GET  /chain/time      the chain's time (its pending block's) and the host's, read together next to anvil
//   POST /chain/mine-at   mine the next block at the world's time (body: worldMs and the host time it was read at)
//   POST /index/start     start Ponder against this door's quiet-rpc; the body, once, is the world's database
//   POST /index/stop      SIGTERM, so Ponder lets go of its schema lock
//   POST /index/resume    start Ponder again as it was last started, without waiting for it
//   GET  /index/status
// The hub's own routes start with `admin/<admin token>`:
//   GET  /worlds                   the worlds the hub holds (its ledger)
//   POST /worlds/<stage>           register a world (body: its Registration)
//   POST /worlds/<stage>/forget    remove everything of a world from the hub
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { HttpServerRequest, schemaBodyJson } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import Bundler from "../bundler/Bundler.ts";
import Chain from "../chain/Chain.ts";
import { ChainState } from "../chain/ChainState.ts";
import { ADMIN_TOKEN_ID, PLACE } from "../../things/cluster/values.ts";
import {
  LEDGER_PREFIX,
  Registration,
  snapshotKey,
  splitToken,
  STAGE_PATTERN,
} from "../../things/cluster/registration.ts";
import Indexer from "../indexer/Indexer.ts";
import { describeFailure } from "../../common/describe.ts";

const DEFAULT_IDLE_SECONDS = 600;
const MineAt = Schema.Struct({ worldMs: Schema.Finite, atHostMs: Schema.NullOr(Schema.Finite) });
const SNAPSHOT_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}$/;

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });
const rpcAnswer = (body: string) => HttpServerResponse.text(body, { contentType: "application/json" });

/** A secret as the Worker's environment holds it: a secret binding, which may arrive wrapped or as plain text. */
const secretOf = (value: unknown): string | undefined => {
  const inner = Redacted.isRedacted(value) ? Redacted.value(value) : value;
  return Predicate.isString(inner) && Str.isNonEmpty(inner) ? inner : undefined;
};

const idleSecondsOf = (given: string | null): number => {
  const seconds = given === null ? Number.NaN : Number(given);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : DEFAULT_IDLE_SECONDS;
};

/** How a failure answers: a world that is not this token's is not found; a sleeping chain is unavailable. */
const statusOf = (error: unknown): number => {
  if (!Predicate.hasProperty(error, "step")) return 502;
  if (error.step === "world") return 404;
  return error.step === "asleep" ? 503 : 502;
};

export default class Door extends Cloudflare.Worker<Door>()(
  "Door",
  Effect.gen(function* () {
    // Minted once when the hub is deployed and kept in the hub's state; bound to the Worker as a secret.
    const admin = yield* Alchemy.Random(ADMIN_TOKEN_ID, { bytes: 24 });
    return { main: import.meta.url, observability: { enabled: true }, env: { ADMIN_TOKEN: admin.text } };
  }),
  Effect.gen(function* () {
    const chains = yield* Chain;
    const indexers = yield* Indexer;
    const bundlers = yield* Bundler;
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(ChainState);

    /** The hub's own routes, behind its admin token. */
    const hubRoute = (method: string, rest: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const [part, stage = "", action = ""] = rest;
        if (part !== "worlds") return json({ error: "no such route" }, 404);
        if (method === "GET" && stage === "") {
          const listed = yield* bucket.list({ prefix: LEDGER_PREFIX });
          return json({ worlds: Arr.map(listed.objects, (object) => Str.slice(LEDGER_PREFIX.length)(object.key)) });
        }
        if (!STAGE_PATTERN.test(stage)) return json({ error: "no such world" }, 404);
        const chain = chains.getByName(stage, PLACE);
        if (method === "POST" && action === "forget") return json(yield* chain.forget(stage));
        if (method === "POST" && action === "") {
          const registration = yield* schemaBodyJson(Registration);
          if (registration.stage !== stage) return json({ error: "the registration names another world" }, 400);
          return json(yield* chain.register(registration));
        }
        return json({ error: "no such route" }, 404);
      });

    /** A world's routes, once its chain object has admitted the token. */
    const worldRoute = (method: string, rest: ReadonlyArray<string>, token: string, host: string) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const named = splitToken(token);
        if (named === undefined) return json({ error: "not found" }, 404);
        const chain = chains.getByName(named.stage, PLACE);
        yield* chain.admit(named.secret);
        const indexer = indexers.getByName(named.stage, PLACE);
        const bundler = bundlers.getByName(named.stage, PLACE);
        // The index and the bundler reach the chain through this door's public address, on its quiet path.
        const quietRpc = `https://${host}/${token}/quiet-rpc`;
        const [part, action, snapshot = ""] = rest;
        if (part === "chain" && SNAPSHOT_PATTERN.test(snapshot)) {
          if (action === "snapshot" && method === "POST") return json(yield* chain.saveAs(snapshot));
          if (action === "snapshot" && method === "GET")
            return HttpServerResponse.text(yield* chain.snapshot(snapshot));
          if (action === "reset" && method === "POST") return json(yield* chain.resetTo(snapshot));
          if (action === "snapshot" && method === "DELETE") {
            yield* bucket.delete(snapshotKey(named.stage, snapshot));
            return json({ forgot: snapshot });
          }
        }
        switch (`${method} /${Arr.join(rest, "/")}`) {
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
            yield* chain.setIdle(idleSecondsOf(new URL(request.url, "http://door").searchParams.get("seconds")));
            return json(yield* chain.status());
          case "GET /chain/dump":
            return HttpServerResponse.text(yield* chain.dump());
          case "POST /chain/mine-at": {
            const { worldMs, atHostMs } = yield* schemaBodyJson(MineAt);
            return json(yield* chain.mineAt(worldMs, atHostMs));
          }
          case "GET /chain/time":
            return json(yield* chain.time());
          case "POST /chain/adopt":
            return json(yield* chain.adopt(yield* request.text));
          case "POST /index/start": {
            const database = yield* request.text;
            return json(yield* indexer.start(quietRpc, Str.isEmpty(database) ? undefined : database));
          }
          case "POST /index/stop":
            return json(yield* indexer.stop());
          case "POST /index/resume":
            return json(yield* indexer.resume());
          case "GET /index/status":
            return json(yield* indexer.status());
          default:
            return json({ error: "no such route" }, 404);
        }
      });

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const env = yield* Cloudflare.WorkerEnvironment;
        const url = new URL(request.url, "http://door");
        const [, first = "", ...rest] = Str.split(url.pathname, "/");
        const host = pipe(request.headers["host"] ?? "", Str.trim);
        if (first === "admin") {
          const [given = "", ...after] = rest;
          const admin = secretOf(env["ADMIN_TOKEN"]);
          if (admin === undefined || given !== admin) return json({ error: "not found" }, 404);
          return yield* hubRoute(request.method, after);
        }
        return yield* worldRoute(request.method, rest, first, host);
      }).pipe(Effect.catch((error) => Effect.succeed(json({ error: describeFailure(error) }, statusOf(error))))),
    };
    // The R2 binding is a layer that belongs to this Worker's own program, as Alchemy's bindings are written.
    // oxlint-disable-next-line effecttsgo/strict-effect-provide
  }).pipe(Effect.provide(Cloudflare.R2.ReadWriteBucketBinding)),
) {}
