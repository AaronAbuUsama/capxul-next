// `pnpm words`, the gate of the rename ratchet R15 "Old words" (its entry in packages/blueprint/src/ratchets.ts;
// docs/roadmap.md, item 3.8; `pnpm ratchets` only reports its total): counts every old word of the glossary
// (old-words.ts says what counts) and fails when one grew past its committed count, in
// packages/blueprint/generated/old-words.json, which `pnpm generate` writes. With `--base <ref>` (CI passes the pull
// request's base branch) it fails too when a count grew past that branch's committed count, so a count raised by
// generating again is still caught. With `--where <word>` it prints the files that hold that word, by count. An entry
// file: it reads the disk and git, parses JSON, prints and sets the exit code.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { glossary } from "../../../blueprint/src/index.ts";
import { countFile, countOldWords, type Counts, grown, OLD_WORDS } from "./old-words.ts";
import { wordFiles } from "./word-files.ts";

const root = join(import.meta.dirname, "../../../..");
const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

/** A committed old-words.json: only its counts are read. */
const Committed = Schema.Struct({ counts: Schema.Record(Schema.String, Schema.Int) });

/** The counts in a committed old-words.json's text; a file of another shape stops the run. */
const countsIn = (text: string): Counts =>
  // oxlint-disable-next-line effecttsgo/schema-sync -- an entry file run once from the command line: a file of another shape stops the run with its reason.
  Schema.decodeUnknownSync(Committed)(JSON.parse(text)).counts;

const files = wordFiles({
  isFolder: (path) => statSync(join(root, path)).isDirectory(),
  names: (folder) => readdirSync(join(root, folder)),
  text: (file) => readFileSync(join(root, file), "utf8"),
});
const now = countOldWords(glossary, files);

const where = flag("--where");
if (where !== undefined) {
  const holding = Arr.flatMap(files, (file) => {
    const count = countFile(glossary, file)[where] ?? 0;
    return count > 0 ? [{ path: file.path, count }] : [];
  });
  const byCount = Order.flip(Order.mapInput(Order.Number, (each: { readonly count: number }) => each.count));
  for (const { path, count } of Arr.sort(holding, byCount)) console.log(`${count}\t${path}`);
  process.exit(0);
}

const committed = existsSync(join(root, OLD_WORDS)) ? countsIn(readFileSync(join(root, OLD_WORDS), "utf8")) : {};
const base = flag("--base");
const onBase = ((): Counts => {
  if (base === undefined) return {};
  try {
    return countsIn(
      execFileSync("git", ["show", `${base}:${OLD_WORDS}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    console.log(`${base} has no ${OLD_WORDS}: only the committed counts are compared`);
    return {};
  }
})();

for (const [word, count] of Rec.toEntries(now)) {
  const was = committed[word];
  const note = count === 0 ? "done" : was === undefined ? "new" : count < was ? `fell from ${was}` : "";
  console.log(`${Str.padEnd(22)(word)} ${Str.padStart(5)(String(count))}  ${note}`);
}

const findings = [
  ...Arr.map(grown(committed, now), (each) => `${each.word}: ${each.now}, up from ${each.before} committed`),
  ...Arr.map(grown(onBase, now), (each) => `${each.word}: ${each.now}, up from ${each.before} on ${base}`),
];
for (const finding of findings) console.error(finding);
if (findings.length > 0) {
  console.error(
    "old words: a count grew. Write the glossary's word instead (packages/blueprint/generated/glossary.md); " +
      "`pnpm words --where <word>` lists where each is",
  );
  process.exitCode = 1;
} else if (Arr.some(Rec.toEntries(now), ([word, count]) => count !== committed[word]))
  console.log(`old words: none grew; run \`pnpm generate\` and commit ${OLD_WORDS} to keep the counts that fell`);
else console.log("old words: none grew");
