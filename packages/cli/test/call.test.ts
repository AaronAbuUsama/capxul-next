// One call made through the command line in this process (`callVia`, src/call.ts) answers exactly what the SDK's
// call answers, against a door served in this process: every operation, with its options, `--operator` and `--at`
// included, and a payload that is not of its schema, which is rejected as the SDK rejects it before anything runs.
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { operations, type CallOptions, type OperationName } from "@capxul/blueprint";
import * as Sdk from "@capxul/sdk";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Cli from "../src/door.ts";

const TOKEN = "door-token-3";

type Served = { readonly platform: string; readonly world: string; readonly chain: string };

const doorsOf = (urls: Served, second: string | null): Cli.Doors => ({
  platform: { url: urls.platform, token: Redacted.make(TOKEN) },
  world: { url: urls.world, token: Redacted.make(TOKEN) },
  secondOperator: second === null ? null : Redacted.make(second),
});

const withDoor = <A>(answer: Sdk.TestDoor.Answer, body: (urls: Served) => Promise<A>) =>
  Effect.runPromise(
    Effect.flatMap(Sdk.TestDoor.urls, (urls) => Effect.promise(() => body(urls))).pipe(
      Effect.provide(
        Sdk.TestDoor.serve({ token: TOKEN, answer }).pipe(
          Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })),
        ),
      ),
    ),
  );

/** The SDK's call, through a client that reaches every door as the runner's does. */
const viaSdk = (urls: Served, second: string | null, name: OperationName, payload: unknown, options: CallOptions) => {
  const doors = Layer.mergeAll(
    Sdk.platformDoor({ url: urls.platform, token: Redacted.make(TOKEN) }),
    Sdk.worldDoor({ url: urls.world, token: Redacted.make(TOKEN) }),
    Sdk.reach({
      platform: urls.platform,
      chain: { url: urls.chain, token: Redacted.make(TOKEN) },
      operators: { first: Redacted.make(TOKEN), second: second === null ? null : Redacted.make(second) },
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
  return Effect.runPromise(
    Effect.flatMap(Sdk.make, (client) => Effect.exit(Sdk.callByName(client, name, payload, options))).pipe(
      Effect.provide(doors),
    ),
  );
};

const viaCli = (urls: Served, second: string | null, name: OperationName, payload: unknown, options: CallOptions) =>
  Effect.runPromiseExit(
    Cli.callVia(doorsOf(urls, second))(name, payload, options).pipe(Effect.provide(FetchHttpClient.layer)),
  );

const example = (name: OperationName) => {
  const first = operations[name].examples[0];
  assert.ok(first, `${name} declares no example`);
  return first.payload;
};

/** What a call answered: its success, its refusal's fields, or that it died. */
const answerOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return { success: exit.value };
  const error = Cause.findErrorOption(exit.cause);
  return Option.isSome(error) ? { refusal: { ...Object(error.value) } } : { died: true };
};

/** Both calls, through the SDK and through the command line, answer the same. */
const same = async (
  urls: Served,
  second: string | null,
  name: OperationName,
  payload: unknown,
  options: CallOptions = {},
) => {
  const sdk = await viaSdk(urls, second, name, payload, options);
  const cli = await viaCli(urls, second, name, payload, options);
  assert.deepStrictEqual(answerOf(cli), answerOf(sdk), `${name} ${JSON.stringify(options)}`);
  return cli;
};

const base = (urls: Served) => Str.replace(Sdk.TestDoor.WORLD_PATH, "")(urls.world);

for (const answer of ["examples", "not-implemented"] as const)
  test(`every operation answers the same through the command line as through the SDK (${answer})`, () =>
    withDoor(answer, async (urls) => {
      for (const name of Sdk.names) await same(urls, null, name, example(name));
    }));

test("--as, --operator and --at reach the door the SDK reaches, signed in as the SDK signs in", () =>
  withDoor("examples", async (urls) => {
    for (const name of Sdk.worldNames) {
      await same(urls, null, name, example(name), { as: "sam" });
      await same(urls, null, name, example(name), { at: base(urls), as: "dana" });
      const unsigned = await same(urls, null, name, example(name), { at: base(urls), operator: "second" });
      assert.ok(Exit.isFailure(unsigned), `${name}: a second operator with no token is not signed in`);
      await same(urls, "another-token", name, example(name), { at: base(urls), operator: "second" });
    }
    for (const name of Sdk.platformNames) {
      await same(urls, null, name, example(name), { operator: "first" });
      await same(urls, TOKEN, name, example(name), { operator: "second" });
      const refused = await same(urls, "another-token", name, example(name), { operator: "second" });
      assert.ok(Exit.isFailure(refused), `${name}: the second operator's wrong token is not signed in`);
    }
  }));

test("a payload that is not of its schema is rejected as the SDK rejects it, and the command line never runs", () =>
  withDoor("examples", async (urls) => {
    const exit = await same(urls, null, "world.create", {
      ...Object(example("world.create")),
      world: "Not A Name",
    });
    assert.ok(Exit.isFailure(exit));
    const args = await Effect.runPromiseExit(Cli.argsOf("doc.submit", { org: 1 }));
    assert.ok(Exit.isFailure(args));
  }));

test("a call's arguments are its command's thing and verb, one flag per field and its options", async () => {
  const args = await Effect.runPromise(
    Cli.argsOf(
      "org.member.grant",
      { org: "org_northwind1", member: "sam", permission: "manage-books", note: "null" },
      { as: "dana", at: "https://w.example" },
    ),
  );
  assert.deepEqual(args, [
    "member",
    "grant",
    "--org=org_northwind1",
    "--member=sam",
    "--permission=manage-books",
    '--note="null"',
    "--as=dana",
    "--at=https://w.example",
  ]);
});
