// A long call to a bench's site door (src/things/site/client.ts, `doorJob`): it asks for a job, follows a 202 to its end, asks
// again through an error page of Cloudflare's edge, reads a job's refusal as the call's own, and works unchanged
// with a door from before jobs, which answers when done. The door here is a stand-in that scripts each answer;
// packages/platform's door/tests/test_jobs.py and records/capacity prove the real door.
import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { doorJob } from "../src/things/site/client.ts";

const DOOR = "https://bench-door.test";
const Claimed = Schema.Struct({ sites: Schema.Array(Schema.Struct({ site: Schema.String })), ms: Schema.Finite });
const CLAIMED = { sites: [{ site: "northwind-wa.pool.test" }], ms: 41000 };

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly prefer: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const edge524 = () =>
  new Response("<html><title>bench-door.test | 524: A timeout occurred</title></html>", {
    status: 524,
    headers: { "content-type": "text/html" },
  });

const run = (answers: Array<() => Response>) =>
  Effect.gen(function* () {
    const seen: Array<Seen> = [];
    const client = HttpClient.make((request) =>
      HttpClientRequest.toWeb(request).pipe(
        Effect.map((web) => {
          const url = new URL(web.url);
          seen.push({ method: web.method, path: url.pathname, prefer: web.headers.get("prefer") });
          return HttpClientResponse.fromWeb(
            request,
            (answers.shift() ?? (() => json({ refused: "none left" }, 500)))(),
          );
        }),
        Effect.orDie,
      ),
    );
    const exit = yield* Effect.exit(
      doorJob(
        DOOR,
        Redacted.make("v1.wa.3.1999999999.sig"),
        HttpClientRequest.post("/world/claim").pipe(HttpClientRequest.bodyJsonUnsafe({ template: "t" })),
        Claimed,
      ).pipe(Effect.provideService(HttpClient.HttpClient, client)),
    );
    return { exit, seen };
  }).pipe(Effect.runPromise);

const refusal = () => json({ refused: "point-site-missing", detail: "northwind-wa.pool.test" }, 409);
const failureOf = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? String(exit.cause) : "succeeded");

const running = () => json({ job: "abc123", state: "running", what: "POST /world/claim", running_ms: 20000 }, 202);

describe("a long call to the site door", () => {
  test("asks for a job, and follows a 202 to the call's own answer", async () => {
    const { exit, seen } = await run([running, running, () => json(CLAIMED)]);
    assert.deepEqual(Exit.isSuccess(exit) && exit.value, CLAIMED);
    assert.deepEqual(
      Arr.map(seen, (each) => `${each.method} ${each.path}`),
      ["POST /world/claim", "GET /world/jobs/abc123", "GET /world/jobs/abc123"],
    );
    assert.equal(seen[0]?.prefer, "respond-async");
  });

  test("works unchanged with a door from before jobs, which answers when done", async () => {
    const { exit, seen } = await run([() => json(CLAIMED)]);
    assert.deepEqual(Exit.isSuccess(exit) && exit.value, CLAIMED);
    assert.equal(seen.length, 1);
  });

  test("asks again when a poll meets an error page of Cloudflare's edge", async () => {
    const { exit } = await run([running, edge524, () => json(CLAIMED)]);
    assert.deepEqual(Exit.isSuccess(exit) && exit.value, CLAIMED);
  });

  test("reads a job's refusal as the call's own, its code in the message", async () => {
    const { exit } = await run([running, refusal]);
    assert.match(failureOf(exit), /HTTP 409: .*point-site-missing/);
  });

  test("never sends the call itself twice: a 524 on the call fails it", async () => {
    const { exit, seen } = await run([edge524]);
    assert.match(failureOf(exit), /524/);
    assert.equal(seen.length, 1);
  });
});
