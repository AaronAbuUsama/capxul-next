// Each capxul rule, run by oxlint's own RuleTester on code it must pass and code it must refuse.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { RuleTester } from "oxlint/plugins-dev";
import { blueprintOwnsNames } from "../src/rules/blueprint-owns-names.ts";
import { declaredSteps } from "../src/rules/declared-steps.ts";
import { effectOnly } from "../src/rules/effect-only.ts";
import { importDoor } from "../src/rules/import-door.ts";
import { noJsonText } from "../src/rules/no-json-text.ts";
import { unmigrated } from "../src/unmigrated.ts";

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

// capxul/declared-steps (roadmap 4.1): Effect.fn named by a declared step, and no top-level function that does work
// without a span. Its edges: a pure helper, a Layer, a constant Effect and a schema are not work.
const OURS = at("packages/core/src/a.ts");
const STEPS_GENERATED = "// Generated by pnpm generate; never edit.\n";
const runnerEntries = { capxul: { entries: { "packages/runner/src/main.ts": "the runner's command line" } } };
const stringName = { message: /named by a string/ };
const noName = { message: /no name/ };
const unspanned = { message: /no span/ };

tester.run("declared-steps", declaredSteps({}), {
  valid: [
    { code: `export const up = Effect.fn(Pipeline.clusterUp.name)(function* () { yield* x; });`, ...OURS },
    { code: `const up = Effect.fn(RUN_SPANS.call.name, { attributes })(function* () {});`, ...OURS },
    { code: `export const add = (a: number, b: number) => a + b;`, ...OURS },
    { code: `export const label = (n: number) => { if (n > 1) return "many"; return "one"; };`, ...OURS },
    { code: `export const Live = Layer.effect(Door, Effect.gen(function* () { return {}; }));`, ...OURS },
    {
      code: `export const live = (u: string) => Layer.effect(Door, Effect.gen(function* () { return u; }));`,
      ...OURS,
    },
    { code: `export const names = Effect.gen(function* () { return yield* Config.string("X"); });`, ...OURS },
    { code: `export const Row = Schema.Struct({ id: Values.Id });`, ...OURS },
    { code: `export const later = (n: number) => Effect.succeed(n).pipe(Effect.delay("1 second"));`, ...OURS },
    {
      code: `export const f = (u: string) => Effect.gen(function* () { return u; }).pipe(Effect.withSpan(Pipeline.siteTake.name));`,
      ...OURS,
    },
    {
      code: `export const f = (u: string) => pipe(Effect.gen(function* () {}), Effect.withSpan(span.name));`,
      ...OURS,
    },
    { code: `export const o = { f: (u: string) => Effect.gen(function* () { return u; }) };`, ...OURS },
    { code: `export const f = () => { const g = () => Effect.gen(function* () {}); return 1; };`, ...OURS },
    { code: `const f = Effect.fn("x")(function* () {});`, ...at("packages/runner/src/checks/a.ts") },
    { code: `const f = Effect.fn("x")(function* () {});`, ...at("packages/core/test/a.ts") },
    { code: `const f = Effect.fn("x")(function* () {});`, ...at("packages/world/src/a.test.ts") },
    { code: `const f = Effect.fn("x")(function* () {});`, ...at("packages/scenarios/src/a.ts") },
    {
      code: `const f = Effect.fn("x")(function* () {});`,
      ...at("packages/runner/src/main.ts"),
      settings: runnerEntries,
    },
    { code: `${STEPS_GENERATED}const f = Effect.fn("x")(function* () {});`, ...OURS },
    { code: `const s = Effect.gen(function* () {}).pipe(Effect.withSpan("postgres"));`, ...OURS },
  ],
  invalid: [
    { code: `export const up = Effect.fn("cluster.up")(function* () {});`, ...OURS, errors: [stringName] },
    {
      code: "const up = Effect.fn(`runner.${part}`)(function* () {});",
      ...at("packages/runner/src/a.ts"),
      errors: [stringName],
    },
    {
      code: `const g = () => Effect.gen(function* () { return yield* Effect.fn("inner")(h)(); });`,
      ...OURS,
      errors: [unspanned, stringName],
    },
    { code: `export const up = Effect.fn(function* () {});`, ...at("packages/world/src/a.ts"), errors: [noName] },
    {
      code: `export const up = (u: string) => Effect.gen(function* () { return u; });`,
      ...OURS,
      errors: [unspanned],
    },
    {
      code: `const up = (u: string) => Effect.gen(function* () { return u; });`,
      ...at("packages/platform/src/a.ts"),
      errors: [unspanned],
    },
    {
      code: `export function up(u: string) { return Effect.gen(function* () { return u; }); }`,
      ...OURS,
      errors: [unspanned],
    },
    {
      code: `export const up = (u: string) => { if (u) return Effect.succeed(1); return Effect.gen(function* () {}); };`,
      ...OURS,
      errors: [unspanned],
    },
    {
      code: `export const up = (u: string) => Effect.gen(function* () {}).pipe(Effect.orDie);`,
      ...OURS,
      errors: [unspanned],
    },
    {
      code: `export const up = (u: string) => pipe(Effect.gen(function* () {}), Effect.retry(s));`,
      ...OURS,
      errors: [unspanned],
    },
    {
      code: `export const up = (u: string) => Effect.scoped(Effect.gen(function* () {}));`,
      ...OURS,
      errors: [unspanned],
    },
    {
      code: `export const up = (u: string) => Effect.gen(function* () {}).pipe(Effect.withSpan("runner.up"));`,
      ...OURS,
      errors: [unspanned],
    },
    { code: `export default (u: string) => Effect.gen(function* () {});`, ...OURS, errors: [unspanned] },
    {
      code: `export const up = Effect.fnUntraced(function* () {});`,
      ...OURS,
      errors: [{ message: /fnUntraced/ }],
    },
    { code: `// A file.\n${STEPS_GENERATED}const f = Effect.fn("x")(function* () {});`, ...OURS, errors: 1 },
  ],
});

tester.run("declared-steps: the ratchet", declaredSteps({ "packages/core/src/a.ts": 1 }), {
  valid: [{ code: `const f = Effect.fn("x")(function* () {});`, ...OURS }],
  invalid: [
    {
      code: `const f = Effect.fn("x")(function* () {}); const g = Effect.fn("y")(function* () {});`,
      ...OURS,
      errors: [{ message: /must not grow/ }, { message: /must not grow/ }],
    },
    { code: `const f = 1;`, ...OURS, errors: [{ message: /lower it to 0/, line: 1 }] },
  ],
});

// The most findings declared-steps' unmigrated list may hold in all: what it found when turned on. It may only fall.
const STEPS_CEILING = 316;
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("declared-steps: its unmigrated list names tracked files, each with a positive whole count, within its ceiling", () => {
  const tracked = new Set(Str.split(execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }), "\0"));
  const list = unmigrated["declared-steps"];
  for (const [path, count] of Rec.toEntries(list)) {
    assert.ok(tracked.has(path), `${path} is not a file git tracks`);
    assert.ok(Number.isInteger(count) && count > 0, `${path}'s count ${String(count)} is not a positive whole number`);
  }
  const total = Arr.reduce(Rec.values(list), 0, (sum, count) => sum + count);
  assert.ok(
    total <= STEPS_CEILING,
    `declared-steps' list holds ${String(total)}, over its ceiling ${String(STEPS_CEILING)}`,
  );
});
