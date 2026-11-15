// Every thing in each generated index it needs (docs/roadmap.md, "Facts typed twice", the hubs; step 3.3). A thing is
// a folder under src/things/; the indexes that gather them are written by `pnpm generate` (src/generated/), and
// `pnpm generate:check` fails when one is stale. This test reads the folders themselves as well, loads each file, and
// fails when an index misses what a thing declares. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { Errors, operations, Pipeline, Values } from "../src/index.ts";

const THINGS = fileURLToPath(new URL("../src/things/", import.meta.url));

/** The things' folders that hold `file`, by name. */
const thingsWith = (file: string): ReadonlyArray<string> =>
  Arr.filter(
    Arr.map(
      Arr.filter(readdirSync(THINGS, { withFileTypes: true }), (entry) => entry.isDirectory()),
      (entry) => entry.name,
    ),
    (name) => existsSync(join(THINGS, name, file)),
  );

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Arr.isArray(value);

/** Loads src/things/<thing>/<file> as a module, the same module the indexes import. */
const load = async (thing: string, file: string): Promise<Readonly<Record<string, unknown>>> => {
  const loaded: unknown = await import(new URL(`../src/things/${thing}/${file}`, import.meta.url).href);
  assert.ok(isRecord(loaded), `src/things/${thing}/${file} did not load as a module`);
  return loaded;
};

/** The verbs of a thing: every file of its folder but its own. */
const verbsOf = (thing: string): ReadonlyArray<string> =>
  Arr.filter(
    readdirSync(join(THINGS, thing)),
    (file) => !Arr.contains(["values.ts", "events.ts", "refusals.ts", "lifecycle.ts", "examples.ts"], file),
  );

test("the folders are read: the things this test knows of today are among them", () => {
  const found = thingsWith("refusals.ts");
  for (const name of ["company", "invitation", "board", "budget", "document", "approval", "world", "snapshot"])
    assert.ok(Arr.contains(found, name), `src/things/${name}/refusals.ts was not found`);
});

test("every verb's declaration is in `operations`, under its Rpc's name, with its promises, or is work in `Pipeline.work`", async () => {
  const every: Readonly<Record<string, unknown>> = operations;
  const works: Readonly<Record<string, unknown>> = Pipeline.work;
  let count = 0;
  let workCount = 0;
  for (const thing of thingsWith(".")) {
    for (const verb of verbsOf(thing)) {
      const module = await load(thing, verb);
      const work = Arr.filter(
        Rec.values(module),
        (value) => isRecord(value) && "spans" in value && "budget" in value && !("rpc" in value),
      );
      if (work.length > 0) {
        assert.equal(work.length, 1, `src/things/${thing}/${verb} declares more than one piece of work`);
        const [declared] = work;
        const name = isRecord(declared) ? String(declared["name"]) : "";
        assert.equal(works[name], declared, `${name} of src/things/${thing}/${verb} is not in \`Pipeline.work\``);
        workCount += 1;
        continue;
      }
      const declared = Arr.filter(
        Rec.values(module),
        (value) => isRecord(value) && "rpc" in value && "budget" in value,
      );
      assert.equal(declared.length, 1, `src/things/${thing}/${verb} declares not exactly one operation`);
      const [operation] = declared;
      const rpc: unknown = isRecord(operation) ? operation["rpc"] : undefined;
      const name = (typeof rpc === "function" || isRecord(rpc)) && "_tag" in rpc ? String(rpc._tag) : "";
      assert.equal(every[name], operation, `${name} of src/things/${thing}/${verb} is not in \`operations\``);
      assert.ok(isRecord(module["promises"]), `src/things/${thing}/${verb} exports no \`promises\``);
      count += 1;
    }
  }
  assert.equal(count, Rec.size(operations), "an operation of `operations` is no verb's");
  assert.equal(workCount, Rec.size(Pipeline.work), "a piece of work of `Pipeline.work` is no verb's");
});

test("every thing with a refusals.ts has each of its refusals in `Errors.refusals`", async () => {
  const hub: Readonly<Record<string, unknown>> = Errors.refusals;
  for (const thing of thingsWith("refusals.ts")) {
    const own = (await load(thing, "refusals.ts"))["refusals"];
    assert.ok(isRecord(own), `src/things/${thing}/refusals.ts exports no \`refusals\` record`);
    assert.ok(Rec.size(own) > 0, `src/things/${thing}/refusals.ts's \`refusals\` is empty`);
    for (const [tag, refusal] of Rec.toEntries(own))
      assert.equal(hub[tag], refusal, `${tag} of src/things/${thing}/refusals.ts is not in \`Errors.refusals\``);
  }
});

test("every thing whose values.ts exports `subjects` has each of them among the members of `Values.Subject`", async () => {
  const members: ReadonlyArray<unknown> = Values.Subject.members;
  for (const thing of thingsWith("values.ts")) {
    const own = (await load(thing, "values.ts"))["subjects"];
    if (own === undefined) continue;
    assert.ok(Arr.isArray(own), `src/things/${thing}/values.ts's \`subjects\` is no list`);
    assert.ok(own.length > 0, `src/things/${thing}/values.ts's \`subjects\` is empty`);
    for (const [index, subject] of own.entries())
      assert.ok(
        Arr.some(members, (member) => member === subject),
        `subject ${index} of src/things/${thing}/values.ts is not in \`Values.Subject\``,
      );
  }
});
