// The blueprint's own ratchets counted (roadmap items 3.6 and 3.11): its registry, its committed counts and its
// scorecard, from the lists this package gathers (src/ratchet-sources.ts) and the toolkit counts. Moved from
// packages/blueprint-tools' tests by item 3.10, which made the toolkit import nothing of the blueprint; R16 to R19 added, and R20 (item 3.8).
// Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ratchets } from "@capxul/blueprint";
import { layoutOf, OLD_WORDS, Ratchets, renderScorecard } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { repositoryFiles } from "../src/ratchet-files.entry.ts";
import { listsOf, scorecardInputs, talliesOf } from "../src/ratchet-sources.ts";

const { countsOf, grown, OUTPUTS } = Ratchets;
type Counts = Ratchets.Counts;

/** The repository's files R7, R8, R10 and R20 are counted from, read once. */
const files = repositoryFiles();

test("the registry declares R1 to R20 once each; each counted or naming the item that will count it", () => {
  assert.deepEqual(
    Arr.map(ratchets, (ratchet) => ratchet.id),
    Arr.map(Arr.range(1, 20), (n) => `R${String(n)}`),
  );
  for (const ratchet of ratchets) {
    assert.ok(ratchet.holds.length > 0 && ratchet.closes.length > 0, `${ratchet.id} says what it holds and closes`);
    assert.equal(ratchet.count === "not yet counted", ratchet.countedBy !== undefined, `${ratchet.id}'s countedBy`);
  }
  assert.ok(Arr.every(["owned-values", "declared-names", "decoded-rows"], (rule) => rule in listsOf({}, files).lint));
  const words = Arr.findFirst(ratchets, (ratchet) => ratchet.id === "R15");
  assert.ok(Option.isSome(words) && words.value.count === "words:old-words" && words.value.gate === "pnpm words");
});

const BLUEPRINT = new URL("../../blueprint/", import.meta.url);
/** The committed counts file, decoded. */
const CountsFile = Schema.Struct({ counts: Schema.Record(Schema.String, Schema.Int) });
const countsAt = (url: URL): Counts =>
  // oxlint-disable-next-line effecttsgo/schema-sync -- a test: a file of another shape fails it with its reason.
  Schema.decodeUnknownSync(CountsFile)(JSON.parse(readFileSync(url, "utf8"))).counts;
const committed = (): Counts => countsAt(new URL(OUTPUTS.counts, BLUEPRINT));
/** The repository's ratchets counted now, R15 from the committed old-words.json. */
const tallies = talliesOf(countsAt(new URL(`../../../${OLD_WORDS}`, import.meta.url)), files);

test("no counted list of the repository grew over its committed count, and each counted one is committed", () => {
  const counts = committed();
  assert.equal(counts["R15"], undefined, "R15 is gated by `pnpm words`, so ratchets.json holds no count of it");
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
  assert.equal(
    onDisk,
    renderScorecard(scorecardInputs(layout, tallies)),
    "the scorecard is out of date: run `pnpm generate`",
  );
  assert.equal(layout.things.length, 20);
});

test("R7, R8 and R10 read the repository's files, and each doc on R8's list is still there to fold", () => {
  assert.ok(Rec.keys(files.verbs).length > 0, "the verbs are read");
  assert.ok("packages/blueprint/README.md" in files.docs, "the READMEs are read");
  assert.ok("packages/indexer/src/index.ts" in files.nonEffect, "effect-only ran on Ponder's files");
  assert.ok(Arr.contains(files.dependencies["packages/core"] ?? [], "effect"), "the manifests are read");
  const docs = Arr.findFirst(ratchets, (ratchet) => ratchet.id === "R8");
  assert.ok(Option.isSome(docs) && docs.value.count === "docs:long-or-mapped");
  for (const path of docs.value.unmigrated ?? [])
    assert.ok(existsSync(new URL(`../../../${path}`, import.meta.url)), `${path} is folded: take it off R8's list`);
});
