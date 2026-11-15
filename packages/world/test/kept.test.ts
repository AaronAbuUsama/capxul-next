// What a world's handle is built from is kept for the life of the process (src/lifecycle/kept.ts): a second lookup
// does not call through, and a world whose branch or registration changed, or that was taken down or reset, misses.
//
// The handle runs against an in-memory state store (the hub's admin token, the platform's project and each world's
// operator token) and a stand-in for Neon's API that counts the connection strings it was asked for.
import * as assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { type CreatedResourceState, InMemoryService } from "alchemy/State";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { OPERATOR_TOKEN_ID } from "../src/core/Core.ts";
import { ADMIN_TOKEN_ID, HUB_STACK } from "../src/hub/names.ts";
import { handle, type WorldOutput } from "../src/lifecycle/handle.ts";
import { forgetWorld, kept, KeptHandles, makeKept } from "../src/lifecycle/kept.ts";
import { SharedState } from "../src/stack/engine.ts";
import { PLATFORM, STACK } from "../src/stack/names.ts";

const WORLD = "w-kept";
const FAR = "2099-01-01T00:00:00.000Z";

const output = (changes: Partial<WorldOutput> = {}): WorldOutput => ({
  world: WORLD,
  owner: "ci",
  expiresAt: FAR,
  forkedFrom: "nothing",
  coreUrl: "https://core.test",
  doorUrl: "http://hub.test",
  branch: "br-one",
  hub: "fleet",
  registeredUntil: FAR,
  ...changes,
});

const resource = (fqn: string, text: string): CreatedResourceState => ({
  resourceType: "Test.Resource",
  namespace: undefined,
  fqn,
  logicalId: fqn,
  instanceId: fqn,
  providerVersion: 0,
  status: "created",
  downstream: [],
  bindings: [],
  props: {},
  attr: { text },
});

let resources: Record<string, Record<string, Record<string, CreatedResourceState>>>;
/** Every branch Neon was asked the connection string of. */
let asked: Array<string>;

beforeEach(() => {
  asked = [];
  resources = {
    [STACK]: { [WORLD]: { [OPERATOR_TOKEN_ID]: resource(OPERATOR_TOKEN_ID, "operator-1") } },
    [HUB_STACK]: { fleet: { [ADMIN_TOKEN_ID]: resource(ADMIN_TOKEN_ID, "admin") } },
  };
});

const neon = HttpClient.make((request) =>
  Effect.gen(function* () {
    const web = yield* HttpClientRequest.toWeb(request);
    const branch = new URL(web.url).searchParams.get("branch_id") ?? "none";
    asked.push(branch);
    return HttpClientResponse.fromWeb(
      request,
      Response.json({ uri: `postgresql://owner:secret@${branch}.db.test/neondb` }),
    );
  }).pipe(Effect.orDie),
);

/** Runs `program` with fresh shelves, the state store and the stand-in for Neon. */
const run = <A, E>(program: Effect.Effect<A, E, SharedState | HttpClient.HttpClient>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* InMemoryService(resources, {
        [STACK]: { [PLATFORM]: { projectId: "project" } },
        [HUB_STACK]: { fleet: { hub: "fleet", owner: "ops", expiresAt: FAR, doorUrl: "http://hub.test" } },
      });
      return yield* program.pipe(
        Effect.provideService(SharedState, { store }),
        Effect.provideService(HttpClient.HttpClient, neon),
        Effect.provideService(KeptHandles, makeKept()),
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord({ NEON_API_KEY: "neon" })),
      );
    }),
  );

/** Changes the world's operator token in the state store, as a lookup that called through would see. */
const rotateOperatorToken = Effect.sync(() => {
  const world = resources[STACK]?.[WORLD];
  if (world !== undefined) world[OPERATOR_TOKEN_ID] = resource(OPERATOR_TOKEN_ID, "operator-2");
});

const secrets = (world: Effect.Success<ReturnType<typeof handle>>) => ({
  database: Redacted.value(world.database),
  door: Redacted.value(world.doorToken),
  operator: Redacted.value(world.operatorToken),
});

describe("kept", () => {
  test("a second lookup of a key does not call through", async () => {
    const calls = await run(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);
        const lookup = Effect.as(
          Ref.update(count, (n) => n + 1),
          "project",
        );
        assert.equal(yield* kept("project", ["a"], lookup), "project");
        assert.equal(yield* kept("project", ["a"], lookup), "project");
        yield* kept("project", ["b"], lookup);
        return yield* Ref.get(count);
      }),
    );
    assert.equal(calls, 2);
  });

  test("a lookup that fails keeps nothing: the next one calls through", async () => {
    const calls = await run(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);
        const failing = Effect.andThen(
          Ref.update(count, (n) => n + 1),
          Effect.fail("Neon did not answer"),
        );
        const refused = yield* Effect.exit(kept("project", ["a"], failing));
        assert.equal(refused._tag, "Failure");
        const found = yield* kept(
          "project",
          ["a"],
          Effect.as(
            Ref.update(count, (n) => n + 1),
            "project",
          ),
        );
        assert.equal(found, "project");
        return yield* Ref.get(count);
      }),
    );
    assert.equal(calls, 2);
  });

  test("two lookups of one key at once share one call", async () => {
    const calls = await run(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);
        const slow = Effect.as(
          Effect.andThen(
            Effect.sleep("10 millis"),
            Ref.update(count, (n) => n + 1),
          ),
          "p",
        );
        yield* Effect.all([kept("project", ["a"], slow), kept("project", ["a"], slow)], { concurrency: 2 });
        return yield* Ref.get(count);
      }),
    );
    assert.equal(calls, 1);
  });
});

describe("a world's handle", () => {
  test("a second handle of the same world asks Neon and the state store nothing", async () => {
    const [first, second] = await run(
      Effect.gen(function* () {
        const was = secrets(yield* handle(output()));
        yield* rotateOperatorToken;
        const now = secrets(yield* handle(output()));
        return [was, now] as const;
      }),
    );
    assert.deepEqual(second, first);
    assert.equal(first.operator, "operator-1");
    assert.deepEqual(asked, ["br-one"]);
  });

  test("a world made again on a new branch misses: its connection string and operator token are read again", async () => {
    const [first, second] = await run(
      Effect.gen(function* () {
        const was = secrets(yield* handle(output()));
        yield* rotateOperatorToken;
        const now = secrets(yield* handle(output({ branch: "br-two" })));
        return [was, now] as const;
      }),
    );
    assert.deepEqual(asked, ["br-one", "br-two"]);
    assert.ok(Str.includes("br-two")(second.database));
    assert.equal(second.operator, "operator-2");
    assert.equal(second.door, first.door);
  });

  test("a renewed world misses its door token: it is worked out for its new registration", async () => {
    const [first, second] = await run(
      Effect.gen(function* () {
        const was = secrets(yield* handle(output()));
        const now = secrets(yield* handle(output({ registeredUntil: "2099-02-01T00:00:00.000Z" })));
        return [was, now] as const;
      }),
    );
    assert.notEqual(second.door, first.door);
    assert.equal(second.database, first.database);
    assert.deepEqual(asked, ["br-one"]);
  });

  test("a world taken down or reset is forgotten: its next handle reads everything again", async () => {
    const second = await run(
      Effect.gen(function* () {
        yield* handle(output());
        yield* rotateOperatorToken;
        yield* forgetWorld(WORLD);
        return secrets(yield* handle(output()));
      }),
    );
    assert.equal(second.operator, "operator-2");
    assert.deepEqual(asked, ["br-one", "br-one"]);
  });

  test("a handle given its secrets keeps them: the next one asks Neon nothing", async () => {
    const second = await run(
      Effect.gen(function* () {
        const known = { token: Redacted.make("w-kept.given"), database: Redacted.make("postgresql://given") };
        yield* handle(output(), known);
        return secrets(yield* handle(output()));
      }),
    );
    assert.equal(second.door, "w-kept.given");
    assert.equal(second.database, "postgresql://given");
    assert.deepEqual(asked, []);
  });
});
