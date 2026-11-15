// Each capxul rule, run by oxlint's own RuleTester on code it must pass and code it must refuse.
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";
import { blueprintOwnsNames } from "../src/rules/blueprint-owns-names.ts";
import { effectOnly } from "../src/rules/effect-only.ts";
import { importDoor } from "../src/rules/import-door.ts";
import { noJsonText } from "../src/rules/no-json-text.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const cwd = "/repo";
const tester = new RuleTester({ cwd, languageOptions: { sourceType: "module" } });
const at = (path: string) => ({ filename: `${cwd}/${path}` });
const entries = { capxul: { entries: { "packages/world/src/main.ts": "the command line's entry" } } };

tester.run("blueprint-owns-names", blueprintOwnsNames, {
  valid: [
    {
      code: `class Gone extends Schema.TaggedError<Gone>()("Gone", {}) {}`,
      ...at("packages/blueprint/src/common/refusals.ts"),
    },
    { code: `const w: StartingWorld = { name: "fresh" };`, ...at("packages/blueprint/src/starting-points/points.ts") },
    {
      code: `import { Gone } from "@capxul/blueprint"; const x = Schema.Struct({});`,
      ...at("packages/world/src/a.ts"),
    },
  ],
  invalid: [
    {
      code: `class Gone extends Schema.TaggedError<Gone>()("Gone", {}) {}`,
      ...at("packages/world/src/a.ts"),
      errors: 1,
    },
    { code: `class Gone extends Data.TaggedError("Gone")<{}> {}`, ...at("packages/world/src/a.ts"), errors: 1 },
    {
      code: `class Made extends Schema.TaggedClass<Made>()("made", {}) {}`,
      ...at("packages/world/src/a.ts"),
      errors: 1,
    },
    { code: `const op = Rpc.make("world.create", {});`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `const w: StartingWorld = { name: "fresh" };`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `const w = { name: "fresh" } satisfies StartingWorld;`, ...at("packages/world/src/a.ts"), errors: 1 },
  ],
});

tester.run("effect-only", effectOnly, {
  valid: [
    {
      code: `const program = Effect.gen(function* () { yield* Effect.log("hi"); });`,
      ...at("packages/world/src/a.ts"),
    },
    { code: `const d = new Date(0);`, ...at("packages/world/src/a.ts") },
    {
      code: `async function main() { await run(); console.log(process.env.X); }`,
      ...at("packages/world/src/main.ts"),
      settings: entries,
    },
    { code: `async function main() { await run(); }`, ...at("packages/frappe-app/capxul/public/js/a.js") },
  ],
  invalid: [
    { code: `async function f() {}`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `const f = async () => 1;`, ...at("packages/world/src/a.ts"), errors: 1 },
    {
      code: `function* f() { const x = yield 1; } const g = async () => { await x; };`,
      ...at("packages/world/src/a.ts"),
      errors: 2,
    },
    { code: `const p = new Promise((resolve) => resolve(1));`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `try { f(); } catch { g(); }`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `throw new Error("no");`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `const key = process.env.KEY;`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `const now = Date.now();`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `const now = new Date();`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `console.log("hi");`, ...at("packages/world/src/a.ts"), errors: 1 },
    {
      code: `console.log("hi");`,
      ...at("packages/world/src/a.ts"),
      settings: { capxul: { entries: { "packages/world/src/a.ts": "" } } },
      errors: [{ message: /settings\.capxul\.entries/ }],
    },
  ],
});

tester.run("import-door", importDoor, {
  valid: [
    { code: `import { x } from "./b.ts";`, ...at("packages/world/src/a.ts") },
    { code: `import { x } from "../../blueprint/src/door.ts";`, ...at("packages/world/src/a.ts") },
    { code: `import { x } from "../../../blueprint/src/index.ts";`, ...at("packages/blueprint-tools/src/checks/a.ts") },
    { code: `import { x } from "@capxul/blueprint";`, ...at("packages/world/src/a.ts") },
    { code: `import { Effect } from "effect";`, ...at("packages/world/src/a.ts") },
    { code: `import { x } from "../errors.ts";`, ...at("packages/blueprint/src/world/a.ts") },
    { code: `import { x } from "@capxul/blueprint-tools";`, ...at("packages/blueprint/src/things/a/b.ts") },
  ],
  invalid: [
    { code: `import { x } from "../../blueprint/src/errors.ts";`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `export * from "../../blueprint/src/values.ts";`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `import { x } from "@capxul/blueprint/src/errors.ts";`, ...at("packages/world/src/a.ts"), errors: 1 },
    {
      code: `import { x } from "../../../blueprint/src/common/values.ts";`,
      ...at("packages/blueprint-tools/src/checks/a.ts"),
      errors: 1,
    },
    {
      code: `const m = import("../../../packages/world/src/stack/engine.ts");`,
      ...at("packages/blueprint/test/a.ts"),
      errors: 1,
    },
  ],
});

tester.run("no-json-text", noJsonText, {
  valid: [
    { code: `const Payload = Schema.Struct({ name: Schema.String });`, ...at("packages/world/src/a.ts") },
    {
      code: `const text = JSON.stringify(record);`,
      ...at("packages/world/src/record.ts"),
      settings: {
        capxul: { jsonEdges: { "packages/world/src/record.ts": "the record is written to a file as JSON" } },
      },
    },
    { code: `const text = JSON.stringify(x);`, ...at("packages/world/src/main.ts"), settings: entries },
    { code: `/** The site's name. */ const Name = Schema.String;`, ...at("packages/world/src/a.ts") },
    {
      code: `/** The world's door: its chain's JSON-RPC is reached here. */ const Door = Schema.String;`,
      ...at("packages/world/src/a.ts"),
    },
  ],
  invalid: [
    { code: `const value = JSON.parse(text);`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `const text = JSON.stringify(value);`, ...at("packages/world/src/a.ts"), errors: 1 },
    { code: `const S = Schema.parseJson(Payload);`, ...at("packages/world/src/a.ts"), errors: 1 },
    {
      code: `/** The answer as JSON text. */ const Answer = Schema.String;`,
      ...at("packages/world/src/a.ts"),
      errors: 1,
    },
    {
      code: `const S = Schema.Struct({ /** JSON of the body */ body: Schema.String });`,
      ...at("packages/world/src/a.ts"),
      errors: 1,
    },
    {
      code: `const S = Schema.String.annotate({ description: "the payload, as JSON" });`,
      ...at("packages/world/src/a.ts"),
      errors: 1,
    },
  ],
});
