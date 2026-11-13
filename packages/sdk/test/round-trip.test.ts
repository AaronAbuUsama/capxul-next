// Every blueprint operation through the SDK and over HTTP to a door served in this process: its typed refusal or
// its success comes back, the credential and the person go with it, and each call leaves a caller-side span named
// after its operation whose trace the server received.
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { Errors, operations, type OperationName } from "@capxul/blueprint";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Sdk from "../src/door.ts";

const TOKEN = "door-token-1";

const served = (answer: Sdk.TestDoor.Answer) =>
  Sdk.TestDoor.serve({ token: TOKEN, answer }).pipe(
    Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })),
  );

const doors = (token: string) =>
  Layer.unwrap(
    Effect.map(Sdk.TestDoor.urls, (urls) =>
      Layer.merge(
        Sdk.platformDoor({ url: urls.platform, token: Redacted.make(token) }),
        Sdk.worldDoor({ url: urls.world, token: Redacted.make(token) }),
      ),
    ),
  ).pipe(Layer.provide(FetchHttpClient.layer));

const run = <A, E>(
  answer: Sdk.TestDoor.Answer,
  program: (client: Sdk.Client) => Effect.Effect<A, E, Sdk.TestDoor.Calls>,
  token = TOKEN,
) =>
  Effect.runPromise(
    Effect.flatMap(Sdk.make, program).pipe(Effect.provide(doors(token).pipe(Layer.provideMerge(served(answer))))),
  );

const names = Sdk.names;
const firstExample = (name: OperationName) => {
  const example = operations[name].examples[0];
  assert.ok(example, `${name} declares no example`);
  return example;
};

test("every operation comes back as its typed NotImplemented refusal from empty handlers", async () => {
  const exits = await run("not-implemented", (client) =>
    Effect.forEach(names, (name) => Effect.exit(Sdk.callByName(client, name, firstExample(name).payload))),
  );
  Arr.forEach(Arr.zip(names, exits), ([name, exit]) => {
    assert.ok(Exit.isFailure(exit), `${name} succeeded`);
    const error = Exit.findErrorOption(exit);
    assert.ok(error._tag === "Some", `${name} died instead of refusing`);
    const refusal = error.value;
    assert.ok(Schema.is(Errors.NotImplemented)(refusal), `${name} refused with ${String(refusal)}`);
    assert.equal(refusal.operation, name);
  });
});

test("every operation's declared success comes back decoded as its type", async () => {
  const exits = await run("examples", (client) =>
    Effect.forEach(names, (name) => Effect.exit(Sdk.callByName(client, name, firstExample(name).payload))),
  );
  Arr.forEach(Arr.zip(names, exits), ([name, exit]) => {
    assert.ok(Exit.isSuccess(exit), `${name} failed: ${String(exit)}`);
    assert.deepStrictEqual(exit.value, firstExample(name).success, name);
  });
});

test("the typed call answers with the operation's own refusal type", async () => {
  const refused = await run("not-implemented", (client) =>
    Effect.flip(client["world.show"]({ world: "town" })).pipe(
      Effect.map((error) => (error._tag === "NotImplemented" ? error.operation : error._tag)),
    ),
  );
  assert.equal(refused, "world.show");
});

test("a wrong or missing credential is refused with NotSignedIn on both groups", async () => {
  const reasons = await run(
    "examples",
    (client) =>
      Effect.all([
        Effect.flip(client["world.show"]({ world: "town" })),
        Effect.flip(client["record.export"]({ from: null, to: null })),
      ]),
    "a-wrong-token",
  );
  for (const error of reasons) {
    assert.ok(Schema.is(Errors.NotSignedIn)(error));
    assert.equal(error.reason, "unknown_caller");
  }
});

test("each call is a caller-side span named after its operation, whose trace and person reach the server", async () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const seen = await run("examples", (client) =>
    Effect.gen(function* () {
      yield* client["world.show"]({ world: "town" });
      yield* client["doc.create"](
        { org: "org_northwind1", doctype: "Supplier", fields: { supplier_name: "Brightside" } },
        { as: "sam" },
      );
      return yield* Ref.get(yield* Sdk.TestDoor.Calls);
    }).pipe(Effect.withTracer(tracer)),
  );
  const ours = Arr.filter(
    spans,
    (span) => span.kind === "client" && (span.name === "world.show" || span.name === "doc.create"),
  );
  assert.deepEqual(
    Arr.map(ours, (span) => span.name),
    ["world.show", "doc.create"],
  );
  for (const span of ours) assert.equal(span.status._tag, "Ended", `${span.name} did not end`);
  assert.deepEqual(
    Arr.map(seen, (call) => call.operation),
    ["world.show", "doc.create"],
  );
  Arr.forEach(Arr.zip(ours, seen), ([span, call]) =>
    assert.equal(call.traceparent, `00-${span.traceId}-${span.spanId}-01`, call.operation),
  );
  assert.deepEqual(
    Arr.map(seen, (call) => call.person),
    [null, "sam"],
  );
});

test("the doors' addresses and credentials can come from Config", async () => {
  const program = Effect.gen(function* () {
    const urls = yield* Sdk.TestDoor.urls;
    const env = {
      CAPXUL_PLATFORM_URL: urls.platform,
      CAPXUL_PLATFORM_TOKEN: TOKEN,
      CAPXUL_DOOR_URL: urls.world,
      CAPXUL_DOOR_TOKEN: TOKEN,
    };
    const fromConfig = Layer.merge(Sdk.platformDoorFromConfig, Sdk.worldDoorFromConfig).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
    );
    // The client lives as long as its doors' layer: it is used inside it.
    return yield* Effect.provide(
      Effect.flatMap(Sdk.make, (client) => client["world.show"]({ world: "town" })),
      fromConfig,
    );
  });
  const shown = await Effect.runPromise(Effect.provide(program, served("examples")));
  assert.equal(shown.world, "town");
});
