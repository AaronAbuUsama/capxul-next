// Roadmap item 3.9, the command line's grammar (docs/design/blueprint.md, part 12, decision 8, item 1): every
// operation's command is `capxul <thing> <verb>`, as the blueprint's `commands` table names it, never its name split
// at its dots; the command line's own commands (`login`, `logout`, `use`) stand beside them; `argsOf` builds the new
// path; and no payload field takes a flag the command line reserves (`CLI_FLAGS`).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CLI_COMMANDS, CLI_FLAGS, commands, operations, servedBy, Values, type OperationName } from "@capxul/blueprint";
import * as Sdk from "@capxul/sdk";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as SchemaAST from "effect/SchemaAST";
import * as Str from "effect/String";
import type * as Command from "effect/cli/Command";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Cli from "../src/door.ts";
import { envOf, exampleFlags, THRESHOLD_SET, TOKEN, withBench } from "./harness.ts";

/** Every command path beneath `command`, joined by spaces, each with the command at it. */
const paths = (command: Command.Command.Any, prefix: ReadonlyArray<string>): Array<[string, Command.Command.Any]> =>
  Arr.flatMap(command.subcommands, (group) =>
    Arr.flatMap(group.commands, (child) => {
      const path = [...prefix, child.name];
      return [[Arr.join(path, " "), child] as [string, Command.Command.Any], ...paths(child, path)];
    }),
  );

const names = Arr.sort(Rec.keys(operations), Order.String);
const spoken = (name: OperationName) => Arr.join(commands[name], " ");
const dotted = (name: OperationName) => Arr.join(Str.split(name, "."), " ");
const newPaths = new Set(Arr.map(names, spoken));

test("every operation's command is `capxul <thing> <verb>`, as the blueprint's commands table names it", () => {
  const found = new Map(paths(Cli.capxul, []));
  for (const name of names) {
    const command = found.get(spoken(name));
    assert.ok(command !== undefined, `${name}: no command at capxul ${spoken(name)}`);
    assert.equal(command.subcommands.length, 0, `${name}: capxul ${spoken(name)} is a group, not its command`);
  }
});

test("an operation's old dotted path is no longer a command", () => {
  const found = new Set(Arr.map(paths(Cli.capxul, []), ([path]) => path));
  for (const name of names) {
    const old = dotted(name);
    if (newPaths.has(old)) continue;
    assert.ok(!found.has(old), `${name}: capxul ${old} is still a command`);
  }
  assert.ok(!found.has("org threshold set"), "capxul org threshold set is still a command");
});

test("the command line's commands are the operations' and its own (login, logout, use), and nothing else", () => {
  const all = paths(Cli.capxul, []);
  const leaves = Arr.sort(
    Arr.map(
      Arr.filter(all, ([, command]) => command.subcommands.length === 0),
      ([path]) => path,
    ),
    Order.String,
  );
  const expected = Arr.sort([...newPaths, ...Rec.keys(CLI_COMMANDS)], Order.String);
  assert.deepEqual(leaves, expected);
});

test("the old path makes no call: capxul org threshold set is refused before anything is sent", () =>
  withBench("examples", async (bench) => {
    const flags = await exampleFlags(THRESHOLD_SET);
    const ran = await bench.run(["org", "threshold", "set", ...flags], { env: envOf(bench.served) });
    assert.ok(Exit.isFailure(ran.exit), "capxul org threshold set ran");
    assert.deepEqual(await bench.seen(), [], "capxul org threshold set reached the door");
  }));

test("argsOf builds the call's command at its new path", async () => {
  for (const name of names) {
    const example = operations[name].examples[0];
    assert.ok(example, `${name} declares no example`);
    const args = await Effect.runPromise(Cli.argsOf(name, example.payload));
    assert.deepEqual(Arr.take(args, 2), [...commands[name]], `${name}: argsOf gave ${Arr.join(args, " ")}`);
    assert.ok(Str.startsWith("--")(args[2] ?? "--"), `${name}: argsOf put more than its thing and verb first`);
  }
});

/** The SDK's answer to the operation's example, through the env's doors. */
const viaSdk = (platform: string, world: string, name: OperationName) =>
  Effect.runPromise(
    Effect.flatMap(Sdk.make, (client) =>
      Effect.exit(Sdk.callByName(client, name, operations[name].examples[0]?.payload)),
    ).pipe(
      Effect.provide(
        Layer.merge(
          Sdk.platformDoor({ url: platform, token: Redacted.make(TOKEN) }),
          Sdk.worldDoor({ url: world, token: Redacted.make(TOKEN) }),
        ).pipe(Layer.provide(FetchHttpClient.layer)),
      ),
    ),
  );

test("every operation, at its new path, answers through the command line as through the SDK", () =>
  withBench("examples", async (bench) => {
    for (const name of names) {
      const ran = await bench.run([...commands[name], ...(await exampleFlags(name))], { env: envOf(bench.served) });
      assert.equal(ran.lines.length, 1, `${name} printed ${ran.lines.length} lines`);
      const cli = await Effect.runPromise(Cli.readAnswer(name, ran.lines[0] ?? ""));
      const sdk = await viaSdk(bench.served.platform, bench.served.world, name);
      if (Exit.isSuccess(sdk)) assert.deepStrictEqual(cli, { operation: name, outcome: "success", success: sdk.value });
      else
        assert.deepStrictEqual(cli, {
          operation: name,
          outcome: "refusal",
          refusal: sdk.cause.pipe(Cause.findErrorOption, Option.getOrNull),
        });
    }
  }));

/** The type of each field of the operation's payload, by the field's name. */
const fieldTypes = (name: OperationName) => {
  const ast = operations[name].rpc.payloadSchema.ast;
  return SchemaAST.isObjects(ast)
    ? Arr.map(ast.propertySignatures, (signature) => ({ field: String(signature.name), type: signature.type }))
    : [];
};

// A guard on the declarations rather than on the build: it passes today and is not `todo`.
test("no payload field takes a flag its command reserves (CLI_FLAGS, by kind of command)", () => {
  const world: ReadonlyArray<string> = Rec.values(CLI_FLAGS);
  const account: ReadonlyArray<string> = [CLI_FLAGS.json, CLI_FLAGS.input, CLI_FLAGS.operator];
  const taken = Arr.flatMap(names, (name) => {
    const reserved = servedBy(name) === "world" ? world : account;
    return Arr.flatMap(Cli.fieldsOf(name), (field) =>
      reserved.includes(field.flag) ? [`${name} --${field.flag}`] : [],
    );
  });
  assert.deepEqual(taken, [], `payload fields that take a reserved flag: ${Arr.join(taken, ", ")}`);
  const worldFields = Arr.flatMap(names, (name) =>
    servedBy(name) === "platform"
      ? Arr.flatMap(fieldTypes(name), (field) =>
          field.field === CLI_FLAGS.world && field.type !== Values.WorldName.ast ? [name] : [],
        )
      : [],
  );
  assert.deepEqual(
    worldFields,
    [],
    `account commands whose world field is not a WorldName: ${Arr.join(worldFields, ", ")}`,
  );
});
