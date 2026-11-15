// The world's chain, read through Core's world door at the blueprint's `CHAIN_PATH`
// (packages/blueprint/docs/decisions.md, entry 34): JSON-RPC that answers only `CHAIN_READ_METHODS`, signed in as the
// world door is (the door token, or the owner's token), and carried to the world's own chain door (packages/world) over
// a service binding. It reads and never writes: a method outside the list is answered with JSON-RPC's own error,
// -32601, and never reaches the chain.
import { CHAIN_READ_METHODS, CREDENTIAL_HEADER } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ENV, secretOf } from "./env.ts";

/** What a Worker's service binding offers: Cloudflare's `fetch`, on the bound Worker. */
interface Fetcher {
  readonly fetch: (request: Request) => Promise<Response>;
}

const isFetcher = (value: unknown): value is Fetcher =>
  Predicate.hasProperty(value, "fetch") && Predicate.isFunction(value.fetch);

const Call = Schema.Struct({ id: Schema.optional(Schema.Unknown), method: Schema.String });
const Batch = Schema.Array(Call);
const Body = Schema.Union([Call, Batch]);
const isBatch = Schema.is(Batch);

const allowed: ReadonlyArray<string> = CHAIN_READ_METHODS;

const rpcError = (id: unknown, code: number, message: string, status = 200) =>
  HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });

/** Answers one request at `CHAIN_PATH`. `tokens` are the credentials that act as the world's owner. */
export const chainRead = (env: Record<string, unknown>, tokens: ReadonlyArray<Redacted.Redacted>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const credential = request.headers[CREDENTIAL_HEADER];
    if (!Arr.some(tokens, (token) => credential === `Bearer ${Redacted.value(token)}`))
      return rpcError(null, -32001, "not signed in at this world's door", 401);
    if (request.method !== "POST") return rpcError(null, -32600, "POST a JSON-RPC body", 405);
    const text = yield* request.text;
    const body = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Body)), Effect.option);
    if (Option.isNone(body)) return rpcError(null, -32700, "not a JSON-RPC call");
    const calls: ReadonlyArray<typeof Call.Type> = isBatch(body.value) ? body.value : [body.value];
    const refused = Arr.findFirst(calls, (call) => !Arr.contains(allowed, call.method));
    if (Option.isSome(refused))
      return rpcError(refused.value.id, -32601, `${refused.value.method} is not a read this door answers`);
    const chain = env[ENV.chain];
    const token = secretOf(env, ENV.chainToken);
    if (!isFetcher(chain) || Option.isNone(token)) return rpcError(null, -32002, "this Core has no chain", 503);
    const answer = yield* Effect.tryPromise(() =>
      chain.fetch(
        new Request(`https://chain/${Redacted.value(token.value)}/rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: text,
        }),
      ),
    ).pipe(Effect.flatMap((response) => Effect.tryPromise(() => response.text())));
    return HttpServerResponse.text(answer, { contentType: "application/json" });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(rpcError(null, -32603, Str.slice(0, 300)(`the chain did not answer: ${String(error)}`), 502)),
    ),
  );
