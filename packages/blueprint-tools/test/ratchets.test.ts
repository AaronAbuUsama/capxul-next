// The ratchet registry counted (roadmap items 3.6 and 3.11): the counters on made-up registries and lists, `pnpm
// ratchets` failing on a list that grew and passing on one that shrank, `pnpm generate` never raising a count, the
// scorecard's cells. The blueprint's own registry, its committed counts and its scorecard are tested where its lists are
// gathered (packages/generate/test/ratchets.test.ts). Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import type { Ratchet } from "../src/language/ratchet.ts";
import type { Format } from "../src/checks/format.ts";
import { countsOf, grown, notes, settled, tally, type Lists } from "../src/checks/ratchets.ts";
import { renderScorecard } from "../src/checks/scorecard.ts";
import { layoutOf } from "../src/index.ts";

const registry: ReadonlyArray<Ratchet> = [
  { id: "R1", name: "Raw", holds: "raw schemas", closes: "3.3", count: "lint:owned-values" },
  { id: "R5", name: "Formats", holds: "operations", closes: "3.5", count: "formats" },
  { id: "R6", name: "Spans", holds: "spans", closes: "4.1", count: "not yet counted", countedBy: "4.1" },
  { id: "R15", name: "Words", holds: "old words", closes: "3.8", count: "words:old-words", gate: "pnpm words" },
];
const made: Lists = {
  lint: { "owned-values": { "a.ts": 3, "b.ts": 2 } },
  formats: { machine: ["ticket.open"], steps: ["ticket.open", "ticket.close"] },
  oldWords: { alpha: 4, beta: 0, gamma: 2 },
};

test("each ratchet is counted from its list, and one not yet counted has no count", () => {
  const counted = tally(registry, made);
  assert.deepEqual(
    Arr.map(counted, ({ ratchet, count }) => [ratchet.id, count]),
    [
      ["R1", 5],
      ["R5", 3],
      ["R6", null],
      ["R15", 6],
    ],
  );
  assert.deepEqual(counted[0]?.items, ["a.ts: 3", "b.ts: 2"]);
  assert.deepEqual(counted[1]?.items, ["machine: ticket.open", "steps: ticket.open", "steps: ticket.close"]);
  assert.deepEqual(counted[3]?.items, ["alpha: 4", "gamma: 2"]);
  assert.deepEqual(countsOf(counted), { R1: 5, R5: 3 });
});

test("a ratchet with a gate of its own is reported, never committed nor failed by `pnpm ratchets`", () => {
  const grewWords = tally(registry, { ...made, oldWords: { alpha: 40, beta: 0, gamma: 2 } });
  assert.deepEqual(grown({ R1: 5, R5: 3, R15: 6 }, grewWords), []);
  assert.deepEqual(notes({ R1: 5, R5: 3 }, grewWords), []);
  assert.deepEqual(settled({ R1: 5, R5: 3 }, grewWords), { R1: 5, R5: 3 });
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
  `const r = Rpc.make("${operation}", {});\nexport const ${name} = verb({});\nexport const server = "world";\n` +
  `export const promises = {};\n${stateless ? 'export const stateless = "a read";\n' : ""}`;

test("the scorecard marks each thing against each format and ratchet", () => {
  const layout = layoutOf([
    { path: "ticket/lifecycle.ts", text: 'export const Ticket = Machine.make({ name: "ticket" });\n' },
    { path: "ticket/verbs/open.ts", text: verb("open", "ticket.open", false) },
    { path: "log/verbs/read.ts", text: verb("read", "log.read", true) },
    { path: "note/verbs/add.ts", text: verb("add", "note.add", false) },
  ]);
  const machine: Format = {
    missing: (operation) => (operation === "note.add" ? ["moves nothing"] : []),
    unmigrated: ["note.add"],
  };
  const text = renderScorecard({
    layout,
    formats: { machine },
    rawSchemaFiles: ["packages/blueprint/src/things/note/verbs/add.ts"],
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
  assert.match(text, /\| R15 Words \| old words \| 6, gated by `pnpm words` \| 3\.8 \|/);
});
