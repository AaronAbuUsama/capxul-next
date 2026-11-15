// The blueprint's own glossary, counted by the toolkit's count of old words (ratchet R15, roadmap item 3.8): its
// packages and deployed names count nothing, each agreed word is declared once, and it counts on the repository. The
// toolkit's own tests count made-up glossaries; the blueprint passes its own in here. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { countOldWords, wordFiles } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { glossary } from "../src/index.ts";

/** The count of `word` in one file, by the blueprint's own glossary. */
const of = (word: string, text: string): number => countOldWords(glossary, [{ path: "a.ts", text }])[word] ?? -1;

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
