// The bundler's readiness look, as a reset makes it (src/things/world/reset.ts, "bundler answers"): a dropped
// connection is looked at again, a bundler serving another EntryPoint fails at once.
import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { AfterReset, bundlerAnswers } from "../src/parts/bundler/client.ts";
import { ENTRY_POINT } from "../src/parts/bundler/Keys.ts";

const world = { bundlerUrl: Redacted.make("https://door.test/world.token/bundler") };
const OTHER = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

/** A bundler that drops the first `drops` connections, then answers with `served`; counts every request. */
const standIn = (drops: number, served: ReadonlyArray<string>) => {
  const seen = { requests: 0 };
  const client = HttpClient.make((request) => {
    seen.requests += 1;
    return seen.requests <= drops
      ? Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: "connection reset" }),
          }),
        )
      : Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ jsonrpc: "2.0", id: 1, result: served })));
  });
  return { seen, client };
};

const look = (drops: number, served: ReadonlyArray<string>) => {
  const { seen, client } = standIn(drops, served);
  return Effect.runPromiseExit(
    bundlerAnswers(world, AfterReset).pipe(Effect.provideService(HttpClient.HttpClient, client)),
  ).then((exit) => ({ exit, requests: seen.requests }));
};

describe("the reset's bundler look", () => {
  test("two dropped connections, then an answer naming the EntryPoint: the part succeeds on the third look", async () => {
    const { exit, requests } = await look(2, [ENTRY_POINT]);
    assert.deepEqual(Exit.isSuccess(exit) ? exit.value : String(exit.cause), [ENTRY_POINT]);
    assert.equal(requests, 3);
  });
  test("a bundler serving another EntryPoint fails at its first look, without looking again", async () => {
    const { exit, requests } = await look(0, [OTHER]);
    const failure = Exit.isFailure(exit) ? String(exit.cause) : "succeeded";
    assert.match(failure, /BundlerFailed/);
    assert.match(failure, /not 0x/);
    assert.equal(requests, 1);
  });
});
