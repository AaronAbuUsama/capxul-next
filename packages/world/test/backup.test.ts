// A world's backup of its sites (src/site/Saved.ts, `backUp`, which `saveSites` calls with the world's token) against a stand-in site door: the door starts the backup and
// answers `saving` at once, so no call through Cloudflare's edge outlasts its 100 s (HTTP 524, PR #227's CI run
// 43599082569); the save reads the backup's state until it is saved, fails with the door's reason when it failed,
// and still takes a door deployed before, which answered the saved backup itself.
import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { backUp } from "../src/site/Saved.ts";

const SITE = { site: "northwind-tpl.worlds.test", label: "northwind", ms: 4100 };
const answer = (state: string | undefined, more: Record<string, unknown> = {}) => ({
  world: "tpl",
  snapshot: "founded",
  ...(state === undefined ? {} : { state }),
  sites: state === "saving" ? [] : [SITE],
  ...more,
});

/** A door that answers each call in turn with `answers`, and keeps each call's method and path. */
const door = (answers: ReadonlyArray<{ readonly status: number; readonly body: unknown }>) =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<ReadonlyArray<string>>([]);
    const client = HttpClient.make((request) =>
      Effect.gen(function* () {
        const asked = yield* Ref.getAndUpdate(seen, (all) => [
          ...all,
          `${request.method} ${new URL(request.url).pathname}`,
        ]);
        const next = answers[Math.min(asked.length, answers.length - 1)] ?? { status: 500, body: {} };
        return HttpClientResponse.fromWeb(request, Response.json(next.body, { status: next.status }));
      }),
    );
    return { seen, layer: Layer.succeed(HttpClient.HttpClient, client) };
  });

const save = (answers: ReadonlyArray<{ readonly status: number; readonly body: unknown }>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stub = yield* door(answers);
      const exit = yield* backUp("http://door.test", Redacted.make("v1.tpl.0.1"), "founded").pipe(
        Effect.provide(stub.layer),
        Effect.exit,
      );
      return { exit, seen: yield* Ref.get(stub.seen) };
    }),
  );

describe("a world's save of its sites", () => {
  test("starts the backup, then reads its state until it is saved", async () => {
    const { exit, seen } = await save([
      { status: 202, body: answer("saving") },
      { status: 200, body: answer("saving") },
      { status: 200, body: answer("saved") },
    ]);
    assert.ok(Exit.isSuccess(exit), String(exit));
    assert.deepEqual(exit.value, [SITE]);
    assert.deepEqual(seen, ["POST /world/backup", "GET /world/backup/founded", "GET /world/backup/founded"]);
  });

  test("fails with the door's reason when the backup failed", async () => {
    const { exit } = await save([
      { status: 202, body: answer("saving") },
      { status: 200, body: answer("failed", { error: "bench-failed: no space left" }) },
    ]);
    const failed = Exit.isFailure(exit) ? exit.cause : null;
    assert.notEqual(failed, null);
    assert.match(String(failed), /founded: bench-failed: no space left/);
  });

  test("takes a door deployed before, which answered the saved backup itself", async () => {
    const { exit, seen } = await save([{ status: 200, body: answer(undefined) }]);
    assert.ok(Exit.isSuccess(exit), String(exit));
    assert.deepEqual(exit.value, [SITE]);
    assert.deepEqual(seen, ["POST /world/backup"]);
  });
});
