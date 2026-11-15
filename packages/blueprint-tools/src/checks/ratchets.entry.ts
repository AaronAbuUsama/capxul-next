// `pnpm ratchets`: prints every ratchet of the blueprint's registry with its count now, and fails when a counted list
// grew over its committed count (packages/blueprint/generated/ratchets.json). With --write (inside `pnpm generate`) it
// writes the counts, never raising one (ratchets.ts, `settled`), and the scorecard; with --check (inside
// `pnpm generate:check`) it writes nothing and fails when either file is not what --write would write.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { layoutOf } from "../render/layout.ts";
import { scorecardInputs, tallies } from "./ratchet-sources.ts";
import { grown, notes, OUTPUTS, settled, type Counts } from "./ratchets.ts";
import { renderScorecard } from "./scorecard.ts";

const blueprint = new URL("../../../blueprint/", import.meta.url);
const at = (path: string) => new URL(path, blueprint);

/** The counts file: the counts, by ratchet id, under a line saying it is generated. */
const CountsFile = Schema.Struct({ counts: Schema.Record(Schema.String, Schema.Int) });

const committed: Counts = existsSync(at(OUTPUTS.counts))
  ? // oxlint-disable-next-line effecttsgo/schema-sync -- an entry file run once from the command line: a file of another shape stops the run with its reason.
    Schema.decodeUnknownSync(CountsFile)(JSON.parse(readFileSync(at(OUTPUTS.counts), "utf8"))).counts
  : {};

const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : "count";

if (mode === "count") {
  for (const { ratchet, count } of tallies)
    console.log(
      `${Str.padEnd(4, " ")(ratchet.id)} ${Str.padEnd(34, " ")(ratchet.name)} ${
        count === null ? `not yet counted (${ratchet.countedBy ?? "unassigned"})` : String(count)
      }`,
    );
  for (const note of notes(committed, tallies)) console.log(note);
  const grew = grown(committed, tallies);
  for (const why of grew) console.error(why);
  if (grew.length > 0) {
    console.error(`ratchets: ${grew.length} list(s) grew`);
    process.exitCode = 1;
  } else console.log("ratchets: no counted list grew");
} else {
  const things = at("src/things/");
  const layout = layoutOf(
    Arr.map(
      Arr.filter(readdirSync(things, { recursive: true, encoding: "utf8" }), (path) => Str.endsWith(".ts")(path)),
      (path) => ({ path, text: readFileSync(new URL(path, things), "utf8") }),
    ),
  );
  if (layout.problems.length > 0) throw new Error(`the blueprint's layout:\n${Arr.join(layout.problems, "\n")}`);
  const counts = settled(committed, tallies);
  const outputs: ReadonlyArray<readonly [string, string]> = [
    [
      OUTPUTS.counts,
      `${JSON.stringify(
        {
          generated:
            "By `pnpm generate` (packages/blueprint-tools, src/checks/ratchets.entry.ts): each counted ratchet's count, never raised by generating again. Do not edit.",
          counts,
        },
        null,
        2,
      )}\n`,
    ],
    [OUTPUTS.scorecard, renderScorecard(scorecardInputs(layout))],
  ];
  const stale = Arr.filter(outputs, ([path, text]) => !existsSync(at(path)) || readFileSync(at(path), "utf8") !== text);
  for (const [path, text] of stale) {
    if (mode === "check") {
      console.error(
        `packages/blueprint/${path} is not what generating again writes: run \`pnpm generate\` and commit it`,
      );
      continue;
    }
    writeFileSync(at(path), text);
    console.log(`wrote packages/blueprint/${path}`);
  }
  if (mode === "check" && stale.length > 0) process.exitCode = 1;
}
