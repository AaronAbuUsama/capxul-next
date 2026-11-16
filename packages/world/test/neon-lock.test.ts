// Neon's lock on the project (src/parts/database/neon.ts): a request it refuses with 423 is sent again after a wait
// that is its own span, `world.create.branch.locked`, so a run's record shows the wait; and this process runs at most
// two branch operations at once.
import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import { World } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Tracer from "effect/Tracer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { deleteBranch, neon } from "../src/parts/database/neon.ts";

/** Neon's API as a stand-in: refuses the first `locked` requests with 423, then answers `{}` after `delayMs`. */
const standIn = (locked: number, delayMs: number, status = 200) => {
  const seen = { requests: 0, inFlight: 0, mostInFlight: 0 };
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      seen.requests += 1;
      seen.inFlight += 1;
      seen.mostInFlight = Math.max(seen.mostInFlight, seen.inFlight);
      yield* Effect.sleep(`${delayMs} millis`);
      seen.inFlight -= 1;
      const answer =
        seen.requests <= locked
          ? new Response("project is locked", { status: 423 })
          : status === 200
            ? Response.json({})
            : new Response("", { status });
      return HttpClientResponse.fromWeb(request, answer);
    }),
  );
  return { seen, client };
};

/** Runs `effect` against the stand-in, keeping the name of every span it makes. */
const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>, client: HttpClient.HttpClient) => {
  const spans: Array<string> = [];
  const tracer = Tracer.make({
    span(options) {
      spans.push(options.name);
      return new Tracer.NativeSpan(options);
    },
  });
  return Effect.runPromiseExit(
    effect.pipe(
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord({ NEON_API_KEY: "neon" })),
      Effect.provideService(Tracer.Tracer, tracer),
    ),
  ).then((exit) => ({ exit, spans }));
};

const LOCKED_SPAN = World.create.spans.branchLocked.name;

describe("Neon's lock", () => {
  test("a request refused twice for the lock is sent a third time, each wait its own span", async () => {
    const { seen, client } = standIn(2, 0);
    const { exit, spans } = await run(neon(HttpClientRequest.get("https://neon.test/projects/p")), client);
    assert.ok(Exit.isSuccess(exit), String(exit));
    assert.equal(seen.requests, 3);
    assert.equal(Arr.filter(spans, (name) => name === LOCKED_SPAN).length, 2);
  });
  test("a request Neon answers at once makes no wait", async () => {
    const { seen, client } = standIn(0, 0);
    const { exit, spans } = await run(neon(HttpClientRequest.get("https://neon.test/projects/p")), client);
    assert.ok(Exit.isSuccess(exit), String(exit));
    assert.equal(seen.requests, 1);
    assert.ok(!spans.includes(LOCKED_SPAN));
  });
  test("five branch operations at once reach Neon at most two at a time", async () => {
    const { seen, client } = standIn(0, 30, 404);
    const deletes = Effect.all(
      Arr.makeBy(5, (at) => deleteBranch("p", `br-${at}`)),
      { concurrency: "unbounded" },
    );
    const { exit } = await run(deletes, client);
    assert.ok(Exit.isSuccess(exit), String(exit));
    assert.equal(seen.requests, 5);
    assert.equal(seen.mostInFlight, 2);
  });
});
