// The command line is derived from the blueprint: every operation has exactly one command, at the path its name
// spells, and every field of its payload has its own flag.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { operations, servedBy } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as SchemaAST from "effect/SchemaAST";
import type * as Command from "effect/cli/Command";
import * as Cli from "../src/door.ts";

/** Every command path beneath `command`, each with the command at it. */
const paths = (command: Command.Command.Any, prefix: ReadonlyArray<string>): Array<[string, Command.Command.Any]> =>
  Arr.flatMap(command.subcommands, (group) =>
    Arr.flatMap(group.commands, (child) => {
      const path = [...prefix, child.name];
      return [[Arr.join(path, "."), child] as [string, Command.Command.Any], ...paths(child, path)];
    }),
  );

const all = paths(Cli.capxul, []);
const operationNames = Arr.sort(Rec.keys(operations), Order.String);

test("every blueprint operation has a command at the path its name spells", () => {
  const found = new Set(Arr.map(all, ([path]) => path));
  for (const name of operationNames) assert.ok(found.has(name), `no command for ${name}`);
});

test("every command is an operation or a group of them, and every command with no subcommands is an operation", () => {
  for (const [path, command] of all) {
    const isOperation = path in operations;
    const isGroup = command.subcommands.length > 0;
    assert.ok(isOperation || isGroup, `${path} is neither an operation nor a group`);
    if (!isGroup) assert.ok(isOperation, `${path} has no subcommands and is not an operation`);
  }
  const leaves = Arr.filter(all, ([path]) => path in operations);
  assert.deepEqual(
    Arr.sort(
      Arr.map(leaves, ([path]) => path),
      Order.String,
    ),
    operationNames,
  );
});

test("every field of every payload has its own flag, and none takes a reserved name", () => {
  for (const name of Rec.keys(operations)) {
    const ast = operations[name].rpc.payloadSchema.ast;
    const declared = SchemaAST.isObjects(ast) ? Arr.map(ast.propertySignatures, (each) => String(each.name)) : [];
    const fields = Cli.fieldsOf(name);
    assert.deepEqual(
      Arr.map(fields, (field) => field.field),
      declared,
      name,
    );
    const flags = Arr.map(fields, (field) => field.flag);
    assert.equal(Arr.dedupe(flags).length, flags.length, `${name}: two fields share a flag`);
    const reserved: ReadonlyArray<string> =
      servedBy(name) === "platform"
        ? [Cli.RESERVED.input, Cli.RESERVED.operator]
        : [Cli.RESERVED.input, Cli.RESERVED.as, Cli.RESERVED.operator, Cli.RESERVED.at];
    for (const flag of flags) assert.ok(!reserved.includes(flag), `${name}: --${flag} is reserved`);
  }
});

test("a flag's text is its field's JSON value when the field takes it, and the text itself otherwise", () => {
  const [world, , lifetime] = Cli.fieldsOf("world.create");
  assert.ok(world && lifetime);
  assert.equal(Cli.valueOf(world, "town"), "town");
  assert.equal(Cli.valueOf(lifetime, "60"), 60);
  const note = Arr.findFirst(Cli.fieldsOf("org.member.grant"), (field) => field.field === "note");
  assert.ok(note._tag === "Some");
  assert.equal(Cli.valueOf(note.value, "null"), null);
  assert.equal(Cli.valueOf(note.value, "Sam keeps the books"), "Sam keeps the books");
  const name = Arr.findFirst(Cli.fieldsOf("doc.submit"), (field) => field.field === "name");
  assert.ok(name._tag === "Some");
  assert.equal(Cli.valueOf(name.value, "123"), "123");
});
