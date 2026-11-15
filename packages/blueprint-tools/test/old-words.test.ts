// The rename ratchet R15 (roadmap item 3.8): the count of the glossary's old words (src/checks/old-words.ts), on a
// made-up glossary first (a word in a name counts, the same word in a comment or in prose does not; growth fails),
// then on the blueprint's own glossary and the repository. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { glossary } from "../../blueprint/src/index.ts";
import { countFile, countOldWords, grown, type Counts } from "../src/checks/old-words.ts";
import { isRead, wordFiles } from "../src/checks/word-files.ts";
import { code, type Entry, uncounted, words } from "../src/language/glossary.ts";

/** A made-up glossary: the widget becomes the gizmo, the sprocket hub the gear, and the widget-maker's file goes. */
const GLOSSARY: ReadonlyArray<Entry> = [
  { word: "gizmo", meaning: "A part.", replaces: ["widget", code("maker.ts")], scope: "user-facing" },
  { word: "gear", meaning: "A wheel.", replaces: ["sprocket hub", words("cog", ["oak cog"])], scope: "internal" },
  { word: "slot point", meaning: "A place.", replaces: ["point"], scope: "internal" },
  { word: "turn", meaning: "A move.", replaces: [uncounted("step", "kept elsewhere")], scope: "internal" },
];

const count = (path: string, text: string): Counts => countFile(GLOSSARY, { path, text });

test("a word in an identifier counts, in any case and joined any way", () => {
  assert.equal(count("a.ts", "const widget = 1;")["widget"], 1);
  assert.equal(count("a.ts", "const myWidget = makeWidgets(WIDGET_URL);")["widget"], 3);
  assert.equal(count("a.ts", "const sprocketHub = sprocket_hubs;")["sprocket hub"], 2);
});

test("a word inside a longer word, or apart in a name, does not count", () => {
  assert.equal(count("a.ts", "const widgetry = 1; const sprocketAndHub = 2;")["widget"], 0);
  assert.equal(count("a.ts", "const sprocketAndHub = 2;")["sprocket hub"], 0);
});

test("the same word in a comment does not count", () => {
  assert.equal(count("a.ts", "// the widget\n/* a widget */\nconst x = 1;")["widget"], 0);
  assert.equal(count("a.py", "# the widget\nx = 1\n")["widget"], 0);
  assert.equal(count("a.yml", "# the widget\nrun: make\n")["widget"], 0);
});

test("prose in a string does not count; a name in it does", () => {
  assert.equal(count("a.ts", 'fail("the widget broke");')["widget"], 0);
  assert.equal(count("a.ts", 'fail("see widget.make for why");')["widget"], 1);
  assert.equal(count("a.ts", 'const op = "widget.make";')["widget"], 1);
  assert.equal(count("a.json", '{ "description": "a widget", "main": "widget.ts" }')["widget"], 1);
});

test("in Markdown only code counts", () => {
  const text = "The widget is here.\n\nRun `make widget`:\n\n```sh\nmyWidget --fast\n```\n";
  assert.equal(count("README.md", text)["widget"], 2);
});

test("an old word inside an agreed word, or one its glossary keeps, does not count", () => {
  assert.equal(count("a.ts", "const slotPoints = point;")["point"], 1);
  assert.equal(count("a.ts", "const oakCog = cog;")["cog"], 1);
});

test("an old word written as code counts as that exact text, outside comments", () => {
  assert.equal(count("a.ts", 'load("./maker.ts"); // maker.ts\nconst m = "remaker.ts";')["`maker.ts`"], 1);
});

test("other people's names do not count", () => {
  const counts = count("a.ts", 'import * as Rec from "effect/Record"; import "@other/widget";');
  assert.equal(counts["widget"], 0);
});

test("an uncounted old word is never counted", () => {
  assert.deepEqual(Rec.keys(count("a.ts", "const step = 1;")), [
    "widget",
    "`maker.ts`",
    "sprocket hub",
    "cog",
    "point",
  ]);
});

test("an old word with `within` counts only in files under those paths", () => {
  const made: ReadonlyArray<Entry> = [
    { word: "shard", meaning: "A part.", replaces: [words("lane", [], ["packages/runner/"])], scope: "internal" },
  ];
  assert.equal(countFile(made, { path: "packages/runner/src/a.ts", text: "const lanes = 2;" })["lane"], 1);
  assert.equal(countFile(made, { path: "packages/blueprint/src/a.ts", text: "const lanes = 2;" })["lane"], 0);
});

test("an old word spelled as a kept word is not counted in that word's `keptIn`", () => {
  const made: ReadonlyArray<Entry> = [
    { word: "take", meaning: "A move.", replaces: ["claim"], scope: "internal" },
    { word: "claim", meaning: "A Safe's.", replaces: [], scope: "internal", keptIn: ["Claimer.claim", "x.claim"] },
  ];
  const text = 'call("Claimer.claim"); call("x.claim.y"); const claim = take; const claims = myClaimer.claim;';
  // `claim` (in `x.claim.y` and as a constant) and `claims`: two distinct names.
  assert.equal(countFile(made, { path: "a.ts", text })["claim"], 2);
});

test("a `keptIn` excuses only the whole name, never a longer name it starts", () => {
  const made: ReadonlyArray<Entry> = [
    { word: "take", meaning: "A move.", replaces: ["claim"], scope: "internal" },
    { word: "claim", meaning: "A Safe's.", replaces: [], scope: "internal", keptIn: ["capxul.claim"] },
  ];
  assert.equal(countFile(made, { path: "a.ts", text: 'emit("capxul.claim"); emit(capxul.claim);' })["claim"], 0);
  assert.equal(countFile(made, { path: "a.ts", text: 'emit("capxul.claim.devnet");' })["claim"], 1);
  assert.equal(countFile(made, { path: "a.ts", text: "emit(capxul.claims);" })["claim"], 1);
});

test("a package's name written as a package counts nothing; the rest of the token and other names still count", () => {
  assert.equal(count("a.ts", 'import x from "@capxul/widget";')["widget"], 0);
  assert.equal(count("a.ts", 'const y = "@capxul/widget/widget";')["widget"], 1);
  assert.equal(count("a.ts", 'import "../../packages/widget/src/x.ts";')["widget"], 0);
  assert.equal(count("README.md", "See `packages/widget/src/x.ts`.\n")["widget"], 0);
  assert.equal(
    count("package.json", '{ "name": "@capxul/widget", "dependencies": { "@capxul/widget": "1" } }')["widget"],
    0,
  );
  assert.equal(count("a.yml", "run: pnpm --filter @capxul/widget test --widget=local\n")["widget"], 0);
  assert.equal(count("a.ts", "const widgetClient = makeWidget(packagesWidget);")["widget"], 3);
});

test("an entry's exceptions, exact text no writer chooses, do not count; a longer name still does", () => {
  const made: ReadonlyArray<Entry> = [
    {
      word: "gizmo",
      meaning: "A part.",
      replaces: ["widget"],
      scope: "internal",
      exceptions: [
        { text: "widget-db", why: "deployed" },
        { text: "widgetPoints", why: "foreign" },
      ],
    },
  ];
  const text = 'Neon.Project("widget-db"); m.widgetPoints; m.rejectedWidgetPoints; const widgetDb = 1;';
  assert.equal(countFile(made, { path: "a.ts", text })["widget"], 2);
});

test("an import or export specifier counts nothing, whoever's file it names", () => {
  const text = Arr.join(
    [
      'import { a } from "../widget.ts";',
      'import "./widget/setup.ts";',
      'export * from "./widget.ts";',
      'export { b } from "@other-widget/x";',
      'const c = await import("./widget.ts");',
      'const d = "widget.ts";',
    ],
    "\n",
  );
  assert.equal(count("a.ts", text)["widget"], 1);
  assert.equal(count("a.ts", 'import x from "./maker.ts";')["`maker.ts`"], 0);
});

test("a package.json path counts nothing, like a specifier; its other strings still do", () => {
  const text =
    '{ "exports": "./src/widget.ts", "main": "./widget.js", "types": "./widget.d.ts", "bin": { "widget-cli": "x" } }';
  assert.equal(count("packages/x/package.json", text)["widget"], 1);
});

test("Markdown's generated blocks count nothing; code around them still does", () => {
  const text = Arr.join(
    ["Run `widgetA`.", "<!-- generated:list start -->", "- `widgetB`, `widgetC`", "<!-- generated:list end -->", ""],
    "\n",
  );
  assert.equal(count("README.md", text)["widget"], 1);
});

test("an applied migration and its file name count nothing", () => {
  assert.equal(isRead("packages/core/migrations/0009_widget_spans.sql"), false);
  assert.equal(isRead("packages/core/src/queries/widget.sql"), true);
  assert.equal(count("a.ts", 'const file = "0009_widget_spans.sql"; const widgetSql = 1;')["widget"], 1);
});

/** The count of `word` in one file, by the blueprint's own glossary. */
const of = (word: string, text: string): number => countFile(glossary, { path: "a.ts", text })[word] ?? -1;

/** The count of `core` in one file, by the blueprint's own glossary. */
const real = (text: string): number => of("core", text);

test("the blueprint's glossary: packages and deployed names count nothing, a chosen name still counts", () => {
  assert.equal(real('import x from "@capxul/core";'), 0);
  assert.equal(real('const p = "packages/core/src/x.ts";'), 0);
  assert.equal(
    real('yield* Neon.Project("core-db", {}); yield* Cloudflare.Hyperdrive.Connection("core-hyperdrive", {});'),
    0,
  );
  assert.equal(real("const coreClient = 1;"), 1);
  assert.equal(real('import { x } from "../core.ts";'), 0);
  assert.equal(of("point", "metric.dataPoints; m.rejectedDataPoints; metric_data_point; data_point;"), 0);
  assert.equal(of("record", "logs.logRecords; l.rejectedLogRecords; log_record; const stepRecord = 1;"), 1);
  assert.equal(of("platform", 'run("platform.yml"); yield* Alchemy.Stack("CapxulPlatform");'), 0);
});

test("counted in distinct names: a repeated use adds nothing, a new name adds one, a rename lowers", () => {
  const base = [{ path: "a.ts", text: "const widgetToken = 1; useWidget(widgetToken);" }];
  assert.equal(countOldWords(GLOSSARY, base)["widget"], 2);
  const repeated = [...base, { path: "b.ts", text: "useWidget(widgetToken); useWidget(widgetToken);" }];
  assert.equal(countOldWords(GLOSSARY, repeated)["widget"], 2);
  const added = [...base, { path: "b.ts", text: "const widgetKey = 2;" }];
  assert.equal(countOldWords(GLOSSARY, added)["widget"], 3);
  const renamed = [{ path: "a.ts", text: "const gizmoToken = 1; useWidget(gizmoToken);" }];
  assert.equal(countOldWords(GLOSSARY, renamed)["widget"], 1);
  assert.equal(count("a.ts", 'import "x"; load("./maker.ts"); load("./maker.ts");')["`maker.ts`"], 1);
});

test("counts add up across files", () => {
  const files = [
    { path: "a.ts", text: "const widget = 1;" },
    { path: "b.ts", text: "const widgets = 2; // widget" },
    { path: "c.ts", text: "const widgets = 3;" },
  ];
  assert.equal(countOldWords(GLOSSARY, files)["widget"], 2);
});

test("growth fails: a count above its committed count is found, a fall or a new word is not", () => {
  assert.deepEqual(grown({ widget: 2, cog: 1 }, { widget: 3, cog: 0, point: 9 }), [
    { word: "widget", before: 2, now: 3 },
  ]);
  assert.deepEqual(grown({ widget: 2 }, { widget: 2 }), []);
});

test("records, generated files, node_modules, vendored code and Solidity are not read", () => {
  for (const path of [
    "packages/runner/records/run-1/summary.json",
    "packages/blueprint/generated/index.md",
    "packages/x/node_modules/y/index.js",
    "packages/contracts/lib/forge-std/src/Test.sol",
    "packages/contracts/src/Budgets.sol",
    "packages/blueprint/src/glossary.ts",
  ])
    assert.equal(isRead(path), false, path);
  assert.equal(isRead("packages/core/src/main.ts"), true);
});

test("the blueprint's glossary: each agreed word once, each with a meaning of one sentence", () => {
  const agreed = Arr.map(glossary, (entry) => entry.word);
  assert.deepEqual(Arr.dedupe(agreed), agreed);
  for (const entry of glossary) assert.match(entry.meaning, /^[A-Z][^.]*\.$/, entry.word);
});

test("the blueprint's glossary counts on the repository: every counted old word has a count", () => {
  const root = new URL("../../../", import.meta.url);
  const files = wordFiles({
    isFolder: (path) => statSync(new URL(path, root)).isDirectory(),
    names: (folder) => readdirSync(new URL(`${folder}/`, root)),
    text: (file) => readFileSync(new URL(file, root), "utf8"),
  });
  assert.ok(files.length > 0, "no file was read");
  const counts = countOldWords(glossary, files);
  assert.ok(Arr.every(Rec.values(counts), (each) => Number.isInteger(each) && each >= 0));
  assert.ok((counts["core"] ?? 0) > 0, "`core` is written today, so a count of none means nothing was read");
});
