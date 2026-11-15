// The ratchet registry counted (roadmap items 3.6 and 3.11): the counters on made-up registries and lists, `pnpm
// ratchets` failing on a list that grew and passing on one that shrank, `pnpm generate` never raising a count, the
// scorecard's cells; then the blueprint's own registry, its committed counts and its scorecard. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import type { Ratchet } from "../../blueprint/src/index.ts";
import { ratchets } from "../../blueprint/src/index.ts";
import type { Format } from "../src/checks/format.ts";
import { lists, scorecardInputs, tallies } from "../src/checks/ratchet-sources.ts";
import { countsOf, grown, notes, OUTPUTS, settled, tally, type Counts, type Lists } from "../src/checks/ratchets.ts";
import { renderScorecard } from "../src/checks/scorecard.ts";
import { layoutOf } from "../src/index.ts";

const registry: ReadonlyArray<Ratchet> = [
  { id: "R1", name: "Raw", holds: "raw schemas", closes: "3.3", count: "lint:owned-values" },
  { id: "R5", name: "Formats", holds: "operations", closes: "3.5", count: "formats" },
  { id: "R6", name: "Spans", holds: "spans", closes: "4.1", count: "not yet counted", countedBy: "4.1" },
];
const made: Lists = {
  lint: { "owned-values": { "a.ts": 3, "b.ts": 2 } },
  formats: { machine: ["ticket.open"], steps: ["ticket.open", "ticket.close"] },
};

test("each ratchet is counted from its list, and one not yet counted has no count", () => {
  const counted = tally(registry, made);
  assert.deepEqual(
    Arr.map(counted, ({ ratchet, count }) => [ratchet.id, count]),
    [
      ["R1", 5],
      ["R5", 3],
      ["R6", null],
    ],
  );
  assert.deepEqual(counted[0]?.items, ["a.ts: 3", "b.ts: 2"]);
  assert.deepEqual(counted[1]?.items, ["machine: ticket.open", "steps: ticket.open", "steps: ticket.close"]);
  assert.deepEqual(countsOf(counted), { R1: 5, R5: 3 });
});

test("a list that grew fails; one that shrank or held passes, with a note to regenerate", () => {
  const grewBy = tally(registry, { ...made, lint: { "owned-values": { "a.ts": 4, "b.ts": 2 } } });
  assert.equal(grown({ R1: 5, R5: 3 }, grewBy).length, 1);
  assert.match(grown({ R1: 5, R5: 3 }, grewBy)[0] ?? "", /R1 .*grew from 5 to 6/);
  const shrank = tally(registry, { ...made, formats: { machine: [] } });
  assert.deepEqual(grown({ R1: 5, R5: 3 }, shrank), []);
  assert.deepEqual(notes({ R1: 5, R5: 3 }, shrank), [
    "R5 shrank from 3 to 0: run `pnpm generate` and commit its count",
  ]);
  assert.deepEqual(grown({ R1: 5, R5: 3 }, tally(registry, made)), []);
  assert.deepEqual(notes({ R1: 5, R5: 3 }, tally(registry, made)), []);
});

test("generating again lowers a count, never raises one, and takes a newly counted ratchet as it is", () => {
  const counted = tally(registry, made);
  assert.deepEqual(settled({ R1: 9, R5: 3 }, counted), { R1: 5, R5: 3 });
  assert.deepEqual(settled({ R1: 4, R5: 3 }, counted), { R1: 4, R5: 3 });
  assert.deepEqual(settled({ R1: 5 }, counted), { R1: 5, R5: 3 });
  assert.deepEqual(settled({ R1: 5, R5: 3, R6: 2 }, counted), { R1: 5, R5: 3 });
});

/** A made-up verb's file. */
const verb = (name: string, operation: string, stateless: boolean) =>
  `const r = Rpc.make("${operation}", {});\nexport const ${name} = declare({});\nexport const server = "world";\n` +
  `export const promises = {};\n${stateless ? 'export const stateless = "a read";\n' : ""}`;

test("the scorecard marks each thing against each format and ratchet", () => {
  const layout = layoutOf([
    { path: "ticket/lifecycle.ts", text: 'export const Ticket = Machine.make({ name: "ticket" });\n' },
    { path: "ticket/open.ts", text: verb("open", "ticket.open", false) },
    { path: "log/read.ts", text: verb("read", "log.read", true) },
    { path: "note/add.ts", text: verb("add", "note.add", false) },
  ]);
  const machine: Format = {
    missing: (operation) => (operation === "note.add" ? ["moves nothing"] : []),
    unmigrated: ["note.add"],
  };
  const text = renderScorecard({
    layout,
    formats: { machine },
    rawSchemaFiles: ["packages/blueprint/src/things/note/add.ts"],
    provisional: ["ticket.open"],
    tallies: tally(registry, made),
  });
  /** A thing's row, cell by cell: "" first, then the thing, its eight cells, and "" last. */
  const cells = (thing: string): ReadonlyArray<string> => {
    const row = Arr.findFirst(Str.split(text, "\n"), (line) => Str.startsWith(`| [${thing}]`)(line));
    return Arr.map(
      Str.split(
        Option.getOrElse(row, () => ""),
        "|",
      ),
      Str.trim,
    );
  };
  // Thing, lifecycle, full format, raw schemas, names, rows, spans, reached, budgets.
  assert.deepEqual(Arr.take(Arr.drop(cells("ticket"), 2), 3), ["✓", "✓", "✓"]);
  assert.deepEqual(Arr.take(Arr.drop(cells("log"), 2), 3), ["—", "✓", "✓"]);
  assert.deepEqual(Arr.take(Arr.drop(cells("note"), 2), 3), ["✗", "✗", "✗"]);
  assert.equal(cells("ticket")[9], "✗");
  assert.equal(cells("note")[9], "✓");
  assert.equal(cells("note")[5], "not yet measured");
  assert.match(text, /\| R6 Spans \| spans \| not yet counted \(4\.1\) \| 4\.1 \|/);
  assert.match(text, /\| R1 Raw \| raw schemas \| 5 \| 3\.3 \|/);
});

test("the registry declares R1 to R14 once each; each counted or naming the item that will count it", () => {
  assert.deepEqual(
    Arr.map(ratchets, (ratchet) => ratchet.id),
    Arr.map(Arr.range(1, 14), (n) => `R${String(n)}`),
  );
  for (const ratchet of ratchets) {
    assert.ok(ratchet.holds.length > 0 && ratchet.closes.length > 0, `${ratchet.id} says what it holds and closes`);
    assert.equal(ratchet.count === "not yet counted", ratchet.countedBy !== undefined, `${ratchet.id}'s countedBy`);
  }
  assert.ok(Arr.every(["owned-values", "declared-names", "decoded-rows"], (rule) => rule in lists.lint));
});

const BLUEPRINT = new URL("../../blueprint/", import.meta.url);
/** The committed counts file, decoded. */
const CountsFile = Schema.Struct({ counts: Schema.Record(Schema.String, Schema.Int) });
const committed = (): Counts =>
  // oxlint-disable-next-line effecttsgo/schema-sync -- a test: a file of another shape fails it with its reason.
  Schema.decodeUnknownSync(CountsFile)(JSON.parse(readFileSync(new URL(OUTPUTS.counts, BLUEPRINT), "utf8"))).counts;

test("no counted list of the repository grew over its committed count, and each counted one is committed", () => {
  const counts = committed();
  assert.deepEqual(grown(counts, tallies), []);
  assert.deepEqual(Arr.sort(Rec.keys(counts), Order.String), Arr.sort(Rec.keys(countsOf(tallies)), Order.String));
});

test("the committed scorecard is what the sources render", () => {
  const things = new URL("src/things/", BLUEPRINT);
  const layout = layoutOf(
    Arr.map(
      Arr.filter(readdirSync(things, { recursive: true, encoding: "utf8" }), (path) => Str.endsWith(".ts")(path)),
      (path) => ({ path, text: readFileSync(new URL(path, things), "utf8") }),
    ),
  );
  const onDisk = readFileSync(new URL(OUTPUTS.scorecard, BLUEPRINT), "utf8");
  assert.equal(onDisk, renderScorecard(scorecardInputs(layout)), "the scorecard is out of date: run `pnpm generate`");
  assert.equal(layout.things.length, 13);
});
